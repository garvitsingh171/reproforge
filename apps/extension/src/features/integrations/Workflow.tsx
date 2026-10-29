import { useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  GitBranch,
  ScanSearch,
  GitPullRequest,
  Download,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import type { DiagnosticRecord, HttpMethod } from '@reproforge/shared';
import {
  contextSchema,
  investigationSchema,
  proposalSchema,
  verificationSchema,
  draftSchema,
  repositorySchema,
  resourceSchema,
  type ApprovedContext,
  type Investigation,
  type FixProposal,
  type Verification,
  type IssueDraft,
  type RepositoryInfo,
  type GitHubResource,
  type FailureEvidence,
} from '@reproforge/shared/integrations';
import { companionClient as client } from './client';
import { Approval } from './Approval';
import { CodeBlock } from '../../components/CodeBlock';
type Pending = {
  title: string;
  detail: string;
  data: unknown;
  action: string;
  run: () => Promise<void>;
};
function downloadPatch(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/x-diff' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reproforge-fix.patch';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function Workflow({
  record,
  view,
}: {
  record: DiagnosticRecord;
  view: 'AI Investigation' | 'Code Fix' | 'GitHub';
}) {
  const status = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [expected, setExpected] = useState(''),
    [expectation, setExpectation] = useState(''),
    [steps, setSteps] = useState(''),
    [environment, setEnvironment] = useState('');
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<Pending | null>(null);
  const [repo, setRepo] = useState(status?.remote ?? ''),
    [account, setAccount] = useState(''),
    [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [labels, setLabels] = useState<string[]>([]),
    [issue, setIssue] = useState<GitHubResource | null>(null),
    [draft, setDraft] = useState<IssueDraft | null>(null);
  const [context, setContext] = useState<ApprovedContext | null>(null),
    [files, setFiles] = useState<string[]>([]),
    [allFiles, setAllFiles] = useState<string[]>([]),
    [investigation, setInvestigation] = useState<Investigation | null>(null),
    [proposal, setProposal] = useState<FixProposal | null>(null),
    [report, setReport] = useState<Verification | null>(null);
  const [base, setBase] = useState(''),
    [prTitle, setPrTitle] = useState(''),
    [prBody, setPrBody] = useState(''),
    [pr, setPR] = useState<GitHubResource | null>(null);
  useEffect(() => {
    if (!status) {
      setContext(null);
      setInvestigation(null);
      setProposal(null);
      setReport(null);
      setIssue(null);
      setDraft(null);
      setPR(null);
      setPending(null);
      setBody('');
      setAccount('');
      setRepository(null);
    }
  }, [status]);
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy('');
    }
  };
  const evidence = (): FailureEvidence => {
    const code = Number(expected);
    if (
      !Number.isInteger(code) ||
      code < 100 ||
      code > 599 ||
      expectation.trim().length < 3
    )
      throw new Error(
        'Supply the expected HTTP status and explain the intended behavior.',
      );
    return {
      method: record.method as HttpMethod,
      path: record.path,
      observedStatus: record.status,
      expectedStatus: code,
      expectation,
      steps,
      environment,
      regressionReference:
        'Deterministic Vitest bundle available from ReproForge Test Builder.',
      body: record.requestBody.data,
      response: record.responseBody.data,
      headers: record.requestHeaders,
    };
  };
  const approve = (operation: Pending) => setPending(operation);
  useEffect(() => {
    if (!report || report.status !== 'running') return;
    let stopped = false;
    const timer = setInterval(() => {
      void client
        .request(`/verification/${report.id}`)
        .then(async (data) => {
          if (stopped) return;
          const next = verificationSchema.parse(data);
          const updated =
            next.status === 'passed' && proposal
              ? proposalSchema.parse(
                  await client.request(`/proposals/${proposal.id}`),
                )
              : null;
          if (stopped) return;
          if (updated) setProposal(updated);
          setReport(next);
        })
        .catch((e) => {
          if (!stopped)
            setError(
              e instanceof Error ? e.message : 'Verification polling failed.',
            );
        });
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [report?.id, report?.status, proposal?.id]);
  const discover = async (paths?: string[]) => {
    const next = contextSchema.parse(
      await client.request('/contexts', {
        evidence: evidence(),
        ...(paths ? { paths } : {}),
      }),
    );
    setContext(next);
    setFiles(next.files.map((f) => f.path));
    setInvestigation(null);
    setProposal(null);
    setReport(null);
  };
  const createTemplate = async () => {
    const data = z
      .object({ title: z.string(), body: z.string() })
      .parse(await client.request('/issues/template', evidence()));
    setTitle(data.title);
    setBody(data.body);
    setDraft(null);
  };
  const planPR = () => {
    if (!proposal) return;
    setPrTitle(`Fix ${record.method} ${record.path}`);
    setPrBody(
      `## Problem\n${expectation}\n\n## Investigation (AI hypotheses)\n${investigation?.summary ?? 'See reviewed evidence.'}\n\n## Change\n${proposal.summary}\n\n${proposal.files.map((f) => '- ' + f.path + ': ' + f.explanation).join('\n')}\n\n## Verification\n${report?.checks.map((c) => `${c.name}: ${c.status}, exit ${c.exitCode}`).join('\n') ?? 'Not run'}\n${report?.explanation ?? ''}\n\n## Related issue\n${issue?.url ?? 'None selected.'}\n\n## Limitations\n${proposal.risks.join('\n')}\n\nAI-assisted change, reviewed by the developer. No complete-correctness guarantee.`,
    );
  };
  if (!status)
    return (
      <div className="info">
        <ShieldCheck size={18} />
        <span>
          Pair with a local companion in Settings to use GitHub and AI
          workflows. Capture and test export remain available offline.
        </span>
      </div>
    );
  return (
    <section className="integration-page">
      <div className="integration-top">
        <span className="tag">
          {status.workspace.name} · {status.workspace.baseCommit.slice(0, 8)}
        </span>
        <span className="capture-status live">Local Companion Connected</span>
      </div>
      {(view === 'GitHub' || view === 'AI Investigation') && (
        <details open className="behavior-spec">
          <summary>Developer-confirmed expected behavior</summary>
          <div className="form-columns">
            <label>
              Expected HTTP status
              <input
                aria-label="Integration expected status"
                type="number"
                min="100"
                max="599"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </label>
            <label>
              Intended outcome
              <textarea
                aria-label="Intended outcome"
                value={expectation}
                onChange={(e) => setExpectation(e.target.value)}
                rows={2}
                placeholder="Explain why this synthetic request should succeed."
              />
            </label>
          </div>
          <label>
            Steps to reproduce
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Environment notes
            <input
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              placeholder="Local synthetic demo; no production services"
            />
          </label>
          <p className="hint">
            Observed: {record.method} {record.path} → {record.status}.
            Expectations are not inferred from this failure.
          </p>
        </details>
      )}
      {view === 'GitHub' && (
        <>
          <h2>
            <GitBranch size={18} /> GitHub issue
          </h2>
          <div className="form-columns">
            <label>
              Repository
              <input
                aria-label="GitHub repository"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  setRepository(null);
                  setDraft(null);
                }}
                placeholder="owner/repository"
              />
            </label>
            <button
              disabled={!!busy}
              onClick={() =>
                void run('Checking GitHub', async () => {
                  setAccount(
                    z
                      .object({ account: z.string() })
                      .parse(await client.request('/github/status')).account,
                  );
                  const info = repositorySchema.parse(
                    await client.request(
                      '/github/repository?repo=' + encodeURIComponent(repo),
                    ),
                  );
                  setRepository(info);
                  setBase(info.defaultBranch);
                })
              }
            >
              Check connection & repository
            </button>
          </div>
          {repository && (
            <p className="info">
              Signed in as {account} · {repository.fullName} · Issues{' '}
              {repository.issuesEnabled ? 'enabled' : 'disabled'} ·{' '}
              {repository.canPush
                ? 'push permission available'
                : 'issue-only access'}
            </p>
          )}
          <button
            disabled={!!busy}
            onClick={() => void run('Preparing issue', createTemplate)}
          >
            Create GitHub Issue
          </button>
          {body && (
            <>
              <label>
                Issue title
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDraft(null);
                  }}
                  maxLength={240}
                />
              </label>
              <label>
                Issue body
                <textarea
                  className="mono"
                  aria-label="Issue body"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setDraft(null);
                  }}
                  rows={14}
                />
              </label>
              {repository && (
                <label>
                  Existing labels (optional)
                  <select
                    multiple
                    value={labels}
                    onChange={(e) => {
                      setLabels(
                        [...e.target.selectedOptions].map((o) => o.value),
                      );
                      setDraft(null);
                    }}
                  >
                    {repository.labels.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                disabled={!!busy || !repository?.issuesEnabled}
                onClick={() =>
                  void run('Preparing exact issue preview', async () => {
                    const d = draftSchema.parse(
                      await client.request('/issues/prepare', {
                        repo,
                        title,
                        body,
                        labels,
                      }),
                    );
                    setDraft(d);
                    approve({
                      title: 'Publish GitHub issue',
                      detail:
                        'This exact title and body will leave your computer and be published in the selected repository. Review sanitized data and possible duplicate matches.',
                      data: d,
                      action: 'Create Issue',
                      run: async () => {
                        setIssue(
                          resourceSchema.parse(
                            await client.request(`/issues/${d.id}/publish`, {
                              approval: true,
                            }),
                          ),
                        );
                        setNotice('GitHub confirmed issue creation.');
                      },
                    });
                  })
                }
              >
                Review issue for publication
              </button>
            </>
          )}
          {draft?.matches.length ? (
            <div className="notice">
              Possible existing issues:
              {draft.matches.map((m) => (
                <p key={m.number}>
                  <a href={m.url} target="_blank" rel="noreferrer">
                    #{m.number} {m.title}
                  </a>
                </p>
              ))}
            </div>
          ) : null}
          {issue && (
            <a
              className="resource-link"
              href={issue.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} /> Open issue #{issue.number} in GitHub
            </a>
          )}
          <h3>
            <GitPullRequest size={16} /> Fix pull request
          </h3>
          <p className="hint">
            Requires a reviewed, verified proposal. Local branch creation,
            pushing, and opening a draft PR have separate approvals.
          </p>
          <label>
            Base branch
            <input value={base} onChange={(e) => setBase(e.target.value)} />
          </label>
          {proposal && (
            <>
              <CodeBlock
                label="Reviewed commit files"
                text={proposal.files.map((f) => f.diff).join('\n')}
              />
              <p>
                State: {proposal.state}{' '}
                {proposal.branch && `· ${proposal.branch}`}
              </p>
              <button
                disabled={!!busy || proposal.state !== 'branched'}
                onClick={() =>
                  approve({
                    title: 'Push reviewed fix branch',
                    detail:
                      'This uploads the reviewed commit to the confirmed GitHub origin. It never force-pushes or pushes to the base branch.',
                    data: {
                      repo,
                      base,
                      branch: proposal.branch,
                      commit: proposal.commit,
                      files: proposal.files.map((f) => f.path),
                      verification: report,
                    },
                    action: 'Approve push',
                    run: async () =>
                      setProposal(
                        proposalSchema.parse(
                          await client.request(
                            `/proposals/${proposal.id}/push`,
                            { repo, base, approval: true },
                          ),
                        ),
                      ),
                  })
                }
              >
                Approve push
              </button>
              <button disabled={proposal.state !== 'pushed'} onClick={planPR}>
                Create Fix PR
              </button>
              {prBody && (
                <>
                  <label>
                    PR title
                    <input
                      value={prTitle}
                      onChange={(e) => setPrTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    PR description
                    <textarea
                      className="mono"
                      rows={12}
                      value={prBody}
                      onChange={(e) => setPrBody(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void run('Preparing PR', async () => {
                        const d = z
                          .object({
                            id: z.string(),
                            title: z.string(),
                            body: z.string(),
                            repo: z.string(),
                            base: z.string(),
                          })
                          .passthrough()
                          .parse(
                            await client.request(
                              `/proposals/${proposal.id}/pr`,
                              { repo, base, title: prTitle, body: prBody },
                            ),
                          );
                        approve({
                          title: 'Open draft pull request',
                          detail:
                            'GitHub will receive this exact PR title and description. This does not merge or close any issue.',
                          data: d,
                          action: 'Create draft PR',
                          run: async () =>
                            setPR(
                              resourceSchema.parse(
                                await client.request(`/pulls/${d.id}/publish`, {
                                  approval: true,
                                }),
                              ),
                            ),
                        });
                      })
                    }
                  >
                    Review PR for publication
                  </button>
                </>
              )}
            </>
          )}
          {pr && (
            <a
              className="resource-link"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
            >
              Open PR #{pr.number} <ExternalLink size={14} />
            </a>
          )}
        </>
      )}
      {view === 'AI Investigation' && (
        <>
          <h2>
            <ScanSearch size={18} /> Investigate actual source
          </h2>
          <p className="muted">
            Find route and validation candidates locally. Review every file
            before sending anything to Gemini.
          </p>
          <button
            disabled={!!busy}
            onClick={() =>
              void run('Searching authorized source', () => discover())
            }
          >
            Find relevant source files
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              void run('Listing tracked source', async () =>
                setAllFiles(
                  z
                    .object({ files: z.array(z.string()) })
                    .parse(await client.request('/workspace/files')).files,
                ),
              )
            }
          >
            Choose source files
          </button>
          {allFiles.length > 0 && (
            <>
              <label>
                Up to six authorized files
                <select
                  multiple
                  value={files}
                  onChange={(e) =>
                    setFiles(
                      [...e.target.selectedOptions]
                        .map((o) => o.value)
                        .slice(0, 6),
                    )
                  }
                >
                  {allFiles.map((path) => (
                    <option key={path}>{path}</option>
                  ))}
                </select>
              </label>
              <button
                disabled={!!busy || !files.length}
                onClick={() =>
                  void run('Preparing selected context', () => discover(files))
                }
              >
                Preview selected context
              </button>
            </>
          )}
          {context && (
            <>
              <p className="warning">{context.warnings.join(' ')}</p>
              {context.files.map((f) => (
                <details key={f.path} className="source-preview">
                  <summary>
                    {f.path} {f.patchable ? '' : '· redacted / read-only'}
                  </summary>
                  <p className="hint">{f.reason}</p>
                  <CodeBlock
                    label="Approved source candidate"
                    text={f.content}
                  />
                </details>
              ))}
              <button
                className="primary"
                disabled={!!busy || !context.files.length}
                onClick={() =>
                  approve({
                    title: 'Send approved context to Gemini',
                    detail: `Provider: Gemini. Configured model: ${status.gemini.model ?? 'not configured'}. These exact source files and sanitized request details will leave your computer. Repository comments are untrusted evidence.`,
                    data: { task: 'investigation', context },
                    action: 'Investigate with AI',
                    run: async () => {
                      setInvestigation(
                        investigationSchema.parse(
                          await client.request(
                            `/contexts/${context.id}/investigate`,
                            { approval: true },
                          ),
                        ),
                      );
                      setProposal(null);
                    },
                  })
                }
              >
                Investigate with AI
              </button>
            </>
          )}
          {investigation && (
            <>
              <h3>Investigation complete · hypotheses, not verified causes</h3>
              <p>{investigation.summary}</p>
              {investigation.possibleRootCauses.map((cause, i) => (
                <article className="finding" key={i}>
                  <span className="tag">
                    {cause.confidence} confidence · not a probability
                  </span>
                  <p>{cause.description}</p>
                  {cause.evidence.map((e, j) => (
                    <div key={j}>
                      <strong className="mono">
                        {e.file}:{e.line}
                      </strong>
                      <CodeBlock label="Source evidence" text={e.quote} />
                      <p className="hint">{e.detail}</p>
                    </div>
                  ))}
                </article>
              ))}
              <p className="warning">
                {investigation.requiresMoreInformation
                  ? 'More information is required before making a confident fix.'
                  : 'Runtime context may still be missing. Verification has not run.'}
              </p>
              <ul>
                {investigation.recommendedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <p className="info">
                Open Code Fix to review the next AI request and generate a
                patch.
              </p>
            </>
          )}
        </>
      )}
      {view === 'Code Fix' && (
        <>
          <h2>Review a proposed code fix</h2>
          <p className="muted">
            A proposal changes nothing until you approve staging. Verification
            runs fixed checks in an isolated environment.
          </p>
          <button
            className="primary"
            disabled={
              !!busy ||
              !context ||
              !investigation ||
              report?.status === 'running'
            }
            onClick={() => {
              if (context && investigation)
                approve({
                  title: 'Generate minimal fix with Gemini',
                  detail:
                    'Send the approved context and investigation back to Gemini to propose exact source edits. No commands are accepted from the model.',
                  data: { task: 'fix', context, investigation },
                  action: proposal ? 'Regenerate proposal' : 'Generate Fix',
                  run: async () => {
                    setProposal(
                      proposalSchema.parse(
                        await client.request(`/contexts/${context.id}/fix`, {
                          approval: true,
                        }),
                      ),
                    );
                    setReport(null);
                  },
                });
            }}
          >
            {proposal ? 'Regenerate proposal' : 'Generate Fix'}
          </button>
          {!investigation && (
            <p className="notice">
              Complete AI Investigation with approved source context first.
            </p>
          )}
          {proposal && (
            <>
              <div className="preview-title">
                <h3>{proposal.summary}</h3>
                <span className="tag">{proposal.state}</span>
              </div>
              <p className="hint">
                {proposal.stageLocation
                  ? `Isolated copy: ${proposal.stageLocation}`
                  : 'Proposal only; source files have not changed.'}
              </p>
              <div className="changed-files">
                {proposal.files.map((f) => (
                  <a href={`#diff-${f.path.replace(/\W/g, '-')}`} key={f.path}>
                    {f.path} <span className="diff-added">+{f.added}</span>{' '}
                    <span className="diff-removed">−{f.removed}</span>
                  </a>
                ))}
              </div>
              {proposal.files.map((f) => (
                <details
                  open
                  key={f.path}
                  id={`diff-${f.path.replace(/\W/g, '-')}`}
                  className="diff-file"
                >
                  <summary>
                    {f.path} · +{f.added} −{f.removed}
                  </summary>
                  <p>{f.explanation}</p>
                  <div className="diff-code" tabIndex={0}>
                    {f.diff.split('\n').map((line, i) => (
                      <div
                        className={
                          line.startsWith('+')
                            ? 'diff-added'
                            : line.startsWith('-')
                              ? 'diff-removed'
                              : 'diff-context'
                        }
                        key={i}
                      >
                        <span className="line-number">{i + 1}</span>
                        <code>{line || ' '}</code>
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary>Before / after comparison</summary>
                    <div className="before-after">
                      <CodeBlock label="Before" text={f.before} />
                      <CodeBlock label="After" text={f.after} />
                    </div>
                  </details>
                </details>
              ))}
              <CodeBlock
                label="Unified patch · Copy"
                text={proposal.files.map((f) => f.diff).join('\n')}
              />
              <button
                onClick={() =>
                  downloadPatch(proposal.files.map((f) => f.diff).join('\n'))
                }
              >
                <Download size={14} /> Download patch
              </button>
              <div className="warning">
                {[...proposal.risks, ...proposal.assumptions].map((r, i) => (
                  <p key={i}>{r}</p>
                ))}
              </div>
              <h3>Suggested tests (not executable commands)</h3>
              <ul>
                {proposal.tests.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <div className="action-row">
                <button
                  disabled={!!busy || proposal.state !== 'proposed'}
                  onClick={() =>
                    approve({
                      title: 'Stage in isolated copy',
                      detail:
                        'Only an isolated source copy will change. The original working tree remains untouched. Hashes and base commit are checked again.',
                      data: proposal,
                      action: 'Stage in Sandbox',
                      run: async () =>
                        setProposal(
                          proposalSchema.parse(
                            await client.request(
                              `/proposals/${proposal.id}/stage`,
                              { approval: true },
                            ),
                          ),
                        ),
                    })
                  }
                >
                  Stage in Sandbox
                </button>
                <button
                  disabled={
                    !!busy ||
                    !['staged', 'verified'].includes(proposal.state) ||
                    report?.status === 'running'
                  }
                  onClick={() =>
                    void run('Preparing verification plan', async () => {
                      const plan = await client.request('/verification/plan');
                      approve({
                        title: 'Run isolated verification',
                        detail:
                          'Approve these fixed commands. No repository package scripts or model-generated commands run. External network and production credentials are unavailable.',
                        data: {
                          proposalId: proposal.id,
                          expected: context?.evidence,
                          plan,
                        },
                        action: 'Run Verification',
                        run: async () =>
                          setReport(
                            verificationSchema.parse(
                              await client.request(
                                `/proposals/${proposal.id}/verify`,
                                { approval: true },
                              ),
                            ),
                          ),
                      });
                    })
                  }
                >
                  Run Verification
                </button>
                <button
                  disabled={
                    !!busy ||
                    report?.status === 'running' ||
                    !['proposed', 'staged', 'verified'].includes(proposal.state)
                  }
                  onClick={() =>
                    void run('Discarding isolated proposal', async () => {
                      setProposal(
                        proposalSchema.parse(
                          await client.request(
                            `/proposals/${proposal.id}/reject`,
                            {},
                          ),
                        ),
                      );
                      setReport(null);
                    })
                  }
                >
                  Discard proposal
                </button>
              </div>
              {report && (
                <>
                  <h3>Verification: {report.status}</h3>
                  <p className="notice">{report.explanation}</p>
                  {report.status === 'running' && (
                    <button
                      onClick={() =>
                        void run('Cancelling', async () =>
                          setReport(
                            verificationSchema.parse(
                              await client.request(
                                `/verification/${report.id}/cancel`,
                                {},
                              ),
                            ),
                          ),
                        )
                      }
                    >
                      Cancel verification
                    </button>
                  )}
                  {report.checks.map((c, i) => (
                    <details key={i} open>
                      <summary>
                        {c.name} · {c.status} · exit {c.exitCode ?? 'none'} ·{' '}
                        {c.durationMs} ms
                      </summary>
                      <CodeBlock
                        label="Actual process output"
                        text={c.output}
                      />
                    </details>
                  ))}
                </>
              )}
              <button
                disabled={!!busy || proposal.state !== 'verified'}
                onClick={() =>
                  approve({
                    title: 'Create local fix branch and commit',
                    detail:
                      'Create a separate local fix branch containing the verified patch. Your current branch and working files stay untouched. No push occurs in this step.',
                    data: { proposal, verification: report },
                    action: 'Apply to Local Branch',
                    run: async () =>
                      setProposal(
                        proposalSchema.parse(
                          await client.request(
                            `/proposals/${proposal.id}/branch`,
                            { approval: true },
                          ),
                        ),
                      ),
                  })
                }
              >
                Apply to Local Branch
              </button>
              {proposal.branch && (
                <p className="info">
                  Local branch: {proposal.branch}. Review GitHub tab for
                  separately approved push and PR actions.
                </p>
              )}
            </>
          )}
        </>
      )}
      {busy && (
        <p className="info" role="status">
          {busy}…
        </p>
      )}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="info" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <Approval
          title={pending.title}
          detail={pending.detail}
          data={JSON.stringify(pending.data, null, 2)}
          action={pending.action}
          busy={!!busy}
          onCancel={() => setPending(null)}
          onApprove={() =>
            void run(pending.action, async () => {
              await pending.run();
              setPending(null);
            })
          }
        />
      )}
    </section>
  );
}
