# Screenshot review and refresh

Use an existing authorized test deployment and an explicit URL. Do not start a local stack or select a cluster implicitly to refresh images. Screenshots may expose resource names, logs or credentials; use disposable data and inspect each image before publication.

## Capture workflow

For README and Pages sample-data screenshots use `node e2e/screenshots/capture.mjs` (mock Kubernetes plus `demo-data.mjs`, no agent; see its header). The live-deployment workflow below is for real-cluster captures.

1. Verify the intended deployed URL, authenticated test identity and visible application state. A200 response alone may be a login page.
2. Inspect `scripts/capture-screenshots.ts` before using it. It is a standalone Playwright script, not a Playwright test specification. It expects `PULSE_URL`, `PULSE_USER` and `PULSE_PASS`; set the URL explicitly because its fallback reads an unscoped hardcoded `oc` Route. Its login assumptions and historical route selectors may need adaptation to the current installation. Do not treat its catch-and-continue login path as proof of authentication.
3. Capture the current routes from `src/kubeview/routes/domainRoutes.tsx` with a reviewed browser workflow. Preserve browser sandboxing and use a fresh temporary profile when necessary. Do not overwrite historical screenshots until replacement images are validated.
4. Visually check each image for the correct route, loaded data, legible text and absence of sensitive content. Loading skeletons, error pages and login screens are not successful product screenshots.
5. Report the exact UI revision, deployment URL, routes captured and any missing captures. Update references only to images actually saved.

Live-cluster files under `docs/screenshots/` are historical illustrations; the sample-data images named in README are current captures. This guide does not claim they match the current product or that live capture has been verified.
