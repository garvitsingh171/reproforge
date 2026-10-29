import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  repoSchema,
  branchSchema,
  scrubText,
  type GitHubResource,
} from '@reproforge/shared/integrations';
import { Workspace } from './workspace';
import { PatchService } from './patches';
import { invariant } from './errors';
import {
  gitArgs,
  gitEnvironment,
  runCommand,
  type CommandRunner,
} from './process';
import type { GitHubAdapter } from './github';
export class BranchService {
  private prDrafts = new Map<
    string,
    {
      id: string;
      proposalId: string;
      repo: string;
      base: string;
      title: string;
      body: string;
      state: 'prepared' | 'submitting' | 'created' | 'uncertain';
      result?: GitHubResource;
    }
  >();
  constructor(
    private workspace: Workspace,
    private patches: PatchService,
    private github: GitHubAdapter,
    private runner: CommandRunner = runCommand,
  ) {}
  clear() {
    this.prDrafts.clear();
  }
  async local(id: string, approval: boolean) {
    invariant(
      approval,
      'APPROVAL_REQUIRED',
      'Approve creating a separate local branch and commit.',
      403,
    );
    const p = this.patches.get(id);
    invariant(
      p.state === 'verified' &&
        this.patches.reports.get(id)?.readyForHumanReview,
      'VERIFICATION_REQUIRED',
      'A passed verification report is required.',
      409,
    );
    await this.patches.current(p);
    await this.patches.assertStage(id);
    const branch = `fix/reproforge-${id.slice(0, 8)}`;
    const existing = await this.runner(
      'git',
      [...gitArgs, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: this.workspace.root, env: gitEnvironment() },
    );
    invariant(
      existing.code === 1,
      'BRANCH_COLLISION',
      'Fix branch already exists or cannot be checked. No branch was overwritten.',
      409,
    );
    // A private index and plumbing create a branch without checking out or touching user files.
    const temp = await mkdtemp(join(tmpdir(), 'reproforge-index-'));
    const env = { GIT_INDEX_FILE: join(temp, 'index') };
    try {
      await this.workspace.git(['read-tree', p.baseCommit], undefined, env);
      for (const file of p.files) {
        const committed = await this.workspace.git([
          'show',
          `${p.baseCommit}:${file.path}`,
        ]);
        invariant(
          committed === file.before,
          'UNCOMMITTED_TARGET',
          'A proposed file has uncommitted changes. Commit those changes yourself before promoting the fix.',
          409,
        );
        const mode = (
          await this.workspace.git(['ls-tree', p.baseCommit, '--', file.path])
        ).split(' ')[0];
        invariant(
          mode === '100644' || mode === '100755',
          'INVALID_FILE_MODE',
          'Only regular tracked files can be committed.',
        );
        const blob = (
          await this.workspace.git(
            ['hash-object', '-w', '--stdin', '--no-filters'],
            file.after,
          )
        ).trim();
        await this.workspace.git(
          [
            'update-index',
            '--add',
            '--cacheinfo',
            `${mode},${blob},${file.path}`,
          ],
          undefined,
          env,
        );
      }
      const tree = (
        await this.workspace.git(['write-tree'], undefined, env)
      ).trim();
      const commit = (
        await this.workspace.git(
          ['commit-tree', tree, '-p', p.baseCommit],
          `ReproForge: reviewed fix ${id.slice(0, 8)}\n\nAI-assisted patch; approved after isolated demo verification.\n`,
        )
      ).trim();
      await this.patches.current(p);
      await this.workspace.git([
        'update-ref',
        `refs/heads/${branch}`,
        commit,
        '0'.repeat(p.baseCommit.length),
      ]);
      p.branch = branch;
      p.commit = commit;
      p.state = 'branched';
      return p;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  async push(id: string, repo: string, base: string, approval: boolean) {
    invariant(
      approval,
      'APPROVAL_REQUIRED',
      'Explicit push approval is required.',
      403,
    );
    repoSchema.parse(repo);
    branchSchema.parse(base);
    const p = this.patches.get(id);
    invariant(
      p.state === 'branched' && p.branch && p.commit,
      'BRANCH_REQUIRED',
      'Create the reviewed local fix branch first.',
      409,
    );
    invariant(
      (await this.workspace.remote()) === repo,
      'REMOTE_MISMATCH',
      'Selected repository does not match the authorized origin.',
      409,
    );
    const info = await this.github.repository(repo);
    invariant(
      info.canPush,
      'GITHUB_PERMISSION',
      'Push permission is required.',
      403,
    );
    invariant(
      await this.github.branchExists(repo, base),
      'BASE_BRANCH',
      'The selected base branch does not exist.',
      409,
    );
    invariant(
      !(await this.github.branchExists(repo, p.branch)),
      'BRANCH_COLLISION',
      'Remote fix branch already exists. Never force-push.',
      409,
    );
    const current = (
      await this.workspace.git(['rev-parse', `refs/heads/${p.branch}`])
    ).trim();
    invariant(
      current === p.commit,
      'BRANCH_CHANGED',
      'The local branch changed after approval.',
      409,
    );
    // Ensure the chosen base is exactly the approved baseline; do not silently compare unrelated branches.
    const remote = await this.runner(
      'git',
      [
        ...gitArgs,
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        'ls-remote',
        `https://github.com/${repo}.git`,
        `refs/heads/${base}`,
      ],
      {
        cwd: this.workspace.root,
        env: { ...gitEnvironment(), GH_TOKEN: process.env.GH_TOKEN },
        timeoutMs: 25000,
      },
    );
    invariant(
      remote.code === 0 && remote.output.split(/\s+/)[0] === p.baseCommit,
      'BASE_CHANGED',
      'Remote base differs from the reviewed commit. Rebase and reinvestigate manually.',
      409,
    );
    const pushed = await this.runner(
      'git',
      [
        ...gitArgs,
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        'push',
        '--porcelain',
        `https://github.com/${repo}.git`,
        `${p.commit}:refs/heads/${p.branch}`,
      ],
      {
        cwd: this.workspace.root,
        env: { ...gitEnvironment(), GH_TOKEN: process.env.GH_TOKEN },
        timeoutMs: 30000,
      },
    );
    invariant(
      pushed.code === 0,
      'PUSH_FAILED',
      'Push failed or its result is uncertain. Inspect the remote before retrying; no force-push is attempted.',
      502,
    );
    p.state = 'pushed';
    return p;
  }
  async preparePR(
    id: string,
    repo: string,
    base: string,
    title: string,
    body: string,
  ) {
    repoSchema.parse(repo);
    branchSchema.parse(base);
    const p = this.patches.get(id);
    invariant(
      p.state === 'pushed' && p.branch,
      'PUSH_REQUIRED',
      'Push the approved fix branch before preparing a PR.',
    );
    invariant(
      (await this.workspace.remote()) === repo,
      'REMOTE_MISMATCH',
      'Repository does not match the authorized remote.',
    );
    const info = await this.github.repository(repo);
    invariant(
      info.canPush && (await this.github.branchExists(repo, base)),
      'BASE_BRANCH',
      'Check repository permissions and base branch.',
    );
    invariant(
      (await this.github.branchCommit(repo, p.branch)) === p.commit &&
        (await this.github.branchCommit(repo, base)) === p.baseCommit,
      'REMOTE_CHANGED',
      'Remote branch or base changed since verification; review again.',
      409,
    );
    invariant(
      title.trim().length >= 3 && title.length <= 240 && body.length <= 20000,
      'INVALID_PR',
      'Check the PR title and body lengths.',
    );
    invariant(
      !/\b(?:closes|fixes|resolves)\s+(?:[\w.-]+\/[\w.-]+)?#\d+/i.test(body),
      'ISSUE_CLOSURE',
      'Automatic issue-closing keywords are excluded in this MVP. Link the issue without closing it.',
    );
    const draft = {
      id: randomUUID(),
      proposalId: id,
      repo,
      base,
      title: scrubText(title),
      body: scrubText(body),
      state: 'prepared' as const,
    };
    this.prDrafts.set(draft.id, draft);
    return draft;
  }
  async publishPR(id: string, approval: boolean) {
    invariant(
      approval,
      'APPROVAL_REQUIRED',
      'Approve opening this exact draft PR separately from pushing.',
      403,
    );
    const d = this.prDrafts.get(id);
    invariant(d, 'PR_DRAFT', 'Prepare a PR draft first.');
    if (d.state === 'created') return d.result!;
    invariant(
      d.state === 'prepared',
      'PR_UNCERTAIN',
      'PR creation is pending or uncertain. Inspect GitHub before retrying.',
      409,
    );
    const p = this.patches.get(d.proposalId);
    invariant(
      p.state === 'pushed' && p.branch,
      'PUSH_REQUIRED',
      'The reviewed branch must be pushed.',
    );
    invariant(
      (await this.github.branchCommit(d.repo, p.branch)) === p.commit &&
        (await this.github.branchCommit(d.repo, d.base)) === p.baseCommit,
      'REMOTE_CHANGED',
      'Remote branch or base changed since PR review.',
      409,
    );
    d.state = 'submitting';
    try {
      d.result = await this.github.createPR(
        d.repo,
        d.title,
        d.body,
        p.branch,
        d.base,
      );
      d.state = 'created';
      p.state = 'pr-created';
      return d.result;
    } catch (error) {
      d.state = 'uncertain';
      throw error;
    }
  }
}
