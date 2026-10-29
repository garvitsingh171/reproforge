# Repository instructions

ReproForge is a local-first Manifest V3 DevTools extension, not a hosted website.

- Keep Chrome APIs in `apps/extension/src/devtools` and `features/network-capture`.
- Treat every HAR field as untrusted. Retain only sanitized records, never raw payloads.
- Do not add permissions, host access, telemetry, remote code, replay, or persistence without an implemented requirement and security review.
- Keep test generation deterministic. Expected status must be supplied by the developer.
- Never export captured origins or credentials. Keep the generated target guard and redirect blocking intact.
- Use TypeScript strict mode and meaningful tests for security and behavior changes.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` after changes. Run `npm run test:red-green` for generator/demo changes.
- Browser verification uses real Chromium DevTools; never inject fake capture records and report them as live capture.
- Update docs when commands, limitations, or safety boundaries change.
- Do not commit, push, deploy, or publish without explicit user authorization.
