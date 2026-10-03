# Deployment validation guide

Run repository checks with the pinned toolchain: `pnpm verify` and `pnpm test:coverage`. Preserve exit statuses; do not pipe type/lint output through filters that hide failures or exclude assumed old errors.

Run Playwright only in an authorized test environment, following `e2e/playwright.config.ts`. Record mock vs deployed backend. Passing unit/build checks alone is not READY TO DEPLOY.

Run `pnpm audit` and scan the exact built image digest. Report unresolved vulnerabilities and scan metadata; do not claim all images come from Red Hat or that zero-CVE is permanent. `Dockerfile` currently uses a moving UBI tag.

Inspect bundle output and report meaningful regressions, not a hardcoded machine-specific build time. Inspect source/config for credentials without printing matched live secrets. UI deployment resources live in pulse-operator, not a deleted `deploy/` directory.

Report each check as PASS, FAIL, or NOT RUN, with actual command/revision and remaining OAuth/RBAC, network, multi-cluster and live-cluster acceptance limitations. Report READY only within the verified scope.
