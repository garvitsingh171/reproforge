/** Real MV3 / DevTools test. No synthetic Chrome API or capture-store injection. */
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { mkdir, writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { live } from '../apps/companion/tests/helpers';
import { createDemoApp } from '../apps/demo-api/src/app';

const integration = process.env.WITH_COMPANION === '1' ? await live() : null;
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
await rm(join(artifacts, 'browser-smoke.txt'), { force: true });
if (process.env.WITH_COMPANION === '1')
  await rm(join(artifacts, 'browser-companion.txt'), { force: true });
await rm(join(artifacts, 'browser-downloads/reproforge-regression.zip'), {
  force: true,
});
const server = createDemoApp('buggy').listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const profile = await mkdtemp(join(tmpdir(), 'reproforge-chromium-'));
const extension = resolve('apps/extension/dist');
// Use the full Chromium channel: headless shell does not support extensions.
let context: BrowserContext | undefined;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.HEADED !== '1',
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--auto-open-devtools-for-tabs',
      '--remote-debugging-port=0',
    ],
  });
  const page =
    context.pages().find((p) => p.url() === 'about:blank') ??
    (await context.newPage());
  await page.goto(origin);
  const port = (
    await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
  ).split('\n')[0];
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()) as { id: string; url: string; webSocketDebuggerUrl: string }[];
  console.log(
    'Browser targets:',
    targets.map((t) => t.url),
  );
  await writeFile(
    join(artifacts, 'browser-targets.json'),
    JSON.stringify(targets, null, 2),
  );
  const devtools = targets.find((t) => t.url.startsWith('devtools://'));
  if (!devtools)
    throw new Error(
      'DevTools target unavailable. Try HEADED=1 under a desktop or Xvfb.',
    );
  const socket = new WebSocket(devtools.webSocketDebuggerUrl);
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  const contexts = new Map<number, { origin: string; name: string }>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: { message: string };
      method?: string;
      params?: { context?: { id: number; origin: string; name: string } };
    };
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) p?.reject(new Error(message.error.message));
      else p?.resolve(message.result ?? {});
    }
    if (
      message.method === 'Log.entryAdded' ||
      message.method === 'Runtime.exceptionThrown'
    )
      console.log('Browser diagnostic:', message);
    if (
      message.method === 'Runtime.executionContextCreated' &&
      message.params?.context
    ) {
      const c = message.params.context;
      contexts.set(c.id, c);
    }
  });
  async function send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ) {
    const id = ++sequence;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async function evaluate<T>(
    expression: string,
    contextId?: number,
  ): Promise<T> {
    const r = await send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return (r.result as { value: T }).value;
  }
  await send('Runtime.enable');
  const showPanel = `(async()=>{const UI=await import('./ui/legacy/legacy.js');const view=[...UI.ViewManager.ViewManager.instance().views.values()].find(v=>v.title()==='ReproForge');if(!view)return false;await UI.ViewManager.ViewManager.instance().showView(view.viewId());return true;})()`;
  try {
    await expect
      .poll(() => evaluate<boolean>(showPanel).catch(() => false), {
        timeout: 10000,
      })
      .toBe(true);
  } catch (error) {
    console.log(
      'View inspection:',
      await evaluate(showPanel).catch((e) => String(e)),
    );
    console.log(
      'Registered views:',
      await evaluate(
        `(async()=>{const UI=await import('./ui/legacy/legacy.js');return [...UI.ViewManager.ViewManager.instance().views.values()].map(v=>({id:v.viewId(),title:v.title()}));})()`,
      ).catch((e) => String(e)),
    );
    const targetList = (await send('Target.getTargets')) as {
      targetInfos: { targetId: string; url: string }[];
    };
    const hidden = targetList.targetInfos.find((t) =>
      t.url.endsWith('/devtools.html'),
    );
    if (hidden) {
      const attached = await send('Target.attachToTarget', {
        targetId: hidden.targetId,
        flatten: true,
      });
      const hiddenSession = String(attached.sessionId);
      await send('Log.enable', {}, hiddenSession);
      await send('Runtime.enable', {}, hiddenSession);
      console.log(
        'Hidden extension:',
        await send(
          'Runtime.evaluate',
          {
            expression:
              'JSON.stringify({url:location.href,html:document.documentElement.outerHTML,chrome:typeof chrome.devtools})',
            returnByValue: true,
          },
          hiddenSession,
        ),
      );
    }
    throw error;
  }
  let panelSession: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await send('Target.getTargets')) as {
          targetInfos: { targetId: string; url: string }[];
        };
        const target = list.targetInfos.find((t) =>
          t.url.endsWith('/panel.html'),
        );
        if (!target) return false;
        const attached = await send('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        panelSession = String(attached.sessionId);
        return true;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const panel = async <T>(expression: string): Promise<T> => {
    const r = await send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
      panelSession,
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return (r.result as { value: T }).value;
  };
  await expect
    .poll(() => panel<boolean>('Boolean(window.__reproforge)'))
    .toBe(true);
  const click = (label: string) =>
    panel<boolean>(
      `(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)} || e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw new Error('Button missing');b.click();return true;})()`,
    );
  const text = () => panel<string>('document.body.innerText');
  await expect.poll(text).toContain('Capturing');
  await page
    .getByRole('button', { name: 'Submit synthetic investment' })
    .click();
  await expect(page.locator('#result')).toContainText('HTTP 422');
  await expect.poll(text).toContain('/api/investments');
  await click('Response');
  await click('Load sanitized preview');
  await expect.poll(text).toContain('INVALID_INTERVAL');
  await click('Test Builder');
  await panel(
    `(() => {const input=document.querySelector('input[aria-label="Expected status"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'201');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await expect.poll(text).toContain('toBe(201)');
  await click('Request');
  await click('Test Builder');
  await expect.poll(text).toContain('toBe(201)');
  await click('Review & export bundle');
  await expect.poll(text).toContain('Review exact export');
  const before = await panel<boolean>(
    "[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Download ZIP')).disabled",
  );
  expect(before).toBe(true);
  await panel("document.querySelector('dialog input[type=checkbox]').click()");
  // DevTools-owned downloads can be observed at browser level, outside the inspected page.
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: join(artifacts, 'browser-downloads'),
    eventsEnabled: true,
  });
  await click('Download ZIP');
  await expect
    .poll(
      async () =>
        readFile(join(artifacts, 'browser-downloads/reproforge-regression.zip'))
          .then((b) => b.length)
          .catch(() => 0),
      { timeout: 15000 },
    )
    .toBeGreaterThan(1000);
  await panel(
    'window.__finishedForTest=0; chrome.devtools.network.onRequestFinished.addListener(()=>window.__finishedForTest++)',
  );
  await click('Pause capture');
  await page
    .getByRole('button', { name: 'Submit synthetic investment' })
    .click();
  await expect.poll(() => panel<number>('window.__finishedForTest')).toBe(1);
  expect(
    await panel<number>('window.__reproforge.getSnapshot().records.length'),
  ).toBe(1);
  await click('Resume capture');
  await page
    .getByRole('button', { name: 'Submit synthetic investment' })
    .click();
  await expect
    .poll(() =>
      panel<number>('window.__reproforge.getSnapshot().records.length'),
    )
    .toBe(2);
  await expect.poll(() => panel<number>('window.__finishedForTest')).toBe(2);
  await expect.poll(text).toContain('toBe(201)');
  // Assert a genuine sensitive request cannot leak through the rendered capture path.
  await page.evaluate(async () => {
    const r = await fetch('/api/investments?token=SYNTHETIC_QUERY_SECRET', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer SYNTHETIC_HEADER_SECRET',
      },
      body: JSON.stringify({
        symbol: 'DEMO',
        amount: 100,
        currency: 'USD',
        type: 'monthly',
        password: 'SYNTHETIC_PASSWORD',
      }),
    });
    await r.text();
  });
  await expect
    .poll(() =>
      panel<number>('window.__reproforge.getSnapshot().records.length'),
    )
    .toBe(3);
  await panel("document.querySelector('.request-row').click()");
  await click('Request');
  const rendered = await text();
  for (const secret of [
    'SYNTHETIC_QUERY_SECRET',
    'SYNTHETIC_HEADER_SECRET',
    'SYNTHETIC_PASSWORD',
  ])
    expect(rendered).not.toContain(secret);
  await click('Overview');
  // Widen the real DevTools window for an inspectable product screenshot.
  await evaluate(
    `(async()=>{const UI=await import('./ui/legacy/legacy.js');UI.DockController.DockController.instance().setDockSide('undocked');})()`,
  );
  const bounds = await send('Browser.getWindowForTarget', {
    targetId: devtools.id,
  });
  await send('Browser.setWindowBounds', {
    windowId: bounds.windowId,
    bounds: { width: 1280, height: 900 },
  });

  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
  }).catch(() => null);
  if (screenshot)
    await writeFile(
      join(artifacts, 'devtools-smoke.png'),
      Buffer.from(String(screenshot.data), 'base64'),
    );
  if (integration) {
    const input = async (label: string, value: string) =>
      panel(
        `(()=>{const e=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await panel(
      "[...document.querySelectorAll('.request-row')].at(-1).click()",
    );
    await click('Integration settings');
    await input('Companion port', new URL(integration.base).port);
    await input('Pairing code', integration.pairingCode);
    // Test-profile setup via Chrome's own extension settings API, not a mocked permission response.
    // The native first-grant prompt remains a manual check in the user's Chrome profile.
    const extensionId = await panel<string>('chrome.runtime.id');
    const permissionsPage = await context.newPage();
    await permissionsPage.goto('chrome://extensions');
    await permissionsPage.evaluate(async (id) => {
      const api = chrome as unknown as {
        developerPrivate: {
          addHostPermission: (
            extensionId: string,
            host: string,
          ) => Promise<void>;
        };
      };
      await api.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*');
    }, extensionId);
    await permissionsPage.close();
    await click('Pair local companion');
    await expect
      .poll(text, { timeout: 15000 })
      .toContain('Local Companion Connected');
    await click('Back to network monitor');
    await click('AI Investigation');
    await input('Integration expected status', '201');
    await input(
      'Intended outcome',
      'A valid synthetic monthly investment should return 201.',
    );
    await click('Find relevant source files');
    await expect.poll(text).toContain('apps/demo-api/src/app.ts');
    await click('Investigate with AI');
    await expect.poll(text).toContain('Send approved context to Gemini');
    await panel(
      "document.querySelector('dialog input[type=checkbox]').click()",
    );
    await panel(
      "[...document.querySelectorAll('dialog button')].find(e=>e.textContent.trim()==='Investigate with AI').click()",
    );
    await expect.poll(text).toContain('Investigation complete');
    await click('Code Fix');
    await click('Generate Fix');
    await panel(
      "document.querySelector('dialog input[type=checkbox]').click()",
    );
    await panel(
      "[...document.querySelectorAll('dialog button')].find(e=>e.textContent.trim()==='Generate Fix').click()",
    );
    await expect.poll(text).toContain('Remove the invalid monthly rejection');
    await click('Stage in Sandbox');
    await panel(
      "document.querySelector('dialog input[type=checkbox]').click()",
    );
    await panel(
      "[...document.querySelectorAll('dialog button')].find(e=>e.textContent.trim()==='Stage in Sandbox').click()",
    );
    await expect.poll(text).toContain('staged');
    await click('Run Verification');
    await expect.poll(text).toContain('Run isolated verification');
    await panel(
      "document.querySelector('dialog input[type=checkbox]').click()",
    );
    await panel(
      "[...document.querySelectorAll('dialog button')].find(e=>e.textContent.trim()==='Run Verification').click()",
    );
    await expect
      .poll(text, { timeout: 30000 })
      .toContain('Verification: passed');
    await expect
      .poll(() =>
        panel<boolean>(
          "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Apply to Local Branch').disabled",
        ),
      )
      .toBe(false);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      join(artifacts, 'companion-workflow.png'),
      Buffer.from(String(shot.data), 'base64'),
    );
    await click('GitHub');
    await input('GitHub repository', 'example/demo');
    await click('Check connection & repository');
    await expect.poll(text).toContain('fixture-account');
    await click('Create GitHub Issue');
    await expect.poll(text).toContain('Issue title');
    await click('Review issue for publication');
    await expect.poll(text).toContain('Publish GitHub issue');
    await panel(
      "document.querySelector('dialog input[type=checkbox]').click()",
    );
    await panel(
      "[...document.querySelectorAll('dialog button')].find(e=>e.textContent.trim()==='Create Issue').click()",
    );
    await expect.poll(text).toContain('Open issue #42 in GitHub');
    await writeFile(
      join(artifacts, 'browser-companion.txt'),
      'PASS: real extension pairing, source preview, approval controls, patch diff, isolated red/green verification and issue UI. Gemini/GitHub use explicit test adapters; no external issue or AI request was made.\n',
    );
  }
  await click('Clear requests');
  await expect.poll(text).toContain('Waiting for a failure');
  const emptyShot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    join(artifacts, 'devtools-empty.png'),
    Buffer.from(String(emptyShot.data), 'base64'),
  );
  await writeFile(
    join(artifacts, 'browser-smoke.txt'),
    'PASS: real unpacked MV3 extension loaded, DevTools panel registered, genuine POST 422 captured, on-demand response sanitized, expected 201 preview generated, review gate enforced, ZIP downloaded, selection preserved, synthetic secrets excluded, pause/resume/clear verified.\n',
  );
  console.log(await readFile(join(artifacts, 'browser-smoke.txt'), 'utf8'));
  socket.close();
} finally {
  await context?.close();
  await integration?.close();
  await new Promise<void>((done) => server.close(() => done()));
}
