import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  repoSchema,
  repositorySchema,
  scrubText,
  type FailureEvidence,
  type GitHubResource,
  type IssueDraft,
  type RepositoryInfo,
} from '@reproforge/shared/integrations';
import { runCommand, type CommandRunner } from './process';
import { invariant, CompanionError } from './errors';
import { hash } from './workspace';
export interface GitHubAdapter {
  account(): Promise<string>;
  repository(repo: string): Promise<RepositoryInfo>;
  matches(repo: string, title: string): Promise<IssueDraft['matches']>;
  createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[],
  ): Promise<GitHubResource>;
  createPR(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<GitHubResource>;
  branchExists(repo: string, branch: string): Promise<boolean>;
  branchCommit(repo: string, branch: string): Promise<string>;
}
export class GitHubCLI implements GitHubAdapter {
  constructor(
    private cwd: string,
    private runner: CommandRunner = runCommand,
  ) {}
  async api(path: string, method = 'GET', data?: unknown): Promise<unknown> {
    // Parse transient machine JSON before projecting validated fields; never log raw CLI output.
    const result = await this.runner(
      'gh',
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        method,
        path,
        ...(data === undefined ? [] : ['--input', '-']),
      ],
      {
        cwd: this.cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
          GH_TOKEN: process.env.GH_TOKEN,
          GH_HOST: 'github.com',
          GH_PROMPT_DISABLED: '1',
          LANG: 'C.UTF-8',
        },
        input: data === undefined ? undefined : JSON.stringify(data),
        timeoutMs: 25000,
        maxBytes: 128000,
        redactOutput: false,
      },
    );
    if (result.code !== 0) {
      const text = result.output;
      if (result.timedOut)
        throw new CompanionError(
          'GITHUB_TIMEOUT',
          'GitHub timed out. Publication may be uncertain; inspect GitHub before retrying.',
          504,
        );
      if (result.truncated)
        throw new CompanionError(
          'GITHUB_LIMIT',
          'GitHub response exceeded the limit.',
          502,
        );
      if (/429|rate.?limit/i.test(text))
        throw new CompanionError(
          'GITHUB_RATE_LIMIT',
          'GitHub rate limit reached. Wait before retrying.',
          429,
        );
      if (/401|auth login|not logged|authentication/i.test(text))
        throw new CompanionError(
          'GITHUB_AUTH',
          'GitHub authentication is missing. Run gh auth login --hostname github.com in your terminal.',
          401,
        );
      if (/403|permission/i.test(text))
        throw new CompanionError(
          'GITHUB_PERMISSION',
          'Your GitHub account lacks permission for this operation.',
          403,
        );
      if (/404|not found/i.test(text))
        throw new CompanionError(
          'GITHUB_NOT_FOUND',
          'Repository or branch is unavailable to this account.',
          404,
        );
      throw new CompanionError(
        'GITHUB_UNAVAILABLE',
        'GitHub CLI is unavailable or GitHub could not complete the operation. Install gh and run gh auth login.',
        502,
      );
    }
    try {
      return JSON.parse(result.output);
    } catch {
      throw new CompanionError(
        'GITHUB_RESPONSE',
        'GitHub returned an invalid response.',
        502,
      );
    }
  }
  async account() {
    return z.object({ login: z.string() }).parse(await this.api('user')).login;
  }
  async repository(repo: string) {
    repoSchema.parse(repo);
    const info = z
      .object({
        full_name: repoSchema,
        has_issues: z.boolean(),
        archived: z.boolean(),
        default_branch: z.string(),
        permissions: z
          .object({
            push: z.boolean().optional(),
            pull: z.boolean().optional(),
          })
          .optional(),
      })
      .parse(await this.api(`repos/${repo}`));
    invariant(
      !info.archived,
      'ARCHIVED_REPOSITORY',
      'Archived repositories cannot receive issues or fixes.',
    );
    invariant(
      info.permissions?.pull,
      'GITHUB_PERMISSION',
      'Repository read permission is required.',
      403,
    );
    const labels = z
      .array(z.object({ name: z.string() }))
      .parse(await this.api(`repos/${repo}/labels?per_page=100`));
    return repositorySchema.parse({
      fullName: info.full_name,
      issuesEnabled: info.has_issues,
      canPush: !!info.permissions?.push,
      defaultBranch: info.default_branch,
      labels: labels.map((l) => l.name),
    });
  }
  async matches(repo: string, title: string) {
    const result = z
      .array(
        z.object({
          number: z.number(),
          html_url: z.string(),
          title: z.string(),
        }),
      )
      .parse(await this.api(`repos/${repo}/issues?state=open&per_page=30`));
    const words = title
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    return result
      .filter((i) => words.some((w) => i.title.toLowerCase().includes(w)))
      .slice(0, 5)
      .map((i) => ({
        number: i.number,
        url: i.html_url,
        title: scrubText(i.title),
      }));
  }
  private resource(
    input: unknown,
    repo: string,
    type: 'issues' | 'pull',
  ): GitHubResource {
    const value = z
      .object({ number: z.number().int().positive(), html_url: z.string() })
      .parse(input);
    invariant(
      value.html_url === `https://github.com/${repo}/${type}/${value.number}`,
      'GITHUB_RESPONSE',
      'GitHub returned an unexpected resource URL.',
      502,
    );
    return { number: value.number, url: value.html_url };
  }
  async createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[],
  ) {
    return this.resource(
      await this.api(`repos/${repo}/issues`, 'POST', { title, body, labels }),
      repo,
      'issues',
    );
  }
  async createPR(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ) {
    return this.resource(
      await this.api(`repos/${repo}/pulls`, 'POST', {
        title,
        body,
        head,
        base,
        draft: true,
      }),
      repo,
      'pull',
    );
  }
  async branchCommit(repo: string, branch: string) {
    return z
      .object({
        commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) }),
      })
      .parse(
        await this.api(`repos/${repo}/branches/${encodeURIComponent(branch)}`),
      ).commit.sha;
  }
  async branchExists(repo: string, branch: string) {
    try {
      await this.api(`repos/${repo}/branches/${encodeURIComponent(branch)}`);
      return true;
    } catch (e) {
      if (e instanceof CompanionError && e.code === 'GITHUB_NOT_FOUND')
        return false;
      throw e;
    }
  }
}
export function issueText(e: FailureEvidence) {
  return {
    title: `[Bug] ${e.method} ${e.path} returns ${e.observedStatus} instead of ${e.expectedStatus}`,
    body: `## Problem\nA captured ${e.method} request to ${e.path} returned HTTP ${e.observedStatus}.\n\n## Developer-confirmed expectation\n${e.expectation}\nExpected HTTP status: ${e.expectedStatus}. Request validity has not been independently established.\n\n## Steps to reproduce\n${e.steps || 'Add precise steps using synthetic test data.'}\n\n## Actual behavior\nHTTP ${e.observedStatus}.\n\n## Expected behavior\nHTTP ${e.expectedStatus}; ${e.expectation}\n\n## Sanitized request\n\`\`\`json\n${JSON.stringify({ method: e.method, path: e.path, headers: e.headers, body: e.body }, null, 2)}\n\`\`\`\n\n## Sanitized response\n\`\`\`json\n${JSON.stringify(e.response ?? { notice: 'No approved response preview supplied.' }, null, 2)}\n\`\`\`\n\n## Environment\n${e.environment || 'Developer to supply local/test environment details.'}\n\n## Regression test\n${e.regressionReference || 'Generate a developer-approved Vitest bundle in ReproForge. No test execution is claimed here.'}\n\nPrepared with ReproForge. Sanitized diagnostic evidence; root cause is unverified.`,
  };
}
export class IssueService {
  private drafts = new Map<string, IssueDraft>();
  private fingerprints = new Map<string, string>();
  constructor(private github: GitHubAdapter) {}
  clear() {
    this.drafts.clear();
    this.fingerprints.clear();
  }
  async prepare(repo: string, title: string, body: string, labels: string[]) {
    repoSchema.parse(repo);
    invariant(
      this.drafts.size < 50,
      'SESSION_LIMIT',
      'Clear the companion session before preparing more drafts.',
    );
    title = scrubText(title).trim();
    body = scrubText(body);
    invariant(
      title.length >= 3 && title.length <= 240 && body.length <= 20000,
      'INVALID_DRAFT',
      'Title must be 3–240 characters and body at most 20,000.',
    );
    const info = await this.github.repository(repo);
    invariant(
      info.issuesEnabled,
      'ISSUES_DISABLED',
      'Issues are disabled for this repository.',
    );
    invariant(
      labels.every((l) => info.labels.includes(l)),
      'INVALID_LABEL',
      'Use only existing repository labels.',
    );
    const id = randomUUID();
    const draft: IssueDraft = {
      id,
      repo: info.fullName,
      title,
      body: body + `\n\n<!-- reproforge:${id} -->`,
      labels,
      matches: await this.github.matches(info.fullName, title),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      state: 'prepared',
    };
    this.drafts.set(id, draft);
    return draft;
  }
  async publish(id: string, approval: boolean) {
    invariant(
      approval,
      'APPROVAL_REQUIRED',
      'Review the exact issue and explicitly approve publication.',
      403,
    );
    const d = this.drafts.get(id);
    invariant(d, 'DRAFT_MISSING', 'Prepare an issue draft first.', 404);
    if (d.state === 'created') return d.result!;
    invariant(
      d.state === 'prepared',
      'PUBLICATION_UNCERTAIN',
      'This publication is in progress or uncertain. Inspect GitHub; do not retry blindly.',
      409,
    );
    invariant(
      Date.parse(d.expiresAt) > Date.now(),
      'DRAFT_EXPIRED',
      'Review a new issue draft.',
      409,
    );
    const fingerprint = hash(
      d.repo +
        '\n' +
        d.title +
        '\n' +
        d.body.replace(/\n\n<!-- reproforge:[^>]+ -->$/, ''),
    );
    invariant(
      !this.fingerprints.has(fingerprint),
      'DUPLICATE_ISSUE',
      'Identical content was already submitted in this session. Inspect the existing issue.',
      409,
    );
    this.fingerprints.set(fingerprint, id);
    d.state = 'publishing';
    try {
      const info = await this.github.repository(d.repo);
      invariant(
        info.issuesEnabled,
        'ISSUES_DISABLED',
        'Issues were disabled since review.',
      );
      d.result = await this.github.createIssue(
        d.repo,
        d.title,
        d.body,
        d.labels,
      );
      d.state = 'created';
      return d.result;
    } catch (error) {
      d.state = 'uncertain';
      throw error;
    }
  }
}
