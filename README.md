# ReproForge 2.0

**Capture. Reproduce. Prevent.**

ReproForge is a Chrome DevTools extension that captures failed API requests, sanitizes their details, and exports developer-approved regression tests. Version 0.2.0 adds a local companion for GitHub issues, Gemini source investigation, minimal code patches, isolated verification, and separately approved fix branches and draft PRs.

The original capture/test workflow still works offline without the companion. Integrations do not automatically publish, upload code, execute a patch, or modify your working files.

## Install and launch the original workflow

Use **Node 24 LTS** and npm on Ubuntu. The dependency lockfile is included; use `npm ci` for repeatable installs.

```bash
npm ci
npm run build
npm run demo:buggy
```

1. Open `chrome://extensions`, enable **Developer mode**, and **Load unpacked** → `apps/extension/dist`.
2. Open `http://127.0.0.1:4317` and DevTools → **ReproForge** (possibly under `»`).
3. Submit the synthetic investment. Select its real `POST /api/investments` **422** failure.
4. Open **Test Builder**, supply expected status **201**, review exact exported files, and download the ZIP.
5. In the extracted project run `npm install`, copy `.env.example` to `.env`, set `TEST_BASE_URL=http://127.0.0.1:4317`, and run `npm run typecheck` followed by `npm test`.
6. The test fails against buggy mode. Stop that server, run `npm run demo:fixed`, and rerun the **unchanged** exported test: it passes.

DevTools must be open to capture; earlier requests may be unavailable. Capture is scoped to the inspected tab's completed fetch/XHR HTTP 400–599 responses. It is not browser-wide monitoring or JavaScript error capture. Closing DevTools discards the capture session.

## Enable the companion

The companion is necessary because a DevTools extension cannot directly read arbitrary local repositories. It exposes a bounded, authenticated API, not a shell endpoint.

```bash
# Install these OS tools if needed; follow your organization's package policy.
sudo apt install gh bubblewrap

# Authenticate GitHub independently. ReproForge never asks for a password.
gh auth login --hostname github.com
gh auth status --hostname github.com

# Optional Gemini setup; keep this file out of Git.
cp apps/companion/.env.example apps/companion/.env
```

Set `GEMINI_API_KEY` and `GEMINI_MODEL` in `apps/companion/.env`. Select a currently supported model from your Gemini account; no model is silently hardcoded. Missing credentials, unavailable models, rate limits and timeouts produce explicit errors. The key remains in the companion process.

Authorize a repository root explicitly:

```bash
npm run companion:start -- --workspace /absolute/path/to/repository --verification demo-investments
```

For this checkout, `/absolute/path/to/repository` is the ReproForge Git root. The demo profile expects `apps/demo-api/src/app.ts` and its `createDemoApp` export. For other repositories, omit `--verification demo-investments`: discovery, investigation, patch review, staging and export remain available, while execution is blocked until an appropriate trusted profile exists.

The companion prints a single-use pairing code valid for five minutes. In the extension's **Settings** button:

1. Enter the companion port (default **4318**) and pairing code.
2. Click **Pair local companion** and approve Chrome's optional loopback access request.
3. Confirm the authorized workspace and connection status.

The token remains only in panel memory. Disconnect clears companion session data and staged copies; restart the companion for a new code. No extension ID is hardcoded, so unpacked development IDs can change. [Local companion details](docs/LOCAL_COMPANION.md).

## Browser failure → reviewed fix

Select a captured request and use the new tabs:

