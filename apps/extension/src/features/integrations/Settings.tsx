import { useState, useSyncExternalStore } from 'react';
import { PlugZap, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { companionClient } from './client';
export function Settings() {
  const status = useSyncExternalStore(
    companionClient.subscribe,
    companionClient.getSnapshot,
  );
  const [port, setPort] = useState('4318'),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [github, setGithub] = useState('Not checked');
  const pair = async () => {
    setBusy(true);
    setError('');
    try {
      if (!globalThis.chrome?.permissions)
        throw new Error(
          'Pairing is available only in the installed DevTools extension.',
        );
      const allowed = await chrome.permissions.request({
        origins: ['http://127.0.0.1/*'],
      });
      if (!allowed)
        throw new Error(
          'Loopback access was not granted. Offline capture and test export remain available.',
        );
      await companionClient.pair(Number(port), code.trim());
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="integration-page">
      <p className="eyebrow">LOCAL INTEGRATIONS</p>
      <h2>
        <PlugZap size={20} /> Companion settings
      </h2>
      <p className="muted">
        Authorize a Git workspace in your terminal. This panel cannot select an
        arbitrary filesystem path.
      </p>
      <pre className="command-example">
        npm run companion:start -- --workspace /absolute/repository
        --verification demo-investments
      </pre>
      {status ? (
        <>
          <div className="info">
            <ShieldCheck size={16} />
            Local Companion Connected
          </div>
          <dl>
            <dt>Workspace</dt>
            <dd>{status.workspace.name}</dd>
            <dt>Base commit</dt>
            <dd className="mono">{status.workspace.baseCommit.slice(0, 12)}</dd>
            <dt>Gemini model</dt>
            <dd>
              {status.gemini.configured
                ? `${status.gemini.model} · configured, not yet verified`
                : 'Not configured in companion'}
            </dd>
            <dt>Verification</dt>
            <dd>{status.verificationProfile}</dd>
            <dt>Repository remote</dt>
            <dd>{status.remote ?? 'No GitHub origin detected'}</dd>
            <dt>GitHub account</dt>
            <dd>{github}</dd>
            <dt>Session expires</dt>
            <dd>{new Date(status.expiresAt).toLocaleString()}</dd>
          </dl>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const result = z
                  .object({ account: z.string() })
                  .parse(await companionClient.request('/github/status'));
                setGithub(result.account);
              } catch (e) {
                setGithub('Unavailable');
                setError(
                  e instanceof Error ? e.message : 'GitHub status unavailable.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Check GitHub authentication
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await companionClient.disconnect();
                setGithub('Not checked');
                await chrome.permissions.remove({
                  origins: ['http://127.0.0.1/*'],
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Disconnected locally; restart companion.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect & clear companion session
          </button>
        </>
      ) : (
        <>
          <label>
            Companion port
            <input
              aria-label="Companion port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </label>
          <label>
            Single-use pairing code
            <input
              aria-label="Pairing code"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Copy from the companion terminal"
            />
          </label>
          <button
            className="primary"
            disabled={busy || !code}
            onClick={() => void pair()}
          >
            {busy ? 'Pairing…' : 'Pair local companion'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <div className="info">
        <ShieldCheck size={16} />
        <span>
          Only an optional loopback permission is requested. No GitHub or Gemini
          credentials enter the extension. Code and diagnostics leave your
          computer only after you approve the exact context or GitHub draft.
          Closing DevTools clears local client state; restart the companion to
          obtain a new pairing code.
        </span>
      </div>
    </section>
  );
}
