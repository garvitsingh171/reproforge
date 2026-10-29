# AI investigation

## Provider configuration

The companion uses the official `@google/genai` SDK. Configure server-only `GEMINI_API_KEY` and `GEMINI_MODEL` in `apps/companion/.env`. Choose a model currently available to your account. No old/default model is hardcoded. The UI distinguishes **configured** from verified availability; unsupported model, invalid credentials, rate limit, timeout and invalid output have separate safe error messages.

The SDK uses structured JSON output, a fixed system policy, a 60-second timeout, one attempt (no automatic retries), and an 8,000-token response ceiling. No AI tools, shell execution or browser automation are exposed to the model. Official references: [Google Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/index.html), [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

## Context discovery and consent

1. Select a real captured failure and supply expected status plus an explanation of correct behavior.
2. **Find relevant source files** ranks exact endpoint matches, route-method syntax, endpoint tokens and test paths inside the authorized Git root.
3. **Choose source files** lets you select known tracked files when heuristics miss router mounts, imported handlers or service logic.
4. Inspect every file and the exact sanitized evidence. Context is bounded to six files / 96 KiB and expires after fifteen minutes.
5. Approve **Investigate with AI**. Only this approved context is sent. Preparing or viewing context is local.
6. Inspect hypotheses, missing information, suggested actions and exact source quotations.

Ranking is deterministic text inspection, not complete control-flow analysis. Matching a route string does not prove runtime reachability or establish the root cause. Source comments, API data and logs are untrusted evidence. Prompt text embedded in them cannot change the companion's allowlists, credentials, command registry or approval rules.

## Grounding

Zod validates every structured response. The observation must match the supplied method, endpoint and status. Every evidence citation must name a supplied file, use a valid line, and quote that exact line. Invalid citations or malformed output are rejected. A valid quotation still does not prove causation. Confidence labels are model judgments, not calibrated probabilities.

Sources are scrubbed before display/transmission for recognizable keys, tokens, private keys and personal data. Redaction preserves line positions where possible. Redacted files are not patchable. Short business secrets can remain undetectable; the user must remove files or cancel if disclosure is inappropriate.

## Generate Fix

A second, separate approval sends the approved context and investigation to Gemini. The response is a bounded list of exact before/after edits, explanations, test suggestions, assumptions and risks. It is not an executable command list. Files must be approved and patchable; edits must match exactly once. The companion generates, parses and reapplies a unified diff with zero fuzz to validate it.

No provider output is accepted as evidence of a successful fix. Only subsequent actual test execution can establish the narrow behavior checked. See [CODE_FIX_WORKFLOW](CODE_FIX_WORKFLOW.md).

## Verification claims

Automated provider tests use explicit SDK/test adapters for successful responses, malformed output, hallucinated citations, prompt-injection text, missing configuration, timeout, unavailable model, invalid credentials and rate limits. The sandbox demonstration uses an explicitly labeled known patch fixture. These tests validate integration mechanics; they are **not** a claim that a real Gemini model diagnosed this repository. A live run requires your key, a supported model, approved source context and UI consent.
