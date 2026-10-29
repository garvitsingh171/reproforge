# ReproForge

**Capture. Reproduce. Prevent.**

A Chrome DevTools extension that turns failed API requests into developer-approved, executable regression tests. Select a captured HTTP failure, specify the expected status, review sanitized inputs, and download a standalone Vitest project. The extension never replays requests or runs tests.

For example, the included demo rejects a valid monthly investment with **422**. You specify **201**, export a test, observe it fail against the buggy server, then run the same test against the corrected server and watch it pass.

## Quick start

Use Node.js **22.13+ or 24 LTS** (Node 24 LTS recommended) and npm. Current Vite/Vitest/ESLint dependencies require a newer runtime than early Node 20 releases. The lockfile pins the dependency graph.

```bash
npm ci
npm run build
npm run demo:buggy
```

In Chrome on Ubuntu:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `apps/extension/dist` inside this repository.
3. Open `http://127.0.0.1:4317`.
4. Open DevTools with **F12** or **Ctrl+Shift+I**, then choose **ReproForge** (possibly in the `»` overflow menu).
5. Submit the synthetic investment on the demo page. Select the captured `POST /api/investments` with status **422**.
6. Choose **Test Builder**, enter expected status **201**, and select **Review & export bundle**.
7. Inspect the exact sanitized inputs and bundle files, approve the export, and download the ZIP.

DevTools must be open to capture. Requests completed before it opened may not be available. Capture continues while another DevTools panel is visible. Closing DevTools discards the session. After rebuilding, reload the extension on `chrome://extensions`, close DevTools, and reopen it.

## Run your exported test

Extract the ZIP into a separate directory, then:

```bash
npm install
cp .env.example .env
```

Set this value in that directory's `.env`:

```dotenv
TEST_BASE_URL=http://127.0.0.1:4317
```

Then:

```bash
npm run typecheck
npm test
```

With `npm run demo:buggy` running in the repository, the test **must fail** with expected HTTP 201 / actual HTTP 422. Stop that server with Ctrl+C and run:

```bash
npm run demo:fixed
```

Run `npm test` in the **same exported directory** again. The **unchanged test passes** with HTTP 201. Do not change the expected status to match the bug. Both modes use synthetic data and hold no persistent records. State-changing tests against other APIs may require disposable fixtures and cleanup.

## Features

- Genuine `chrome.devtools.network.onRequestFinished` capture of completed fetch/XHR HTTP 400–599 failures.
- Compact dark interface, light theme, status/method/search filters, request order, selection, pause/resume and clear.
- Up to 150 in-memory records. Duplicate delivery of the same event object is ignored; separate identical requests remain separate.
- Request metadata and sanitized JSON previews. Response previews load only on demand, subject to type and size checks.
- Deterministic TypeScript/Vitest tests with native fetch and a developer-specified status assertion.
- GET/HEAD/OPTIONS without bodies; POST/PUT/PATCH JSON; DELETE only with explicit generation approval.
- Environment placeholders for authentication, excluded paths and missing/redacted fixtures.
- Review and download of a complete ZIP, including the test, target guard, package metadata, configuration and setup instructions.
- No account, backend, AI key, analytics, remote scripts or external sharing required.

## Repository layout

```text
apps/
  extension/
    public/                 # Manifest V3 and original PNG icons
    src/
      devtools/             # Hidden DevTools page: capture + panel registration
      components/           # Request inspector and escaped code preview
      features/
        network-capture/    # HAR normalization and bounded capture store
        test-builder/       # Expected behavior, input editing, review/export
      lib/                  # Browser download helper and bridge types
      styles/               # Tailwind entry and panel styles
    devtools.html
    panel.html
    vite.config.ts
  demo-api/
    src/                    # Express app and loopback-only launcher
    public/                 # Synthetic investment demo
packages/
  shared/                   # Types, Zod validation, conservative sanitization
  test-generator/           # Typed deterministic templates and ZIP generation
tests/                      # Capture and demo integration tests
scripts/                    # Build validation, packaging, red/green, browser checks
docs/                       # Architecture, security, demo, testing, store checklist
artifacts/                  # Generated evidence and ZIPs (ignored by Git)
```

