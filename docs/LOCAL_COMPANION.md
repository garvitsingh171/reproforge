# Local companion

The companion is an optional single-user loopback service. It owns filesystem, Git, GitHub CLI and Gemini access; the extension owns browser capture and approvals. No service worker, remote backend, content script or database is added.

## Ubuntu setup

Use Node 24 LTS, npm, Git and optionally `gh`/Bubblewrap:

```bash
npm ci
sudo apt install gh bubblewrap
cp apps/companion/.env.example apps/companion/.env
npm run companion:start -- --workspace /absolute/repository --verification demo-investments
```

`companion:start` and `companion:dev` load `apps/companion/.env` if it exists. The file is Git-ignored. Set `GEMINI_API_KEY` and `GEMINI_MODEL` there or supply them in the parent environment. An absent key leaves capture, issue drafts, GitHub and deterministic tests usable. Never put keys in the extension or test exports.

CLI options:

- `--workspace`: required; an existing canonical Git repository root with a commit. The extension cannot change it.
- `--port`: optional, default 4318, valid 1024–65535.
- `--verification demo-investments`: opt into the fixed synthetic Express profile. Default `disabled` permits preview/staging/export but no application execution.

The original demo listens on 4317; the companion uses 4318. Verification servers use 4319 **inside private network namespaces**, so they cannot conflict with your host application.

## Pairing and authentication

1. Start the companion. Its terminal prints a random 192-bit, single-use pairing code, valid for five minutes.
2. Open extension Settings; enter the port/code and approve optional loopback access.
3. The companion exchanges the code for a random 256-bit token tied to that extension origin for four hours.
4. Every protected request carries the token. Every POST also carries a fresh UUID, preventing replay within the session.
5. Disconnect revokes the session and clears local workflow state and temporary staging copies. Restart for a fresh pairing code. Closing DevTools clears client memory; it cannot guarantee server cleanup, so stop the companion when finished.

No token is stored in browser localStorage, Chrome storage or a database. Only one pairing is accepted per process. Five invalid attempts exhaust pairing. Watch-mode restarts invalidate the session.

## Browser transport

The service accepts only the exact configured `127.0.0.1:port` Host and loopback socket addresses. Web origins and opaque `null` origins are denied. Pairing and writes require a valid `chrome-extension://` Origin. Chrome omits Origin on some privileged GETs; these reads require `Sec-Fetch-Site: none`, `X-ReproForge-Origin` matching the paired extension, and the session token. A supplied browser Origin must match the declared origin. The declared origin is not authentication; the token remains mandatory.

CORS allows only the exact extension origin and required headers. Preflight is not authorization. JSON bodies are capped at 160 KiB. Contexts, proposals, requests and audit records have count/size limits. Invalid data returns safe error codes without echoing sensitive input. Privileged mutations are serialized; a disconnected in-flight mutation may require restarting instead of an unsafe retry.

## Workspace policy

Discovery scans at most 10,000 tracked paths, considers up to 2,000 allowlisted source files and reads at most 4 MiB while ranking. Each file is limited to 64 KiB. Approved AI context contains at most six files / 96 KiB. The extension can choose from allowed relative paths, not arbitrary absolute paths.

Canonical root checks, per-component symlink checks, realpath containment, Git ignore checks, extension/path allowlists and protected directories prevent ordinary traversal and symlink escapes. Hidden files, `.env`, keys, credentials, node_modules, build outputs, deployment configuration and ReproForge's companion/security infrastructure are excluded. Files whose text was redacted are visible as read-only context and cannot be patched.

Staging creates a bounded source-only copy under `/tmp/reproforge-stage-*`, omitting recognizable secret-bearing files, package scripts/configuration and dependencies. The verification profile supplies trusted harness/configuration files and read-only toolchain dependencies. It is not a complete clone of every project asset; general projects may require a future reviewed profile.

## Shutdown and cleanup

Ctrl+C/SIGTERM cancels verification and removes known temporary source copies. Discard and disconnect also remove them. No cleanup touches original workspaces or existing Git branches. A crash/SIGKILL can leave `/tmp/reproforge-stage-*`; inspect those paths and delete only your abandoned staging directories manually. Local commits/branches and published GitHub resources intentionally survive disconnect.

## Failure behavior

Missing Git repository/commit, protected paths, expired approvals, changed hashes, unavailable services, sandbox failures and unsafe commands fail closed. There is no arbitrary shell endpoint, no automatic dependency installation inside untrusted source, and no host-execution fallback. Use `npm run companion:check` to verify supported behavior. External services are mocked in tests.
