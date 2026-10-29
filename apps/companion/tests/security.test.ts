import { describe, it, expect } from 'vitest';
import { writeFile, symlink, mkdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { fixture, live, origin, evidence, exec } from './helpers';
import { allowedPath } from '../src/workspace';
import { runCommand } from '../src/process';

describe('companion local trust boundary', () => {
  it('requires pairing, rejects invalid code, and binds the session to one extension', async () => {
    const c = await live();
    try {
      expect((await c.request('/status')).status).toBe(401);
      expect(
        (await c.request('/pair', { code: 'wrong-pairing-code-123456' }))
          .status,
      ).toBe(403);
      expect((await c.pair()).status).toBe(200);
      expect((await c.request('/status')).status).toBe(200);
      expect(
        (await c.request('/status', undefined, { Origin: 'https://evil.test' }))
          .status,
      ).toBe(403);
      expect(
        (
          await c.request('/status', undefined, {
            Origin: 'chrome-extension://' + 'b'.repeat(32),
          })
        ).status,
      ).toBe(403);
      expect((await c.request('/pair', { code: c.pairingCode })).status).toBe(
        403,
      );
    } finally {
      await c.close();
    }
  });
  it('rejects rebinding Hosts, oversized bodies, replayed writes and unknown filesystem paths', async () => {
    const c = await live();
    try {
      await c.pair();
      const hostStatus = await new Promise<number>((resolve) => {
        const req = httpRequest(
          c.base + '/status',
          { headers: { Host: 'evil.test', Origin: origin } },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.end();
      });
      expect(hostStatus).toBe(403);
      expect(
        (await c.request('/contexts', { evidence, paths: ['../escape.ts'] }))
          .status,
      ).toBe(400);
      const id = crypto.randomUUID();
      expect(
        (
          await c.request('/issues/template', evidence, {
            'X-ReproForge-Request': id,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await c.request('/issues/template', evidence, {
            'X-ReproForge-Request': id,
          })
        ).status,
      ).toBe(409);
      expect(
        (await c.request('/issues/template', { text: 'x'.repeat(170000) }))
          .status,
      ).toBe(413);
      const response = await fetch(c.base + '/status', {
        headers: { Origin: origin.replace('chrome-extension:', 'https:') },
      });
      expect(response.status).toBe(403);
    } finally {
      await c.close();
    }
  });
  it('revokes connection and clears context on disconnect', async () => {
    const c = await live();
    try {
      await c.pair();
      expect((await c.request('/disconnect', {})).status).toBe(200);
      expect((await c.request('/status')).status).toBe(401);
    } finally {
      await c.close();
    }
  });
  it('never sends context to AI without explicit approval', async () => {
    const c = await live();
    try {
      await c.pair();
      const r = await c.request('/contexts', { evidence });
      const id = (r.data as { id: string }).id;
      expect((await c.request(`/contexts/${id}/investigate`, {})).status).toBe(
        400,
      );
      expect((c.ai as { calls?: number }).calls).toBe(0);
      expect(
        (await c.request(`/contexts/${id}/investigate`, { approval: true }))
          .status,
      ).toBe(200);
      expect((c.ai as { calls?: number }).calls).toBe(1);
    } finally {
      await c.close();
    }
  });
});
describe('workspace confinement', () => {
  it('blocks traversal, credentials, deployment config and companion trust-boundary paths', () => {
    for (const p of [
      '../other.ts',
      '/tmp/a.ts',
      '.env',
      '.ssh/id_rsa',
      'src/secret.ts',
      'node_modules/a.ts',
      'apps/companion/src/server.ts',
      'packages/shared/src/index.ts',
      '.github/workflows/ci.yml',
      'infra/main.ts',
      'vite.config.ts',
    ])
      expect(allowedPath(p), p).toBe(false);
    expect(allowedPath('src/routes/investments.ts')).toBe(true);
  });
  it('rejects symlinks and ignores untracked, ignored and secret files', async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.root, 'src'));
      await symlink('/etc/passwd', join(f.root, 'src/escape.ts'));
      await writeFile(join(f.root, 'ignored.ts'), 'secret');
      await writeFile(join(f.root, '.env'), 'GEMINI_API_KEY=secret');
      await exec('git', ['add', 'src/escape.ts'], { cwd: f.root });
      await expect(f.workspace.read('src/escape.ts')).rejects.toThrow(
        'Symlinks',
      );
      expect(await f.workspace.files()).not.toContain('ignored.ts');
      await expect(
        f.workspace.discover(evidence, ['ignored.ts']),
      ).rejects.toThrow('tracked');
      await expect(f.workspace.read('.env')).rejects.toThrow('allowlist');
    } finally {
      await f.close();
    }
  });
  it('bounds subprocess time, output and cancellation without a shell', async () => {
    const timed = await runCommand(
      process.execPath,
      ['-e', 'setInterval(()=>{},100)'],
      { cwd: '/tmp', timeoutMs: 100 },
    );
    expect(timed.timedOut).toBe(true);
    const large = await runCommand(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(50000))"],
      { cwd: '/tmp', maxBytes: 1000 },
    );
    expect(large.truncated).toBe(true);
    expect(large.output.length).toBe(1000);
    const controller = new AbortController();
    const pending = runCommand(
      process.execPath,
      ['-e', 'setInterval(()=>{},100)'],
      { cwd: '/tmp', signal: controller.signal },
    );
    controller.abort();
    expect((await pending).cancelled).toBe(true);
  });
});
