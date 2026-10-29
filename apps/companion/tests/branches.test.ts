import { describe, it, expect, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, evidence, correction, FakeGitHub, exec } from './helpers';
import {
  safeEvidence,
  type Verification,
} from '@reproforge/shared/integrations';
import { PatchService } from '../src/patches';
import { BranchService } from '../src/branches';
import { runCommand, type CommandRunner } from '../src/process';
async function setup() {
  const f = await fixture(),
    patches = new PatchService(f.workspace),
    github = new FakeGitHub();
  const context = await f.workspace.discover(safeEvidence(evidence));
  const p = patches.propose(context, correction(context));
  await patches.stage(p.id, true);
  p.state = 'verified';
  patches.reports.set(p.id, {
    id: crypto.randomUUID(),
    proposalId: p.id,
    status: 'passed',
    readyForHumanReview: true,
    patchAppliedToSandbox: true,
    checks: [],
    explanation: 'Explicit mocked verification receipt for branch unit test.',
  } satisfies Verification);
  return { ...f, patches, p, github };
}
describe('controlled local branch / PR workflow', () => {
  it('requires approval and creates only a separate branch with the intended diff, preserving unrelated changes', async () => {
    const f = await setup();
    try {
      await writeFile(join(f.root, 'unrelated.txt'), 'user work');
      const service = new BranchService(f.workspace, f.patches, f.github);
      await expect(service.local(f.p.id, false)).rejects.toThrow('Approve');
      const branch = await service.local(f.p.id, true);
      expect(branch.branch).toMatch(/^fix\/reproforge-/);
      expect(
        (
          await exec('git', ['branch', '--show-current'], { cwd: f.root })
        ).stdout.trim(),
      ).toBe('main');
      const changed = (
        await exec('git', ['diff', '--name-only', 'main', branch.branch!], {
          cwd: f.root,
        })
      ).stdout.trim();
      expect(changed).toBe('apps/demo-api/src/app.ts');
      expect(
        (await exec('git', ['status', '--short'], { cwd: f.root })).stdout,
      ).toContain('unrelated.txt');
    } finally {
      await f.patches.close();
      await f.close();
    }
  });
  it('blocks branch collisions and unapproved pushes', async () => {
    const f = await setup();
    try {
      const service = new BranchService(f.workspace, f.patches, f.github);
      await exec('git', ['branch', `fix/reproforge-${f.p.id.slice(0, 8)}`], {
        cwd: f.root,
      });
      await expect(service.local(f.p.id, true)).rejects.toThrow(
        'already exists',
      );
      await expect(
        service.push(f.p.id, 'example/demo', 'main', false),
      ).rejects.toThrow('approval');
    } finally {
      await f.patches.close();
      await f.close();
    }
  });
  it('checks base, permissions and push failures; PR needs separate approval and returns confirmed URL', async () => {
    const f = await setup();
    try {
      const runner: CommandRunner = vi.fn(async (file, args, options) => {
        if (args.includes('ls-remote'))
          return {
            code: 0,
            output: f.p.baseCommit + '\trefs/heads/main\n',
            timedOut: false,
            cancelled: false,
            truncated: false,
            durationMs: 1,
          };
        if (args.includes('push'))
          return {
            code: 1,
            output: 'permission denied',
            timedOut: false,
            cancelled: false,
            truncated: false,
            durationMs: 1,
          };
        return runCommand(file, args, options);
      });
      const service = new BranchService(
        f.workspace,
        f.patches,
        f.github,
        runner,
      );
      await service.local(f.p.id, true);
      await expect(
        service.push(f.p.id, 'example/demo', 'missing', true),
      ).rejects.toThrow('base branch');
      await expect(
        service.push(f.p.id, 'example/demo', 'main', true),
      ).rejects.toThrow('Push failed');
      expect(f.p.state).toBe('branched');
      f.p.state = 'pushed';
      f.github.heads.set('main', f.p.baseCommit);
      f.github.heads.set(f.p.branch!, f.p.commit!);
      const d = await service.preparePR(
        f.p.id,
        'example/demo',
        'main',
        'Reviewed fix',
        'AI-assisted; mocked test results for this unit test.',
      );
      await expect(service.publishPR(d.id, false)).rejects.toThrow('Approve');
      f.github.heads.set(f.p.branch!, 'a'.repeat(40));
      await expect(service.publishPR(d.id, true)).rejects.toThrow('changed');
      expect(f.github.prs).toBe(0);
      f.github.heads.set(f.p.branch!, f.p.commit!);
      expect(await service.publishPR(d.id, true)).toEqual({
        number: 43,
        url: 'https://github.com/example/demo/pull/43',
      });
      expect(await service.publishPR(d.id, true)).toEqual({
        number: 43,
        url: 'https://github.com/example/demo/pull/43',
      });
      expect(f.github.prs).toBe(1);
      expect(JSON.stringify(vi.mocked(runner).mock.calls)).not.toContain(
        '--force',
      );
    } finally {
      await f.patches.close();
      await f.close();
    }
  });
});
