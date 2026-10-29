import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, evidence, correction } from './helpers';
import { safeEvidence } from '@reproforge/shared/integrations';
import { PatchService } from '../src/patches';
import { Verifier, sandboxArgs } from '../src/verification';
import { runCommand, type CommandRunner } from '../src/process';
describe('verification execution boundary', () => {
  it('rejects execution without approval and blocks unavailable isolation without running project code', async () => {
    const f = await fixture(),
      p = new PatchService(f.workspace);
    try {
      const c = await f.workspace.discover(safeEvidence(evidence)),
        fix = p.propose(c, correction(c));
      await p.stage(fix.id, true);
      const runner: CommandRunner = vi.fn(async () => ({
        code: 1,
        output: 'namespace denied',
        timedOut: false,
        cancelled: false,
        truncated: false,
        durationMs: 1,
      }));
      const v = new Verifier(p, 'demo-investments', runner);
      await expect(v.start(fix.id, c, false)).rejects.toThrow('Approve');
      const job = await v.start(fix.id, c, true);
      await vi.waitFor(() => expect(job.status).toBe('blocked'));
      expect(runner).toHaveBeenCalledOnce();
      expect(job.readyForHumanReview).toBe(false);
    } finally {
      await p.close();
      await f.close();
    }
  });
  it('uses read-only files, separate network, credential-free environment and fixed commands', () => {
    const args = sandboxArgs('/tmp/stage', '/usr/bin/node', '/tmp/deps', [
      '/reproforge-node',
      'test.mjs',
    ]);
    expect(args).toContain('--unshare-all');
    expect(args).toContain('--clearenv');
    expect(args).not.toContain('GEMINI_API_KEY');
    expect(args).toContain('--ro-bind');
    expect(args).not.toContain('--share-net');
  });
  it('reports real red-to-green with the same source mode and preserves the original workspace', async () => {
    const f = await fixture(),
      p = new PatchService(f.workspace),
      v = new Verifier(p, 'demo-investments');
    try {
      const original = await readFile(
        join(f.root, 'apps/demo-api/src/app.ts'),
        'utf8',
      );
      const c = await f.workspace.discover(safeEvidence(evidence)),
        fix = p.propose(c, correction(c));
      await p.stage(fix.id, true);
      const job = await v.start(fix.id, c, true);
      await vi.waitFor(() => expect(job.status).not.toBe('running'), {
        timeout: 20000,
      });
      expect(job.status, JSON.stringify(job)).toBe('passed');
      expect(job.checks.map((x) => x.exitCode)).toEqual([1, 0, 0]);
      expect(
        await readFile(join(f.root, 'apps/demo-api/src/app.ts'), 'utf8'),
      ).toBe(original);
      const stage = await p.assertStage(fix.id);
      expect(
        await readFile(
          join(stage.baseline, '.reproforge/regression.test.ts'),
          'utf8',
        ),
      ).toBe(
        await readFile(
          join(stage.patched, '.reproforge/regression.test.ts'),
          'utf8',
        ),
      );
    } finally {
      await v.close();
      await p.close();
      await f.close();
    }
  }, 25000);
  it('does not label an incorrect source patch as verified', async () => {
    const f = await fixture(),
      p = new PatchService(f.workspace),
      v = new Verifier(p, 'demo-investments');
    try {
      const c = await f.workspace.discover(safeEvidence(evidence));
      const fix = p.propose(c, {
        ...correction(c),
        edits: [
          {
            path: 'apps/demo-api/src/app.ts',
            before: "code: 'INVALID_INTERVAL'",
            after: "code: 'STILL_INVALID'",
            explanation: 'Intentionally ineffective test fixture',
          },
        ],
      });
      await p.stage(fix.id, true);
      const job = await v.start(fix.id, c, true);
      await vi.waitFor(() => expect(job.status).not.toBe('running'), {
        timeout: 20000,
      });
      expect(job.status).toBe('failed');
      expect(job.readyForHumanReview).toBe(false);
      expect(job.checks[1]?.exitCode).toBe(1);
    } finally {
      await v.close();
      await p.close();
      await f.close();
    }
  }, 25000);
  it('cannot see host credentials or use external networking from the sandbox', async () => {
    const f = await fixture(),
      p = new PatchService(f.workspace);
    try {
      const c = await f.workspace.discover(safeEvidence(evidence));
      const fix = p.propose(c, correction(c));
      await p.stage(fix.id, true);
      const stage = await p.assertStage(fix.id);
      const args = [
        '--unshare-all',
        '--die-with-parent',
        '--ro-bind',
        '/usr',
        '/usr',
        '--ro-bind',
        '/lib',
        '/lib',
        '--ro-bind',
        '/lib64',
        '/lib64',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--clearenv',
        '--ro-bind',
        process.execPath,
        '/node',
        '/node',
        '-e',
        "const fs=require('fs');if(fs.existsSync('/home/garvitsingh171/.ssh')||process.env.GEMINI_API_KEY)process.exit(2);fetch('http://192.0.2.1',{signal:AbortSignal.timeout(500)}).then(()=>process.exit(3)).catch(()=>console.log('isolated'));",
      ];
      const result = await runCommand('bwrap', args, {
        cwd: stage.baseline,
        timeoutMs: 3000,
      });
      expect(result.code).toBe(0);
      expect(result.output).toContain('isolated');
    } finally {
      await p.close();
      await f.close();
    }
  });
});
