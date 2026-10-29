import { useState } from 'react';
import { ArrowUpRight, ShieldCheck, Clock, AlertTriangle } from 'lucide-react';
import type { DiagnosticRecord, BodyPreview } from '@reproforge/shared';
import { CodeBlock } from './CodeBlock';
import { TestBuilder } from '../features/test-builder/TestBuilder';
const statuses: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};
function Body({ body }: { body: BodyPreview }) {
  return body.state === 'available' ? (
    <CodeBlock
      text={JSON.stringify(body.data, null, 2)}
      label="Sanitized JSON"
    />
  ) : (
    <p className="notice">{body.reason}</p>
  );
}
export function Inspector({
  record,
  onPreview,
}: {
  record: DiagnosticRecord;
  onPreview: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState('Overview');
  const [loading, setLoading] = useState(false);
  return (
    <section className="inspector" aria-label="Request inspector">
      <div className="inspector-heading">
        <div className="row">
          <span className="method">{record.method}</span>
          <span className="status-badge">
            {record.status} {statuses[record.status] ?? 'HTTP failure'}
          </span>
        </div>
        <h1 title={record.path}>{record.path}</h1>
        <p className="muted mono">{record.url}</p>
      </div>
      <nav className="tabs" aria-label="Inspector tabs">
        {['Overview', 'Request', 'Response', 'Test Builder'].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Test Builder' && <ArrowUpRight size={13} />}
          </button>
        ))}
      </nav>
      <div className="inspector-content">
        {tab === 'Overview' && (
          <>
            <p className="eyebrow">REQUEST AT A GLANCE</p>
            <div className="metrics">
              <div>
                <span>HTTP status</span>
                <strong className="failure">{record.status}</strong>
              </div>
              <div>
                <span>
                  <Clock size={12} /> Duration
                </span>
                <strong>
                  {record.duration === undefined
                    ? 'Unknown'
                    : `${record.duration} ms`}
                </strong>
              </div>
              <div>
                <span>Content type</span>
                <strong className="small">{record.contentType}</strong>
              </div>
            </div>
            <dl>
              <dt>Captured at</dt>
              <dd>{new Date(record.timestamp).toLocaleTimeString()}</dd>
              <dt>Request body</dt>
              <dd>{record.requestBody.state}</dd>
              <dt>Response preview</dt>
              <dd>{record.responseBody.state}</dd>
              <dt>Authentication</dt>
              <dd>
                {record.needsAuth
                  ? 'Detected · credentials excluded'
                  : 'Not detected'}
              </dd>
            </dl>
            <div className="next-step">
              <FileIcon />
              <h2>What should have happened?</h2>
              <p>
                Define the expected status and create an executable regression
                test for your fix.
              </p>
              <button
                className="primary"
                onClick={() => setTab('Test Builder')}
              >
                Build regression test <ArrowUpRight size={14} />
              </button>
            </div>
            <h3>
              <ShieldCheck size={15} /> Privacy notes
            </h3>
            {record.warnings.map((w) => (
              <p className="notice" key={w}>
                {w}
              </p>
            ))}
          </>
        )}
        {tab === 'Request' && (
          <>
            <h3>Safe request headers</h3>
            <CodeBlock text={JSON.stringify(record.requestHeaders, null, 2)} />
            <h3>Request body</h3>
            <Body body={record.requestBody} />
            <p className="hint">
              Credentials, unknown fields, personal data and all captured query
              values are excluded. Use synthetic fixtures for missing data.
            </p>
          </>
        )}
        {tab === 'Response' && (
          <>
            <h3>Response preview</h3>
            <p className="muted">
              JSON only, up to 16 KiB. No response body is loaded automatically.
            </p>
            {record.responseBody.state === 'not-loaded' ? (
              <button
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await onPreview(record.id);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                {loading ? 'Loading…' : 'Load sanitized preview'}
              </button>
            ) : (
              <Body body={record.responseBody} />
            )}
            <div className="info">
              <AlertTriangle size={15} />
              <span>
                Previews are diagnostics, not complete responses. Unsupported,
                invalid and oversized bodies are excluded.
              </span>
            </div>
          </>
        )}
        <div hidden={tab !== 'Test Builder'}>
          <TestBuilder record={record} />
        </div>
      </div>
    </section>
  );
}
function FileIcon() {
  return (
    <span className="step-icon">
      <ArrowUpRight size={22} />
    </span>
  );
}