React 19 + TypeScript strict mode + Vite 8 + Tailwind 4 + Lucide make the panel. React's `useSyncExternalStore` subscribes to a tiny bounded store; no global state framework is necessary. Zod validates inputs. JSZip builds downloadable projects. Express 5 serves the local demo. Vitest 5, TypeScript, ESLint and Prettier support verification. Exact versions are in `package-lock.json`.

## Commands

Run these from the repository root:

| Command                                   | Purpose                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                             | Vite UI preview; open `/panel.html` on the printed localhost URL |
| `npm run demo:buggy`                      | Synthetic demo on 127.0.0.1:4317, intentionally returns 422      |
| `npm run demo:fixed`                      | Same demo with correct 201 response                              |
| `npm run typecheck`                       | Strict TypeScript check across workspaces and scripts            |
| `npm run lint`                            | ESLint                                                           |
| `npm run format` / `npm run format:check` | Apply / check Prettier formatting                                |
| `npm test`                                | Sanitization, generator, capture and demo integration tests      |
| `npm run test:red-green`                  | Compile and execute one generated test against both modes        |
| `npm run test:browser`                    | Real Chromium extension workflow; see browser setup below        |
| `npm run build`                           | Typecheck, production extension build and asset validation       |
| `npm run verify:build`                    | Validate an existing extension build                             |
| `npm run package`                         | Build and create `artifacts/reproforge-0.1.0.zip`                |
| `npm run check`                           | Typecheck, lint, tests, build                                    |

Vite's normal browser preview explicitly reports **Preview mode** and does not pretend to capture traffic. The installable extension uses only bundled production assets. No Vite development server is necessary after building.

For browser automation:

```bash
npx playwright install chromium
npm run build
npm run test:browser
```

The script uses an isolated temporary profile, the full Chromium browser, a loopback demo server and actual DevTools APIs. If headless DevTools is unavailable on your system, use `HEADED=1 npm run test:browser` under a desktop session. It does not use your normal Chrome profile. See [testing details](docs/TESTING.md).

## How a DevTools extension works

`manifest.json` is Chrome's entry-point declaration: extension name/version, packaged icons, a DevTools HTML page, and a restrictive Content Security Policy. This extension declares **zero permissions and zero host permissions**. The `devtools_page` manifest entry grants the supported DevTools integration; there is no service worker, popup or content script.

When DevTools opens, Chrome creates the hidden `devtools.html` page. It registers a **ReproForge** panel and listens to completed network requests for the inspected tab. This is where `chrome.devtools` is available; those APIs are not available in an ordinary React webpage. When the panel is shown, a small same-extension bridge connects React to the capture store. A hidden panel can reopen without losing the current DevTools session.

Capture normalizes supported HAR entries and discards unnecessary fields immediately. Chrome retains its own Network data; ReproForge does not control Chrome's storage. [Architecture](docs/ARCHITECTURE.md) explains the boundaries.

## Privacy, sanitization and permissions

- Raw network data arrives transiently from Chrome. Application state contains sanitized diagnostic records, not raw HAR entries.
- All captured URL query parameters, credentials, fragments and origins are removed. Unknown path segments become `__REDACTED__`; configure a synthetic `TEST_PATH` after export.
- Only approved MIME headers survive. Authorization, Cookie, Set-Cookie, API keys and arbitrary headers are excluded.
- JSON fields use conservative allowlists. Sensitive/unknown properties, emails, phones and opaque strings are redacted; nested objects and arrays are bounded. Unknown keys are replaced too, because keys can contain personal data.
- Only bounded JSON previews are supported. Malformed JSON, free text, binary, multipart/form bodies and unknown/large responses are excluded. The UI explains unavailable data.
- Nothing is persisted by ReproForge. Clear capture or close DevTools to release the session. User-requested downloads are persistent files under your control.
- Export shows exact files and requires review. You can cancel and remove fixture fields or safe headers. Generation sanitizes again. Replace placeholders using synthetic fixtures and test-only credentials outside the extension.
- The extension never makes API calls, replays mutations, follows captured links, or runs tests. Its CSP includes `connect-src 'none'`.
- Tests require `TEST_BASE_URL`, default to exact loopback hosts, and block redirects. Explicit HTTPS `.test` sandbox origins must also be listed in `TEST_ALLOWED_ORIGINS`. This is not permission to use a production proxy or production data.

