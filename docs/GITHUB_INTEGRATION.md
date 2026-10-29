# GitHub integration

## Authentication and repository selection

Install GitHub CLI and authenticate independently:

```bash
gh auth login --hostname github.com
gh auth status --hostname github.com
```

ReproForge never requests your GitHub password. The companion invokes `gh api` using controlled argument arrays and JSON stdin. Credentials stay in gh's configured store or the companion environment; they never enter the extension, Gemini context, generated bundle or verification processes.

Select `owner/repository` in the GitHub tab and check the connection. The companion displays the authenticated login, verifies repository visibility/archive status, issue availability, default branch, existing labels and push permission. The authorized workspace's standard HTTPS/SSH GitHub `origin` is suggested, but an inspected webpage is never assumed to belong to it. Real issue-create permission is ultimately determined by GitHub's API; read access alone does not guarantee an account is allowed to post.

GitHub.com is the only supported host in this MVP. Enterprise hosts and custom SSH aliases require a future reviewed adapter.

## Issues

Enter the developer-confirmed expected behavior and prepare a draft. It contains endpoint/method, observed/expected status, sanitized request/response, reproduction steps, environment notes and regression reference. It explicitly avoids claiming request validity or verified root cause without evidence.

Edit the draft, select existing labels if desired, then request exact review. The companion sanitizes text again, freezes the final title/body and adds a visible-in-review unique marker comment. Recent open issues are fetched and compared locally for possible matches; captured titles are not transmitted as search queries before publication approval. Suggestions are advisory, not fuzzy-match blockers.

**Create Issue** publishes only that reviewed draft after explicit approval. A real GitHub number and exact expected GitHub URL are required before success is displayed. Repeated clicks on a successful draft return its existing receipt. Identical content cannot be resubmitted within the same companion session. Pending/uncertain submissions are never blindly retried. After timeout/disconnect, inspect GitHub for the marker or title before making a new draft, especially after restarting the companion (receipts are memory-only).

Missing CLI/authentication, forbidden repository, disabled issues, invalid labels, network errors and rate limits have explicit failure states. GitHub writes are mocked in automated tests; no live issue was created during implementation.

## Local branch, push and PR

A verified patch can be promoted using **Apply to Local Branch**. This is a separate approval for a local commit. Git plumbing builds the new tree through a private temporary index and creates `fix/reproforge-<id>`. No checkout, reset, clean or working-file overwrite occurs. Existing target-file edits, changed HEAD/hashes and branch collisions block promotion. Unrelated dirty files are preserved.

Before pushing, the selected repository must match the workspace's GitHub origin, the account must have push permission, the chosen base must exist and point to the reviewed base commit, and the remote fix branch must not exist. The user reviews files/diff, verification and commit and separately approves **push**. Git uses a fixed gh credential helper, no interpolated shell arguments, no force flags, and an explicit new branch ref; it never pushes directly to main/base.

**Create Fix PR** prepares an editable title/body describing the problem, AI hypothesis, changes, actual verification, limitations and AI-assisted nature. An issue URL may be included. Automatic `Closes/Fixes/Resolves #…` directives are rejected in this MVP. Preparing and publishing recheck remote heads against the reviewed commit/base. Opening the **draft PR** requires an approval distinct from commit and push. There is no merge endpoint.

The actual PR number/URL is displayed only after GitHub confirms creation. An uncertain create is not retried automatically. No remote push or real PR was performed during implementation; unit tests use explicit adapters and temporary repositories.

## Future authorization

For a distributed product, migrate to a GitHub App with repository-scoped installation permissions, short-lived installation tokens, auditable authorization and a reviewed callback flow. The current local gh approach intentionally avoids custom OAuth, frontend tokens and persistent plaintext token storage.

Reference: [GitHub CLI API command](https://cli.github.com/manual/gh_api).
