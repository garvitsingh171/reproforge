# Code-fix workflow

## State and approvals

`Investigation complete` → `proposed` → `staged` → `verified` → `branched` → `pushed` → `pr-created` are distinct states. A model response is not a successful fix. Verification separately reports running/passed/failed/blocked/inconclusive/cancelled with actual exit codes and output.

1. **Generate Fix**: explicitly approves a Gemini request using reviewed context plus findings.
2. **Review**: inspect file list, added/removed counts, unified diff, before/after content, explanations, assumptions, risks and suggested tests. Copy/download the patch, reject it, or regenerate.
3. **Stage in Sandbox**: approve filesystem writes to an isolated source copy. The UI shows its actual temporary location. The original working tree remains untouched.
4. **Run Verification**: approve the exact trusted execution profile, commands and expected behavior.
5. **Apply to Local Branch**: after verification passes, approve a separate local commit/branch without switching the working tree.
6. **Push**, then **Create draft PR**: independently approved external operations.

## Patch validation

The companion assigns proposal IDs and captures workspace identity, base commit, original file hashes, new hashes, source content and unified diffs. The model may only supply exact before/after edits and descriptive fields. Commands and unknown fields are rejected.

Limits: five changed files, ten edits, 80 lines per edit side, 300 added/removed lines overall, and 64 KiB per patched file. Edits must target reviewed, unredacted regular source files and match exactly once. There are no arbitrary file deletion, rename, binary patch, permission change or new-file operations in this MVP. Regression tests are generated independently into the verification harness rather than accepted as model-controlled proof.

The maintained `diff` library generates and parses unified diffs, and zero-fuzz application must recreate the proposed content exactly. Traversal, protected files, stale hashes/HEAD, secrets, conflicts and demo-mode-switch proposals fail closed. No source is silently force-applied.

## Staging and execution are different

Staging is a bounded source-only copy, not a Git worktree and not itself a security sandbox. It omits recognized secret files, protected files, dependency directories and project scripts/configuration. Verification adds trusted harness files and mounts installed dependencies read-only.

The Linux Bubblewrap runner uses private user/PID/network namespaces, no inherited credentials, no host home directory, read-only source/dependencies, a fresh temporary directory, dropped capabilities, a fixed working directory, controlled argv, 30-second per-check timeouts and a 64 KiB output cap. Cancellation kills the process group/private namespace. If isolation cannot start, application code is not executed. There is no host execution fallback.

This is not a general-purpose adversarial code execution service. Keep the OS and Bubblewrap patched, use trusted dependency installations, and do not approve hostile code. Kernel/resource-exhaustion risks and malicious behavior inside the allowed test environment remain outside a complete security guarantee.

## Demonstrated profile: demo-investments

The authorized repository must have `apps/demo-api/src/app.ts` exporting `createDemoApp`. Evidence must match the synthetic POST `/api/investments`, observed 422, expected 201 and the documented DEMO/monthly/100/USD fixture.

The profile:

- Starts a baseline server in **buggy mode** in a private network namespace.
- Runs the deterministic generated Vitest assertion and two additional trusted cases: reject a negative amount, accept a one-time investment.
- Starts the patched source in **buggy mode again**, in a separate namespace.
- Runs the **identical** regression and additional tests.
- Runs TypeScript with a trusted compiler configuration.

Only an intentional baseline 422-versus-201 failure, a three-test patched pass and a successful TypeScript check qualify as ready for human review. Incorrect patches remain failed. Logs and exit codes are real. Passing is evidence for these cases, not proof of complete correctness or production readiness.

Other frameworks/workspaces can use discovery, AI proposal, review, staging and export, but automated execution/promotion is blocked until a suitable reviewed profile is implemented. No arbitrary npm scripts, migrations or model-generated commands run.

## Original workspace and Git

Staging rechecks hashes before and after copying. Verification checks staged hashes. Promotion rechecks original HEAD/hashes and requires target files to match the reviewed Git base. Uncommitted target-file edits block promotion, while unrelated dirty work is preserved.

A temporary index plus `read-tree`, `hash-object --no-filters`, `update-index`, `write-tree`, `commit-tree` and atomic `update-ref` create the local fix branch. No hooks, smudge filters, checkout, clean, reset or force operation is used. Existing branches are not overwritten. Developers choose when to check out or merge a branch themselves.

Discard removes only proposal-owned temporary files. It does not delete user branches or GitHub resources. See [GitHub workflow](GITHUB_INTEGRATION.md).
