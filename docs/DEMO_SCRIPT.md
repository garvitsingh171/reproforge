# Live demo script

Use synthetic data only. The original generator demo is offline. The optional AI/GitHub demonstration below requires developer credentials and separate approvals; no real money or production database is involved.

## Before presenting

```bash
npm ci
npm run check
npm run test:red-green
npm run package
npm run demo:buggy
```

Load `apps/extension/dist` using `chrome://extensions` → Developer mode → Load unpacked. Open `http://127.0.0.1:4317`, then DevTools → ReproForge. If an older build was loaded, reload the extension and reopen DevTools. Keep the browser and terminal visible.

## Original regression-generator demo

1. Point out the **Capturing** indicator and empty monitor. Nothing has been prepopulated.
2. Submit the synthetic investment on the demo page: `symbol=DEMO`, `amount=100`, `currency=USD`, `type=monthly`.
3. The webpage displays **HTTP 422** from the real Express handler. ReproForge captures the failure.
4. Select `POST /api/investments`. Inspect safe headers and JSON fixture. Use Response → Load sanitized preview to show on-demand retrieval.
5. Explain the defect: buggy mode rejects a valid `monthly` investment. Correct behavior is **201**, supplied by the developer.
6. Open Test Builder. Set expected status **201** and a descriptive title, such as “Creates a valid monthly investment”.
7. Show the actual generated `expect(response.status).toBe(201)` assertion. Explain that 422 is not accepted simply because it was observed.
8. Review exact export inputs and files. Approve and download the ZIP.
9. Extract into a separate directory. Run `npm install`, copy `.env.example` to `.env`, and set `TEST_BASE_URL=http://127.0.0.1:4317`.
10. Run `npm run typecheck`, then `npm test`. Show the actual failed assertion: expected 201, received 422.
11. Stop the buggy demo process with Ctrl+C. From the repository run `npm run demo:fixed` on the same port.
12. Run the **unchanged** exported test again. Show the actual passing test.
13. Optionally submit on the demo webpage again: HTTP 201 should **not** appear as a new failure in ReproForge.

Switching modes changes only the intentionally incorrect validator. The fixture and expected behavior remain the same. No production requests or payment operations occur.

## Automated evidence

`npm run test:red-green` creates a generated project, typechecks it, starts each mode on an ephemeral loopback port, executes Vitest in the generated project, checks the precise failure reason and verifies the test file was not modified. Read `artifacts/red-green.txt`, `artifacts/buggy-test.log` and `artifacts/fixed-test.log`.

The automated run supplies `TEST_BASE_URL` to the child process; the human walkthrough uses `.env`. Neither silently chooses a captured production hostname.

## Show privacy without real secrets

In the demo page's DevTools Console, you may manually run this synthetic request:

```js
fetch('/api/investments?token=SYNTHETIC_QUERY_SECRET', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer SYNTHETIC_HEADER_SECRET',
  },
  body: JSON.stringify({
    symbol: 'DEMO',
    amount: 100,
    currency: 'USD',
    type: 'monthly',
    password: 'SYNTHETIC_PASSWORD',
  }),
});
```

The strict demo rejects the extra property. ReproForge removes the query, header credential and password value. The redacted fixture requires synthetic configuration before the generated test can run. This console request is a manual demonstration; the extension never injects it.

## Time-saved measurement

Measure elapsed time from a visible failure to an executable, reviewed regression test. Compare manual creation with assisted capture/export for the same scenario. Include dependency installation consistently (or warm caches for both), record repetitions, and report raw timings and the median. Do not present estimates as measured results.

## ReproForge 2.0: genuine source repair and GitHub review

Prepare a dedicated GitHub test repository containing this committed synthetic demo source. Use a clean checkout with `origin` pointing to that authorized repository and HEAD matching its intended base branch. Do not use a production repository. A temporary local fixture is sufficient for the automated check, but real push/PR requires your own repository and permissions.

Install the local dependencies and configure credentials yourself:

```bash
npm ci
sudo apt install gh bubblewrap
gh auth login --hostname github.com
gh auth status
cp apps/companion/.env.example apps/companion/.env
```

Edit the ignored `apps/companion/.env`: set `GEMINI_API_KEY` and `GEMINI_MODEL` to a model available to your account that supports structured output. No key or model is preconfigured. Configure a repository-local Git author identity if one is absent. Keep credentials out of screen recordings.

Build and start the app in one terminal:

```bash
npm run build
npm run demo:buggy
```

In a second terminal, from this checkout:

```bash
npm run companion:start -- --workspace "$PWD" --verification demo-investments
```

1. Reload the unpacked build at `chrome://extensions`, close/reopen DevTools, and pair in ReproForge Settings using the displayed port and single-use code. Approve optional loopback access. Check the workspace, commit, configured model and verification profile.
2. Submit the synthetic monthly investment on `http://127.0.0.1:4317`. Confirm the actual 422 capture. Load its sanitized response and enter expected status 201, intended behavior, reproduction steps and environment in the integration workflow.
3. Open **GitHub**, check account access and select `OWNER/REPOSITORY`. Prepare/edit the issue, review all text and labels, acknowledge the approval, then publish only if authorized. Open the confirmed issue URL. This is a real external action, not necessary for local verification.
4. Open **AI Investigation**, discover candidate files and inspect the exact source preview. Include `apps/demo-api/src/app.ts`; select relevant permitted tests if useful. Review source and diagnostic disclosure, then explicitly approve sending context to Gemini.
5. Read the findings, source quotations, confidence, missing information and limitations. The intended grounded finding is that the monthly-investment guard rejects an otherwise valid request. Do not present unsupported model claims as facts.
6. Open **Code Fix**, approve another model request, then inspect the actual unified and before/after diff. The proposal should remove or correct the faulty monthly validator while preserving valid schema checks. A mode-toggle proposal is rejected by the backend. You may discard, regenerate or export the patch.
7. Approve **Stage in Sandbox**. Show the isolated path and confirm the original application source remains unchanged.
8. Approve the displayed fixed verification plan. Both baseline and patched servers remain in `buggy` mode. Show the actual baseline assertion failure, the same test passing against changed source, the additional negative/one-time tests and TypeScript result. A wrong patch stays failed; missing sandbox support stays blocked. Do not claim complete application correctness from these checks.
9. After a passing report, review and approve **Apply to Local Branch**. This creates a new local branch/commit using a private index; the current checkout stays untouched. Inspect its diff independently with `git show` using the branch name shown in the panel.
10. In **GitHub**, verify repository/base, changed files and report. Explicitly approve the push to the new fix branch. Prepare/edit the PR description, link the confirmed issue without automatic closure, review it, and separately approve opening the draft PR.
11. Open the returned actual PR URL and show its source diff and genuine verification summary. Never auto-merge. Disconnect and stop the companion when finished.

If the model, credentials, repository permission or secure execution environment is unavailable, stop that dependent step and show its actual error. You can still demonstrate offline capture/export and the known-patch verification harness, clearly labeled as such. The automated harness does not establish that live Gemini or GitHub succeeded.

For reproducible local pipeline evidence without external services:

```bash
npm run test:fix-demo
npm run test:browser:companion
```

The first uses an explicit known source patch; the second uses explicit provider adapters with real browser transport and real isolated tests. Neither should be presented as live AI repair or real publication.
