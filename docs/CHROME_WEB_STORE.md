# Chrome Web Store packaging

```bash
npm run package
```

Output: `artifacts/reproforge-0.2.0.zip`. Its root contains `manifest.json`, `devtools.html`, `panel.html`, `icons/` and bundled `assets/`. It does not contain node_modules, development servers, demo source, secrets or test artifacts.

`npm run verify:build` validates manifest version/name, both HTML pages, script/style references, icons, the absence of required permissions/host access and the exact optional loopback permission, and common unsafe/remote script patterns. These checks complement actual browser loading; they do not certify Store acceptance.

Before a Store submission:

- Perform the [manual Chrome checks](TESTING.md) with the exact packaged build.
- Provide accurate screenshots, description and a single-purpose explanation: turn failed API requests into developer-reviewed regression tests, investigations and verified code-fix proposals.
- Provide a privacy policy describing DevTools network access, local processing, conservative sanitization, no telemetry, optional companion pairing, approved Gemini context sharing, GitHub publications, temporary staging, session lifetime and user-triggered exports.
- Complete current Store data-use disclosures accurately, including the fact that users can export sanitized request information. No required permissions does not mean the extension cannot see network data.
- Confirm that all bundled dependencies and original icons may be distributed under their licenses.
- Check current Store policies and requirements immediately before submission; they can change.
- Review version increments and release notes for updates.

This repository does not submit, publish, sign, install or update extensions in your Chrome account. A generated ZIP is a packaging artifact, not a published extension or guarantee of review approval. The local unpacked install is separate from a Store listing.
