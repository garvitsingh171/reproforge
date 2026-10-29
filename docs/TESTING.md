# Verification

## Commands

```bash
npm ci
npm run check
npm run format:check
npm run test:red-green
npm run package
```

Unit tests cover sanitization, nested/array/dynamic-key privacy, malformed and oversized data, method filtering, normalization, duplicate delivery, pause/clear/retention, on-demand response access and timeouts. Generator tests cover deterministic GET and mutations, developer-supplied expected status, opt-ins, escaping, supported methods, credential placeholders, missing fixtures, query restrictions, ZIP contents and runtime target guards. The Express integration test makes real loopback HTTP requests in both modes.

`npm run test:red-green` writes `artifacts/generated-regression`, typechecks the generated project, starts the real Express app in each mode on an ephemeral loopback port, and invokes Vitest on the same generated test. The script requires an assertion failure specifically reporting expected 201 / actual 422 in buggy mode, an exit-0 pass in fixed mode, and an unchanged test file. A compilation failure or unrelated exception does not count as the red result.

## Real browser check

```bash
npx playwright install chromium
npm run build
npm run test:browser
```

For a desktop run: `HEADED=1 npm run test:browser`. On a headless Linux host, Playwright's full Chromium channel supports the default headless run; its lightweight headless shell is not used. The script launches an isolated temporary browser profile, not your normal Chrome profile. The browser must be able to bind loopback ports and start subprocesses.

The automated browser flow:

1. Load the actual unpacked MV3 build and open real DevTools against the demo.
2. Locate the panel registered by `chrome.devtools.panels.create`.
3. Submit the actual demo webpage form and assert HTTP 422.
4. Assert the captured endpoint appears in React.
5. Load the sanitized response via Chrome's real `getContent` callback.
6. Enter expected status 201 and inspect the generated assertion.
7. Switch inspector tabs and confirm the draft survives.
8. Open review, verify download is disabled before approval, approve and download a fresh ZIP.
9. Verify pause/resume and selection stability as new real requests complete.
10. Send a synthetic request containing a query token, Authorization value and password, and assert these values are absent from rendered diagnostics.
11. Clear the session and verify the empty state.
12. Save screenshots and evidence in `artifacts/`.

The harness uses the Chrome DevTools Protocol to control the actual DevTools window and its extension iframe. Panel selection uses Chromium's DevTools view registry because the native overflow menu is not reliably accessible to Playwright. That test-only adapter may need updating when Chromium changes. Production extension code uses only public Chrome extension APIs. No capture store, HAR records, network API or panel data is mocked/injected in this browser test. A test-only network-finished counter synchronizes the pause check; it does not modify capture.

Fresh downloads are required on each run. Existing success evidence and the previous named ZIP are removed first so a stale file cannot make a failed run pass. The real downloaded bundle can be tested with:

```bash
npm run test:red-green -- artifacts/browser-downloads/reproforge-regression.zip
```

To prove the export works independently of monorepo dependencies:

```bash
REPROFORGE_STANDALONE=1 npm run test:red-green -- artifacts/browser-downloads/reproforge-regression.zip
```

This extracts only the expected project files into a new temporary directory, runs `npm install`, typechecks using its own installed dependencies, writes the local demo origin into `.env`, and runs the bundle's own `npm test` script against each mode. This option needs network access for installation. It is intended only for a bundle you just generated and trust: the test project contains executable code and npm scripts.

## Evidence recorded during implementation

Verified on **2026-10-29**, Ubuntu Linux, Node **24.22.1**, npm **11.19.1**, and Playwright Chromium **156.0.8078.4**:

| Boundary                       | Evidence                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Static checking                | TypeScript strict mode and ESLint pass                                                           |
| Unit/integration suite         | 26 tests across 4 files pass                                                                     |
| MV3 build                      | Both entry points, manifest, bundled JS/CSS and four PNG icons validate                          |
| Genuine DevTools capture       | Browser test loads the extension, captures the demo POST, inspects response and generates a test |
| Export                         | Exact-file review gate and actual ZIP download pass                                              |
| Generated project independence | Fresh standalone `npm install`, typecheck and `.env`-driven `npm test` succeed as a toolchain    |
| Buggy server                   | Actual generated test fails with expected 201 / received 422; runner exit 1                      |
| Fixed server                   | Exact same generated test passes; runner exit 0                                                  |
| Visual inspection              | Real DevTools screenshot inspected at docked and undocked widths                                 |

Evidence files (generated, ignored by Git):

- `artifacts/browser-smoke.txt`: browser workflow result.
- `artifacts/devtools-smoke.png`: actual populated DevTools panel.
- `artifacts/devtools-empty.png`: actual cleared panel.
- `artifacts/browser-downloads/reproforge-regression.zip`: browser-exported project.
- `artifacts/red-green.txt`: compile and red/green result summary.
- `artifacts/buggy-test.log` and `artifacts/fixed-test.log`: actual Vitest output.
- `artifacts/reproforge-0.1.0.zip`: packaged extension.

The initial sandbox denied localhost binding (`listen EPERM`); integration and browser verification were subsequently run with loopback/process access. This was an execution-environment limitation, not a mocked passing result.

## Manual release checks

Automated Chromium verification does not install into your personal Google Chrome profile or prove every Chrome version works. Before presenting or publishing:

1. Load `apps/extension/dist` through Google Chrome's actual `chrome://extensions` UI. Check the extension error list.
2. Open DevTools before triggering requests; check the overflow menu if necessary. Confirm capture while another DevTools panel is selected.
3. Reopen DevTools and confirm a new empty session; reload the inspected page and confirm session retention.
4. Try narrow docked layouts, light mode, keyboard-only navigation, readable contrast, focus confinement in review, Escape to cancel, and clipboard controls.
5. Exercise search, exact status/family/method filters and ordering with multiple endpoints.
6. Check unsupported request formats, absent/large response bodies, auth placeholders and DELETE approval against disposable endpoints.
7. Verify a generated test refuses a production origin before contacting it; do not remove the guard to run against real production.
8. Follow the full [demo script](DEMO_SCRIPT.md) using the downloaded ZIP and manual mode restart.
9. Confirm that production build assets contain no remote scripts and that no optional AI behavior or telemetry is present.

Not claimed: Chrome Web Store publication/review, personal-profile installation, cross-browser support, exhaustive accessibility certification, arbitrary application session replay, AI diagnostics or broad device/version coverage.
