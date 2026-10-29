import { useMemo, useState } from 'react';
import { ZodError } from 'zod';
import { ArrowRight, Download, FileCode2, ShieldCheck, X } from 'lucide-react';
import { generateProject, projectZip } from '@reproforge/test-generator';
import type { DiagnosticRecord } from '@reproforge/shared';
import { CodeBlock } from '../../components/CodeBlock';
import { downloadZip } from '../../lib/download';
export function TestBuilder({ record }: { record: DiagnosticRecord }) {
  const [expected, setExpected] = useState('');
  const [title, setTitle] = useState(
    `${record.method} ${record.path} returns the expected status`,
  );
  const [description, setDescription] = useState('');
  const [body, setBody] = useState(
    record.requestBody.state === 'available'
      ? JSON.stringify(record.requestBody.data, null, 2)
      : '',
  );
  const [query, setQuery] = useState('{}');
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [auth, setAuth] = useState<'none' | 'bearer' | 'api-key'>(
    record.needsAuth ? 'bearer' : 'none',
  );
  const [allowDelete, setAllowDelete] = useState(false);
  const [confirmSameStatus, setConfirmSameStatus] = useState(false);
  const [review, setReview] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState('regression.test.ts');
  const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(record.method);
  const result = useMemo(() => {
    if (!expected)
      return { error: 'Enter the expected status to define correct behavior.' };
    if (mutation && record.requestBody.state === 'excluded' && !body.trim())
      return {
        error:
          'This captured body cannot be converted safely. Supply a complete synthetic JSON fixture only if the endpoint accepts JSON, or write a dedicated test manually.',
      };
    try {
      const parsedQuery: unknown = JSON.parse(query);
      if (
        !parsedQuery ||
        Array.isArray(parsedQuery) ||
        typeof parsedQuery !== 'object'
      )
        throw new Error('Query parameters must be a JSON object.');
      const project = generateProject({
        method: record.method as import('@reproforge/shared').HttpMethod,
        path: record.path,
        observedStatus: record.status,
        expectedStatus: Number(expected),
        title,
        description,
        ...(mutation && body.trim()
          ? { body: JSON.parse(body) as unknown }
          : {}),
        bodyRequired: mutation && record.method !== 'DELETE',
        headers: includeHeaders ? record.requestHeaders : {},
        query: parsedQuery as Record<string, string>,
        auth,
        allowDelete,
        confirmSameStatus,
      });
      return { project };
    } catch (error) {
      return {
        error:
          error instanceof ZodError
            ? error.issues.map((issue) => issue.message).join(' ')
            : error instanceof Error
              ? error.message
              : 'Check your test inputs.',
      };
    }
  }, [
    expected,
    title,
    description,
    body,
    query,
    includeHeaders,
    auth,
    allowDelete,
    confirmSameStatus,
    record,
    mutation,
  ]);
  const project = result.project;
  const exportBundle = async () => {
    if (!project || !approved) return;
    setBusy(true);
    setNotice('');
    try {
      downloadZip(await projectZip(project), 'reproforge-regression.zip');
      setNotice(
        'Download requested. Configure the test environment before running.',
      );
      setReview(false);
    } catch {
      setNotice('Could not create the ZIP. Try exporting again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="builder">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DEFINE CORRECT BEHAVIOR</p>
          <h2>Turn this failure into a test.</h2>
        </div>
        <FileCode2 size={24} />
      </div>
      <p className="muted">
        You define the outcome. ReproForge writes the test. Nothing runs from
        this panel.
      </p>
      <div className="status-transition">
        <div>
          <span>Observed</span>
          <strong className="failure">{record.status}</strong>
        </div>
        <ArrowRight size={20} />
        <label>
          Expected status
          <input
            aria-label="Expected status"
            type="number"
            min="100"
            max="599"
            placeholder="e.g. 201"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </label>
      </div>
      <label>
        Test title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
        />
      </label>
      <label>
        Description <span className="muted">optional</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          placeholder="Describe the intended behavior using non-sensitive information."
        />
      </label>
      {mutation && record.requestBody.state === 'excluded' && (
        <p className="warning">
          {record.requestBody.reason} Form, binary and multipart replay is
          unsupported. A replacement JSON fixture requires an endpoint that
          accepts JSON.
        </p>
      )}
      {mutation && (
        <label>
          Synthetic JSON fixture
          <textarea
            aria-label="Synthetic JSON fixture"
            className="mono"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave blank to require TEST_FIXTURE_JSON at runtime."
          />
          <span className="hint">
            Remove fields before export. Unrecognized fields are redacted again;
            use TEST_FIXTURE_JSON for a complete fixture.
          </span>
        </label>
      )}
      <details>
        <summary>Safe parameters & authentication</summary>
        <label>
          Approved query parameters
          <textarea
            className="mono"
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="hint">
            page, limit, offset: up to 4 digits. sort/order/format: asc, desc,
            json, amount, price, date.
          </span>
        </label>
        <label>
          Test authentication
          <select
            value={auth}
            onChange={(e) => setAuth(e.target.value as typeof auth)}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer · TEST_AUTH_TOKEN</option>
            <option value="api-key">X-API-Key · TEST_AUTH_TOKEN</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={includeHeaders}
            onChange={(e) => setIncludeHeaders(e.target.checked)}
          />
          Include safe MIME headers
        </label>
      </details>
      {record.method === 'DELETE' && (
        <label className="check warning">
          <input
            type="checkbox"
            checked={allowDelete}
            onChange={(e) => setAllowDelete(e.target.checked)}
          />
          I explicitly approve generating this DELETE test for disposable data.
        </label>
      )}
      {Number(expected) === record.status && (
        <label className="check warning">
          <input
            type="checkbox"
            checked={confirmSameStatus}
            onChange={(e) => setConfirmSameStatus(e.target.checked)}
          />
          This status is intentionally correct for my test case; it does not
          prove this failure is fixed.
        </label>
      )}
      <div className="info">
        <ShieldCheck size={16} />
        <span>
          Set <code>TEST_BASE_URL</code> after download. Only loopback and
          explicitly allowlisted HTTPS <code>.test</code> origins are accepted.
          Redirects are blocked.
        </span>
      </div>
      {result.error && (
        <p className="validation" role="status">
          {result.error}
        </p>
      )}
      {project && (
        <>
          <div className="preview-title">
            <h3>Generated test</h3>
            <span className="tag">
              {project.needsConfiguration
                ? 'Fixtures required'
                : 'Ready to configure target'}
            </span>
          </div>
          {project.warnings.map((w) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
          <CodeBlock text={project.code} label="regression.test.ts" />
        </>
      )}
      <button
        className="primary export-button"
        disabled={!project}
        onClick={() => {
          setReview(true);
          setApproved(false);
        }}
      >
        <Download size={15} /> Review & export bundle
      </button>
      <p className="hint">
        TypeScript · Vitest · Native fetch · No AI required
      </p>
      {notice && (
        <p role="status" className="info">
          {notice}
        </p>
      )}
      {review && project && (
        <div className="modal-backdrop">
          <dialog
            ref={(node) => {
              if (node && !node.open) node.showModal();
            }}
            onCancel={() => setReview(false)}
            aria-modal="true"
            aria-labelledby="review-title"
            className="review-dialog"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setReview(false);
            }}
          >
            <header>
              <h2 id="review-title">Review exact export</h2>
              <button
                aria-label="Cancel export"
                autoFocus
                onClick={() => setReview(false)}
              >
                <X size={18} />
              </button>
            </header>
            <p className="warning">
              Network data can be sensitive. Inspect every file below. Cancel to
              remove fields in the builder. Captured responses and origins are
              excluded.
            </p>
            <CodeBlock
              text={JSON.stringify(project.review, null, 2)}
              label="Approved test inputs"
            />
            <label>
              Bundle file
              <select value={file} onChange={(e) => setFile(e.target.value)}>
                {Object.keys(project.files).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <CodeBlock text={project.files[file] ?? ''} label={file} />
            <label className="check">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed these files and approve exporting this data for an
              authorized test environment.
            </label>
            <footer>
              <button onClick={() => setReview(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!approved || busy}
                onClick={() => void exportBundle()}
              >
                <Download size={15} />
                {busy ? 'Creating ZIP…' : 'Download ZIP'}
              </button>
            </footer>
          </dialog>
        </div>
      )}
    </div>
  );
}
