# Live demo script

Use synthetic data only. No authentication, account, real money or remote services are involved.

## Before presenting

```bash
npm ci
npm run check
npm run test:red-green
npm run package
npm run demo:buggy
```

Load `apps/extension/dist` using `chrome://extensions` → Developer mode → Load unpacked. Open `http://127.0.0.1:4317`, then DevTools → ReproForge. If an older build was loaded, reload the extension and reopen DevTools. Keep the browser and terminal visible.

## Demonstrate the problem and fix

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
