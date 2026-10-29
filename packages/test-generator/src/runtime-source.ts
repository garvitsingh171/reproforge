// This reviewed helper is exported verbatim into each standalone project.
export const runtimeSource = `
export function targetUrl(path: string, env: NodeJS.ProcessEnv = process.env): URL {
  const base = env.TEST_BASE_URL;
  if (!base) throw new Error('Set TEST_BASE_URL to an authorized local/test origin.');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('TEST_BASE_URL must be an http(s) origin without credentials, path, query or fragment.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const extra = (env.TEST_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  const sandbox = url.protocol === 'https:' && url.hostname.endsWith('.test') && extra.includes(url.origin);
  if (!local && !sandbox) throw new Error('Unsafe target blocked: use loopback or an explicitly allowlisted https .test origin.');
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\\?#\\s]/.test(path) || /%(?:2f|5c|2e)/i.test(path) || path.split('/').includes('..')) {
    throw new Error('Use an absolute endpoint path without a host, query, traversal, or fragment.');
  }
  const target = new URL(path, url);
  if (target.origin !== url.origin) throw new Error('Cross-origin endpoint blocked.');
  if (target.pathname.includes('__REDACTED__')) throw new Error('Set TEST_PATH to an authorized synthetic endpoint.');
  return target;
}

export function fixture(fallback: unknown, required: boolean): unknown {
  if (!required) return fallback;
  if (!process.env.TEST_FIXTURE_JSON) throw new Error('Set TEST_FIXTURE_JSON to synthetic JSON data; captured fields were redacted or missing.');
  const value: unknown = JSON.parse(process.env.TEST_FIXTURE_JSON);
  if (value === null || typeof value !== 'object') throw new Error('TEST_FIXTURE_JSON must be a JSON object or array.');
  if (JSON.stringify(value).includes('[REDACTED]')) throw new Error('Replace all redacted fixture values with synthetic data.');
  return value;
}
`;