- **GitHub:** confirm an owner/repository, check account and repository access, enter expected behavior, prepare/edit an issue, review its exact final title/body and confirm **Create Issue**. Only a confirmed GitHub response produces a success link. Existing issue suggestions are fetched without sending the captured title to a search endpoint.
- **AI Investigation:** enter expected behavior, find relevant source, optionally choose up to six tracked files, inspect exact sanitized context, and approve **Investigate with AI**. Source matching is heuristic; findings are hypotheses with checked file/line quotations.
- **Code Fix:** approve the second Gemini request, review per-file diffs and before/after source, reject/regenerate/download, then approve **Stage in Sandbox**. Only an isolated copy changes.
- **Run Verification:** inspect the fixed execution plan and approve it. The demo profile runs the same generated test against original and patched code with `DEMO_MODE=buggy` in **both**, plus invalid-input/one-time-investment tests and TypeScript. It never substitutes a mode toggle for source repair.
- **Apply to Local Branch:** after a passed verification, approve creating a separate local branch and commit. Git plumbing uses a private index; your current branch and working files remain untouched. Uncommitted target-file edits block promotion.
- **GitHub → Create Fix PR:** approve pushing the reviewed fix branch, then separately review and approve opening a draft PR. No force-push, direct push to the base branch, merge or automatic issue closure is provided.

[AI investigation](docs/AI_INVESTIGATION.md) · [Code-fix workflow](docs/CODE_FIX_WORKFLOW.md) · [GitHub setup](docs/GITHUB_INTEGRATION.md) · [Complete demo script](docs/DEMO_SCRIPT.md).

## Repository structure

```text
apps/
  extension/
    public/manifest.json, icons/
    src/devtools/                    # Public Chrome API integration
    src/features/network-capture/    # Sanitized, bounded in-memory records
    src/features/test-builder/       # Deterministic tests and ZIP review
    src/features/integrations/       # Pairing, AI, diff and GitHub UI
    src/components/, styles/, lib/
  demo-api/                          # Existing synthetic webpage and Express API
  companion/
    src/                             # Auth, workspace, GitHub, Gemini, patches,
                                     # Bubblewrap verification and branch/PR operations
    tests/                           # Security, provider, Git, execution tests
packages/
  shared/                            # Capture types/sanitizer + integration Zod contracts
  test-generator/                    # Existing deterministic Vitest templates
scripts/                             # Build, packaging, red/green and browser checks
docs/                                # Architecture, security, setup, demo and verification
artifacts/                           # Generated reports, screenshots and ZIPs; Git-ignored
```

React 19, TypeScript strict mode, Vite 8, Tailwind 4, Lucide and `useSyncExternalStore` power the panel. Express 5, Zod, the official `@google/genai` SDK, maintained `diff` parser, controlled Git/`gh` processes and Bubblewrap power integrations. No database, authentication platform, hosted backend or Docker is required.

## Commands

| Command                                        | Purpose                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                  | Ordinary browser UI preview at `/panel.html`; capture/pairing require the installed extension                   |
| `npm run demo:buggy` / `npm run demo:fixed`    | Existing local test-generator demonstration                                                                     |
| `npm run companion:start -- --workspace /repo` | Companion with explicit workspace and execution disabled                                                        |
| `npm run companion:dev -- --workspace /repo`   | Watch-mode companion; restarting invalidates sessions                                                           |
| `npm run companion:check`                      | Typecheck and companion tests, including Bubblewrap checks                                                      |
| `npm run typecheck` / `npm run lint`           | Static checks                                                                                                   |
| `npm run format` / `npm run format:check`      | Apply/check Prettier                                                                                            |
| `npm test`                                     | Original and companion suites; external providers mocked                                                        |
| `npm run test:red-green`                       | Original generated-test demo with mode switching                                                                |
| `npm run test:fix-demo`                        | Actual source patch and isolated red/green checks using an explicitly labeled test fixture, **not live Gemini** |
| `npm run test:browser`                         | Real Chromium capture, inspection and ZIP export                                                                |
| `npm run test:browser:companion`               | Real browser pairing, approval, diff, sandbox verification and issue UI; external providers use test adapters   |
| `npm run build` / `npm run verify:build`       | Production build / manifest and asset checks                                                                    |
| `npm run package`                              | `artifacts/reproforge-0.2.0.zip`, with manifest at ZIP root                                                     |
| `npm run check`                                | Typecheck, lint, tests and build                                                                                |

