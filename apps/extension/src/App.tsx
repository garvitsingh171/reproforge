import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  Pause,
  Play,
  Trash2,
  Search,
  ShieldCheck,
  Radio,
  Sun,
  Moon,
  ChevronRight,
} from 'lucide-react';
import { Settings as IntegrationSettings } from './features/integrations/Settings';
import { Settings2 } from 'lucide-react';
import { Inspector } from './components/Inspector';
import type { CaptureBridge, Snapshot } from './features/network-capture/store';
const empty: Snapshot = { records: [], paused: false, error: null };
const noopSubscribe = () => () => {};
export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [bridge, setBridge] = useState<CaptureBridge | undefined>(
    window.__reproforge,
  );
  useEffect(() => {
    const ready = () => setBridge(window.__reproforge);
    window.addEventListener('reproforge-ready', ready);
    ready();
    return () => window.removeEventListener('reproforge-ready', ready);
  }, []);
  const snapshot = useSyncExternalStore(
    bridge?.subscribe ?? noopSubscribe,
    bridge?.getSnapshot ?? (() => empty),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const [order, setOrder] = useState('newest');
  const [light, setLight] = useState(false);
  const records = snapshot.records.filter(
    (r) =>
      (method === 'all' || r.method === method) &&
      (status === 'all' ||
        (status === '4xx' && r.status < 500) ||
        (status === '5xx' && r.status >= 500) ||
        String(r.status) === status) &&
      `${r.method} ${r.path} ${r.status}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  if (order === 'oldest') records.reverse();
  useEffect(() => {
    if (!snapshot.records.some((r) => r.id === selected))
      setSelected(snapshot.records[0]?.id ?? null);
  }, [snapshot.records, selected]);
  const active = records.find((r) => r.id === selected) ?? records[0];
  return (
    <main className={light ? 'app light' : 'app'}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Activity size={18} />
          </span>
          <strong>ReproForge</strong>
          <span className="version">0.2</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="Integration settings"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 size={16} />
          </button>
          <span
            className={`capture-status ${bridge && !snapshot.paused ? 'live' : ''}`}
          >
            <span />
            {!bridge
              ? 'Preview mode'
              : snapshot.paused
                ? 'Paused'
                : 'Capturing'}
          </span>
          <button
            className="icon-button"
            aria-label={light ? 'Use dark theme' : 'Use light theme'}
            onClick={() => setLight(!light)}
          >
            {light ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>
      {!bridge && (
        <div className="preview-banner">
          UI preview · Capture is unavailable in an ordinary browser tab. Load
          the extension and open DevTools → ReproForge.
        </div>
      )}
      <div className="settings-view" hidden={!showSettings}>
        <button onClick={() => setShowSettings(false)}>
          Back to network monitor
        </button>
        <IntegrationSettings />
      </div>
      <div className={showSettings ? 'workspace is-hidden' : 'workspace'}>
        <aside className="monitor">
          <div className="monitor-heading">
            <div>
              <p className="eyebrow">NETWORK MONITOR</p>
              <h2>
                Failed requests{' '}
                <span className="counter">{snapshot.records.length}</span>
              </h2>
            </div>
            <div className="toolbar">
              <button
                aria-label={
                  snapshot.paused ? 'Resume capture' : 'Pause capture'
                }
                title={snapshot.paused ? 'Resume capture' : 'Pause capture'}
                disabled={!bridge}
                onClick={() => bridge?.toggle()}
              >
                {snapshot.paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
              <button
                aria-label="Clear requests"
                title="Clear requests"
                disabled={!snapshot.records.length}
                onClick={() => {
                  bridge?.clear();
                  setSelected(null);
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <div className="filters">
            <div className="search">
              <Search size={14} />
              <input
                aria-label="Search endpoints"
                placeholder="Search endpoints…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-row">
              <select
                aria-label="Filter HTTP status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option>4xx</option>
                <option>5xx</option>
                {[400, 401, 403, 404, 409, 422, 429, 500, 502, 503].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select
                aria-label="Filter method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="all">All methods</option>
                {[
                  'GET',
                  'POST',
                  'PUT',
                  'PATCH',
                  'DELETE',
                  'HEAD',
                  'OPTIONS',
                ].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select
                aria-label="Request order"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
          </div>
          <div className="list-caption">
            <span>ENDPOINT</span>
            <span>STATUS / TIME</span>
          </div>
          <div className="request-list" aria-label="Captured requests">
            {records.map((r) => (
              <button
                className={`request-row ${active?.id === r.id ? 'selected' : ''}`}
                key={r.id}
                aria-pressed={active?.id === r.id}
                onClick={() => setSelected(r.id)}
              >
                <div>
                  <span className="method">{r.method}</span>
                  <strong title={r.path}>{r.path}</strong>
                  <span className="request-time">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="request-right">
                  <span className="status-badge">{r.status}</span>
                  <span>
                    {r.duration === undefined ? '—' : `${r.duration} ms`}
                  </span>
                </div>
              </button>
            ))}
            {!records.length && (
              <div className="list-empty">
                <Radio size={24} />
                <p>
                  {snapshot.records.length
                    ? 'No matching requests'
                    : snapshot.paused
                      ? 'Capture is paused'
                      : 'Waiting for a failure'}
                </p>
                <span>
                  {snapshot.records.length
                    ? 'Adjust your filters to see more.'
                    : 'Failed fetch/XHR responses appear here.'}
                </span>
              </div>
            )}
          </div>
          <div className="monitor-footer">
            <ShieldCheck size={13} />
            <span>Local only · Last 150 requests</span>
          </div>
        </aside>
        {active ? (
          <Inspector
            key={active.id}
            record={active}
            onPreview={(id) => bridge?.preview(id) ?? Promise.resolve()}
          />
        ) : (
          <section className="welcome">
            <div className="welcome-icon">
              <Activity size={28} />
            </div>
            <p className="eyebrow">CAPTURE. REPRODUCE. PREVENT.</p>
            <h1>
              A failed request.
              <br />A better regression test.
            </h1>
            <p>
              Capture an API failure, define what should happen,
              <br className="wide-only" /> and export a test that verifies your
              fix.
            </p>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Keep DevTools open</strong>
                  <p>ReproForge listens for completed fetch/XHR failures.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Trigger the failing request</strong>
                  <p>Use your app, or the included local demo.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Define the expected outcome</strong>
                  <p>Review sanitized inputs and export a Vitest bundle.</p>
                </div>
              </li>
            </ol>
            <div className="welcome-note">
              <ShieldCheck size={15} />
              <span>
                Capture stays local. Integrations share only approved data.
              </span>
            </div>
            <span className="demo-hint">
              Try the demo <ChevronRight size={12} />{' '}
              <code>npm run demo:buggy</code>
            </span>
          </section>
        )}
      </div>
      <footer className="app-footer">
        <span>
          <span className="tiny-dot" />{' '}
          {snapshot.error ??
            (snapshot.paused
              ? 'Capture paused. Resume to receive new failures.'
              : 'HTTP 400–599 · fetch / XHR')}
        </span>
        <span>Deterministic tests. Developer-approved outcomes.</span>
      </footer>
    </main>
  );
}
