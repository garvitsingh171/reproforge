import { describe, it, expect, vi } from 'vitest';
import { IssueService, GitHubCLI, issueText } from '../src/github';
import { FakeGitHub, evidence } from './helpers';
import { safeEvidence } from '@reproforge/shared/integrations';
import type { CommandRunner } from '../src/process';
function cliResult(code: number, output: string): CommandRunner {
  return vi.fn(async () => ({
    code,
    output,
    timedOut: false,
    cancelled: false,
    durationMs: 1,
    truncated: false,
  }));
}
describe('GitHub issue integration', () => {
  it('returns confirmed issue URL and prevents repeated publication', async () => {
    const gh = new FakeGitHub(),
      service = new IssueService(gh);
    const d = await service.prepare(
      'example/demo',
      'Valid title',
      'Synthetic body',
      ['bug'],
    );
    await expect(service.publish(d.id, false)).rejects.toThrow('approve');
    expect(await service.publish(d.id, true)).toEqual({
      number: 42,
      url: 'https://github.com/example/demo/issues/42',
    });
    expect(await service.publish(d.id, true)).toEqual(d.result);
    expect(gh.issues).toBe(1);
    const second = await service.prepare(
      'example/demo',
      'Valid title',
      'Synthetic body',
      ['bug'],
    );
    await expect(service.publish(second.id, true)).rejects.toThrow('Identical');
  });
  it('rejects invalid title, disabled issues, missing permissions and unknown labels', async () => {
    const gh = new FakeGitHub(),
      service = new IssueService(gh);
    await expect(
      service.prepare('example/demo', '', 'body', []),
    ).rejects.toThrow('Title');
    await expect(
      service.prepare('example/demo', 'Title', 'body', ['missing']),
    ).rejects.toThrow('existing');
    vi.spyOn(gh, 'repository').mockResolvedValue({
      fullName: 'example/demo',
      issuesEnabled: false,
      canPush: false,
      defaultBranch: 'main',
      labels: [],
    });
    await expect(
      service.prepare('example/demo', 'Title', 'body', []),
    ).rejects.toThrow('disabled');
  });
  it('keeps uncertain publication non-retryable instead of making duplicates', async () => {
    const gh = new FakeGitHub(),
      service = new IssueService(gh);
    vi.spyOn(gh, 'createIssue').mockRejectedValue(
      new Error('network disconnected'),
    );
    const d = await service.prepare('example/demo', 'Title', 'body', []);
    await expect(service.publish(d.id, true)).rejects.toThrow();
    await expect(service.publish(d.id, true)).rejects.toThrow('uncertain');
    expect(gh.createIssue).toHaveBeenCalledOnce();
  });
  it('removes captured credentials and PII from generated issue evidence', () => {
    const safe = safeEvidence({
      ...evidence,
      path: '/api/investments?token=QUERY_SECRET',
      body: { password: 'BODY_SECRET', symbol: 'DEMO', amount: 100 },
      headers: { authorization: 'Bearer HEADER_SECRET' },
      response: { email: 'person@example.com' },
    });
    const draft = JSON.stringify(issueText(safe));
    for (const s of [
      'QUERY_SECRET',
      'BODY_SECRET',
      'HEADER_SECRET',
      'person@example.com',
    ])
      expect(draft).not.toContain(s);
    expect(draft).toContain('not been independently established');
  });
  it.each([
    [401, 'gh: HTTP 401', 'authentication'],
    [403, 'gh: HTTP 403', 'permission'],
    [404, 'gh: HTTP 404', 'unavailable'],
    [429, 'gh: rate limit HTTP 429', 'rate limit'],
  ])(
    'classifies GitHub %s without exposing raw errors',
    async (_code, text, expected) => {
      const cli = new GitHubCLI('/tmp', cliResult(1, text as string));
      await expect(cli.account()).rejects.toThrow(
        new RegExp(String(expected), 'i'),
      );
    },
  );
  it('uses JSON stdin, bounded argv and validates the returned resource URL', async () => {
    const runner = cliResult(
      0,
      JSON.stringify({
        number: 7,
        html_url: 'https://github.com/example/demo/issues/7',
      }),
    );
    const cli = new GitHubCLI('/tmp', runner);
    expect(
      (
        await cli.createIssue(
          'example/demo',
          '$(touch /tmp/never)',
          'literal `text`',
          [],
        )
      ).number,
    ).toBe(7);
    expect(runner).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--input', '-']),
      expect.objectContaining({
        input: JSON.stringify({
          title: '$(touch /tmp/never)',
          body: 'literal `text`',
          labels: [],
        }),
      }),
    );
    const bad = new GitHubCLI(
      '/tmp',
      cliResult(
        0,
        JSON.stringify({ number: 7, html_url: 'https://evil.test/7' }),
      ),
    );
    await expect(
      bad.createIssue('example/demo', 'title', 'body', []),
    ).rejects.toThrow('unexpected');
  });
});
