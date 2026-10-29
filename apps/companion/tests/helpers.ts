import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Workspace } from '../src/workspace';
import { createCompanion, type CompanionOptions } from '../src/server';
import type { AIProvider } from '../src/ai';
import type { GitHubAdapter } from '../src/github';
import type {
  ApprovedContext,
  Investigation,
  ModelPatch,
} from '@reproforge/shared/integrations';
export const exec = promisify(execFile);
export const origin = 'chrome-extension://' + 'a'.repeat(32);
export const evidence = {
  method: 'POST' as const,
  path: '/api/investments',
  observedStatus: 422,
  expectedStatus: 201,
  body: { symbol: 'DEMO', amount: 100, currency: 'USD', type: 'monthly' },
  headers: {},
  expectation: 'A valid synthetic monthly investment should be created.',
  steps: 'Submit the synthetic demo form.',
  environment: 'Isolated demo',
  regressionReference: '',
};
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reproforge-fixture-'));
  await mkdir(join(root, 'apps/demo-api/src'), { recursive: true });
  await writeFile(
    join(root, 'apps/demo-api/src/app.ts'),
    await readFile(resolve('apps/demo-api/src/app.ts'), 'utf8'),
  );
  await writeFile(
    join(root, '.gitignore'),
    '.env\nignored.ts\nnode_modules/\n',
  );
  await exec('git', ['init', '-b', 'main'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec(
    'git',
    [
      '-c',
      'user.name=ReproForge tests',
      '-c',
      'user.email=tests@example.invalid',
      'commit',
      '-m',
      'Synthetic fixture',
    ],
    { cwd: root },
  );
  await exec('git', ['config', 'user.name', 'ReproForge tests'], { cwd: root });
  await exec('git', ['config', 'user.email', 'tests@example.invalid'], {
    cwd: root,
  });
  await exec(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/example/demo.git'],
    { cwd: root },
  );
  return {
    root,
    workspace: await Workspace.open(root),
    close: () => rm(root, { recursive: true, force: true }),
  };
}
export function finding(context: ApprovedContext): Investigation {
  const file = context.files.find(
    (f) => f.path === 'apps/demo-api/src/app.ts',
  )!;
  const line =
    file.content.split('\n').findIndex((l) => l.includes("mode === 'buggy'")) +
    1;
  return {
    summary:
      'The monthly validation branch appears to reject the documented fixture.',
    observedFailure: {
      method: 'POST',
      endpoint: '/api/investments',
      status: 422,
    },
    possibleRootCauses: [
      {
        description:
          'The intentional monthly rejection may explain the failure.',
        confidence: 'high',
        evidence: [
          {
            file: file.path,
            line,
            quote: file.content.split('\n')[line - 1]!.trim(),
            detail: 'The branch rejects monthly requests in buggy mode.',
          },
        ],
      },
    ],
    recommendedActions: [
      'Remove the incorrect rejection and run the same test.',
    ],
    requiresMoreInformation: false,
  };
}
export function correction(context: ApprovedContext): ModelPatch {
  const file = context.files.find(
    (f) => f.path === 'apps/demo-api/src/app.ts',
  )!;
  const start = file.content.indexOf("    if (mode === 'buggy'");
  const end = file.content.indexOf('    res.status(201)', start);
  if (start < 0 || end < 0)
    throw new Error(
      'Demo source shape changed; update the explicitly synthetic fixture.',
    );
  return {
    summary:
      'Remove the invalid monthly rejection while preserving input validation.',
    edits: [
      {
        path: file.path,
        before: file.content.slice(start, end),
        after: '',
        explanation:
          'Valid monthly investments reach the existing creation response.',
      },
    ],
    tests: [
      'Same generated POST regression',
      'Invalid amount remains rejected',
      'One-time investment remains accepted',
      'TypeScript',
    ],
    risks: ['Status-only checks do not prove all business behavior.'],
    assumptions: ['The documented synthetic request should return 201.'],
  };
}
export class FakeAI implements AIProvider {
  calls = 0;
  async investigate(c: ApprovedContext) {
    this.calls++;
    return finding(c);
  }
  async fix(c: ApprovedContext) {
    this.calls++;
    return correction(c);
  }
}
export class FakeGitHub implements GitHubAdapter {
  issues = 0;
  prs = 0;
  heads = new Map<string, string>();
  async branchCommit(_repo: string, branch: string) {
    return this.heads.get(branch) ?? '0'.repeat(40);
  }
  async account() {
    return 'fixture-account';
  }
  async repository(repo: string) {
    return {
      fullName: repo,
      issuesEnabled: true,
      canPush: true,
      defaultBranch: 'main',
      labels: ['bug'],
    };
  }
  async matches() {
    return [];
  }
  async createIssue(repo: string) {
    this.issues++;
    return { number: 42, url: `https://github.com/${repo}/issues/42` };
  }
  async createPR(repo: string) {
    this.prs++;
    return { number: 43, url: `https://github.com/${repo}/pull/43` };
  }
  async branchExists(_repo: string, branch: string) {
    return branch === 'main';
  }
}
export async function live(options: Partial<CompanionOptions> = {}) {
  const f = await fixture();
  const config: CompanionOptions = {
    workspace: f.workspace,
    port: 0,
    pairingCode: 'test-pairing-code-at-least-24-characters',
    github: new FakeGitHub(),
    ai: new FakeAI(),
    verificationProfile: 'demo-investments',
    ...options,
  };
  const c = createCompanion(config);
  const server = c.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  if (process.env.DEBUG_COMPANION === '1')
    server.on('request', (req) =>
      console.log(
        'TEST request metadata',
        req.method,
        req.url,
        'origin=',
        req.headers.origin,
        'site=',
        req.headers['sec-fetch-site'],
      ),
    );
  config.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${config.port}`;
  let token = '';
  const request = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { 'X-ReproForge-Request': crypto.randomUUID() }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    return { status: response.status, data };
  };
  const pair = async () => {
    const r = await request('/pair', { code: c.pairingCode });
    token = (r.data as { token: string }).token;
    return r;
  };
  return {
    ...f,
    ...c,
    base,
    request,
    pair,
    github: config.github!,
    ai: config.ai!,
    close: async () => {
      await c.close();
      await new Promise<void>((done) => server.close(() => done()));
      await f.close();
    },
  };
}