For browser tests, first run `npx playwright install chromium`. Tests use an isolated browser profile. The companion browser test grants only the declared loopback permission through Chrome's own settings API; the native first-grant prompt is a separate manual release check.

## Security boundaries

- No required extension permissions or required host access. Optional `http://127.0.0.1/*` is requested only for pairing. Chrome match patterns cannot limit that grant to one port; the client and companion validate the selected port, Host and authenticated session. CSP permits only loopback connections, not GitHub/Gemini directly.
- Capture still removes origins, credentials, query values and unrecognized sensitive fields. Only bounded JSON previews are retained; response bodies load on demand.
- The companion binds only `127.0.0.1`, checks Host and extension origin, requires a random expiring session token and fresh request IDs, and rejects replayed writes. Chrome's origin-less privileged GETs require a matching explicit extension-origin header and session token; normal web origins remain blocked.
- Workspace access is CLI-authorized, canonicalized, tracked-file-only, bounded and symlink checked. Secrets, dependency directories, build artifacts, hidden files and deployment/companion trust-boundary paths are excluded.
- AI receives only reviewed context. It has no execution tools. Outputs must match schemas, real source quotations, exact file hashes and bounded minimal edits.
- Verification uses Bubblewrap with private network/PID namespaces, no inherited credentials, read-only source/dependencies, fixed commands, bounded output, timeout and cancellation. If isolation is unavailable, application code does **not** run.
- Source snapshots are local temporary files created after staging approval, removed on discard/disconnect/normal shutdown. Unexpected termination can leave them in `/tmp`; see the cleanup guidance.
- External publications require exact draft review. Uncertain results are not blindly retried. Git operations do not reset, clean, check out over, or overwrite your working tree.

Redaction is conservative, not perfect. Business data and source code can remain confidential even without recognizable secret patterns. Review outbound content and use synthetic data. [Full security policy](docs/SECURITY.md).

## Verification and limits

The original workflow and the companion browser workflow have been tested in actual Chromium. Automated tests exercise real isolated source repair and branch creation in temporary repositories. GitHub and Gemini use explicit test adapters in automation: **no live Gemini success, real issue publication, remote push or real PR creation is claimed**. Those require your credentials, an authorized repository, approved source context and explicit UI approvals.

Execution currently supports the documented Express investment demo profile. Generic Node/TypeScript source discovery is heuristic; arbitrary frameworks, databases, browser sessions, multipart/binary replay and arbitrary project scripts are unsupported. A passing status assertion is limited evidence, not proof of complete application correctness. This is a single-user local developer tool, not a multi-tenant hardened execution service.

Before presenting, perform the native Chrome install/permission checks and the live-provider steps in [TESTING](docs/TESTING.md). Useful next additions are reviewed framework-specific verification profiles, a GitHub App authorization model and richer domain assertions.

## Troubleshooting and packaging

- **No failures:** open DevTools before triggering the request, resume capture and clear filters. Network status 0, cancellation and CORS-only errors are outside HTTP capture.
- **Pairing unavailable:** restart the companion, use its new code within five minutes, verify port and approve optional loopback permission. Only one extension session is allowed per companion process.
- **Source missing:** use the Git root and tracked, non-ignored regular source files. Select known files manually. Protected/oversized/secret-bearing files cannot be patched.
- **Verification blocked:** install/configure Bubblewrap and unprivileged namespaces; otherwise export and verify manually in a separately controlled environment. Do not fall back to host execution.
- **GitHub failed:** check `gh auth status`, repository issue settings/access and rate limits. After a timeout, inspect GitHub before preparing another submission.
- **Stale patch/base:** regenerate from current source; do not force-apply or force-push.
- **Missing Git identity:** configure a repository-local `user.name` and `user.email` yourself before creating a local commit.
- **Changes not visible:** rebuild, reload the extension on `chrome://extensions`, close/reopen DevTools, and re-pair if needed.

`npm run package` creates a ZIP; it does not install or publish it. [Chrome Web Store checklist](docs/CHROME_WEB_STORE.md).