Sanitization cannot identify every sensitive business value. Even an allowed short `symbol` or numeric `amount` can be confidential. Review is mandatory; use synthetic data. See [the threat model and limits](docs/SECURITY.md).

## Optional Gemini diagnostics

**Not implemented in this MVP.** There is no AI backend, AI request button, external sharing path, or frontend secret. Capture and test generation work offline after installation. A future integration would need a separate backend with a server-only Gemini key, user approval of exact sanitized content, validated advisory output, timeout/rate-limit handling, and a narrowly scoped opt-in connection. It must not change deterministic generation or claim a verified root cause.

## Limits and troubleshooting

| Symptom                                        | Explanation / action                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ReproForge is missing                          | Select `apps/extension/dist`, not the source directory. Reopen DevTools; check `»`.                                                         |
| No captured requests                           | Open DevTools before submitting. Resume capture. Clear filters. Only completed fetch/XHR 400–599 responses are included.                    |
| Network shows an error but ReproForge does not | Cancellations, CORS failures and network status 0 are not HTTP response failures and are outside this MVP.                                  |
| Preview is unavailable                         | Chrome may not retain the body, or its type/size is unsupported. Unknown sizes are excluded.                                                |
| Body fields disappeared                        | Conservative sanitization excluded them. Configure a complete synthetic `TEST_FIXTURE_JSON` in the export.                                  |
| Expected status is blank                       | Intent cannot be inferred from a failure; supply it explicitly. Matching the observed status requires a separate acknowledgment.            |
| Unsafe target blocked                          | Set a loopback origin or an explicitly allowlisted HTTPS `.test` origin. Do not remove the guard to run against production.                 |
| Test reports missing configuration             | Read `.env.example`; provide test fixture, path or token placeholders when required.                                                        |
| Port 4317 is busy                              | Stop the previous demo. Alternatively use `PORT=4318 npm run demo:buggy` and update `TEST_BASE_URL`.                                        |
| Changes are not visible in Chrome              | Build, reload the extension, close and reopen DevTools.                                                                                     |
| ZIP or copy fails                              | Retry; check browser download/clipboard controls. Code previews are selectable. No `downloads` or `clipboardWrite` permission is requested. |

A single HTTP request cannot recreate a session. Cookie-based flows, uploads, binary content, GraphQL assertions, streaming responses and complex setup are not supported. GET/HEAD/OPTIONS body replay is not supported. A generated status assertion is narrower than full business validation. The code preview is escaped plain text, not syntax-highlighted HTML.

## Packaging and judging

`npm run package` creates a Chrome Web Store-shaped ZIP with `manifest.json` at its root. It is **not published** and does not include a store listing. See [the store checklist](docs/CHROME_WEB_STORE.md).

| Criterion                | Concrete implementation                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Real browser interaction | DevTools receives an actual failed POST from the local demo                                                      |
| Useful result            | Runnable Vitest ZIP, with the same test failing before the fix and passing afterward                             |
| Permission minimization  | No declared permissions, host access, content scripts or background service worker                               |
| Secure handling          | Conservative sanitization, bounded memory, explicit review, target guard, no network egress                      |
| User benefit             | Converts captured API errors into developer-approved regression tests without manually assembling a test project |

For an honest time comparison, time manual test creation and the assisted workflow using the same endpoint, payload, expected status, machine and warm dependency cache. Include review/configuration in both measurements; repeat and report raw times and medians. No speedup or saved-time benchmark is claimed here.

Read [DEMO_SCRIPT](docs/DEMO_SCRIPT.md), [TESTING](docs/TESTING.md), [SECURITY](docs/SECURITY.md), and [ARCHITECTURE](docs/ARCHITECTURE.md) for details.

Implementation references: [Chrome DevTools architecture](https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools), [DevTools network API](https://developer.chrome.com/docs/extensions/reference/api/devtools/network), [Manifest V3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [Vite runtime requirements](https://vite.dev/guide/), [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
