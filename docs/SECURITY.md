# Security and privacy

## Threat model

Assume a page can return adversarial URLs, headers, HAR metadata and JSON bodies. It may contain credentials, personal data, HTML or source-code fragments. Protect against accidental disclosure to UI/export, code injection in generated tests, excessive retention and accidental requests to production. This extension is not a general-purpose DLP system and cannot determine whether all business data is confidential.

## Data classes

| Class                       | Handling                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Raw transient browser data  | Read inside the DevTools event callback, validated and discarded; no logging or persistence |
| Sanitized local diagnostics | At most 150 records in DevTools memory; removed on Clear/close; bounded JSON previews       |
| User-approved AI data       | No such data path exists in this MVP; no AI backend or egress                               |
| Exported data               | A fresh validated/sanitized projection, explicitly reviewed and downloaded by the developer |

Browser-owned data is distinct from extension state. Chrome still has its Network log, and Chrome API body getter handles can reference browser-owned responses. Clearing ReproForge is not clearing Chrome's Network log or disk cache.

## Sanitization policy

- Remove the captured origin, user info, fragment and **all query parameters**. Path segments use a small static route-word allowlist. Other segments become `__REDACTED__`; no captured identifiers become runnable endpoints automatically.
- Header allowlist: only `content-type` and `accept`, restricted to known MIME values without parameters. No Authorization, Cookie, Set-Cookie, API key, custom/debug headers, or credential values survive. Authentication presence is a boolean hint only.
- JSON supports bounded arrays and nested objects. Unknown property names become generic excluded-field names; passwords, access/refresh/CSRF tokens, sessions, account/card data and personal fields are excluded. Strings survive only under approved semantic keys, with a short restricted character set and email/phone/opaque-value checks. Numeric and boolean values survive only under a separate allowlist.
- Limit body previews to 16 KiB UTF-8; JSON walk depth to 8, arrays to 50 items, object properties to 100 and traversal to 1,000 nodes before replacing further values. Exclude malformed/unsupported content rather than displaying raw fallback text.
- Response preview requires explicit action, a JSON MIME type, and a known uncompressed HAR size no larger than the limit. Recheck the returned content; encoded bodies are excluded. Chrome's `getContent` does not offer streaming or a byte-range limit, so a dishonest size may still cause Chrome to hand back a large string, which is immediately excluded.
- Redacted/missing fixtures require `TEST_FIXTURE_JSON` at execution time. Unsupported request bodies are not replayed as their original formats; the builder only supports manually supplied synthetic JSON or an explicit JSON fixture requirement. The user must ensure the endpoint accepts JSON.
- Generation reapplies sanitization so approved headers/fixtures cannot reintroduce captured credentials through the normal input paths.

Allowlisted business fields can still be sensitive. A short identifier placed under `symbol`, a secret disguised as an enum, or an `amount` may escape semantic detection. User-entered titles/descriptions are explicit user data, not captured text; common recognizable tokens and personal strings are scrubbed, but they also require review. Never paste production secrets into test annotations. The export review is a necessary boundary, not a claim of perfect anonymization.

## Execution and target safety

Generated tests:

1. Require `TEST_BASE_URL` before network activity.
2. Require an HTTP(S) origin with no username/password, path, query or fragment.
3. Accept only exact `localhost`, `127.0.0.1`, or `[::1]` by default.
4. Permit HTTPS hosts ending in `.test` only when the exact origin is explicitly listed in `TEST_ALLOWED_ORIGINS`.
5. Reject authority-changing paths, backslashes, query/fragment injection, traversal and encoded separators/dots. Missing path placeholders fail before fetch.
6. Obtain authentication from `TEST_AUTH_TOKEN`, never captured headers.
7. Require complete synthetic fixture configuration if data was excluded.
8. Use `redirect: 'error'`, `credentials: 'omit'`, a 10-second request timeout, and a 15-second test timeout.
9. Cancel the response body and assert only status; do not log response bodies, headers or credentials.

An allowlist cannot establish that a host is truly a test system. Trusted local DNS, local services and proxies are the operator's responsibility. Do not forward loopback traffic to production. Native fetch does not reproduce browser cookies, session storage, service worker behavior or CORS restrictions. Running a mutation test can change the configured server; use disposable data and fixture reset procedures.

## Permissions and CSP

There are **no declared permissions or host permissions**. The DevTools API works through the `devtools_page` entry; it requires no `tabs`, `debugger`, `webRequest`, cookies, storage or broad host permission for this feature. No service worker or content script is installed. Normal user-triggered Blob/anchor downloads and clipboard writes avoid additional permissions; failures are reported with selectable-text fallback for copying.

The production CSP permits only local scripts/styles, excludes object embedding and base URL changes, and sets `connect-src 'none'`. No `eval`, remote JavaScript, CDN fonts, inline application scripts or captured-HTML rendering are used. A Vite preview page is a development tool, not the packaged extension.

## Persistence and sharing

No analytics, telemetry, external data sharing, raw-body logs or permanent diagnostic storage. Exported files are intentionally persistent downloads. Keep generated `.env` files out of Git and use test-only credentials. Downloads are under user control; deleting a capture does not delete prior exports. No API secrets exist in the frontend.

## Security regression checks

Automated tests cover header/query redaction, nested/array/dynamic-key sanitization, malformed/unknown/large payloads, compile-safe literal escaping, production/path guards, DELETE opt-in, matching-status confirmation, missing-secret placeholders, ZIP integrity, bounded capture and response-preview handling. The red-to-green check executes real generated code. See [TESTING](TESTING.md) for evidence and remaining manual checks.
