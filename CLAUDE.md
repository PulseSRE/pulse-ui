# Repository guidance

OpenShift Pulse UI is a React/TypeScript OpenShift dashboard. Current version/toolchain are in `package.json`; do not duplicate release, test, tool, scanner, or file counts here. Use [README](README.md), [CONTRIBUTING](CONTRIBUTING.md), and [API integration](API_CONTRACT.md) for setup and checks.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev                       # port 9000; oc proxy 8001 separately for live data
pnpm type-check
pnpm lint                      # read-only lint
pnpm lint:fix                   # apply fixes
pnpm test
pnpm exec vitest --run path/to/file.test.ts
pnpm test:coverage
pnpm build
pnpm verify                    # type-check + lint + test + build
```

`rspack.config.ts` reads process environment, not `.env` automatically. Agent proxy credentials are injected server-side; browser WebSockets contain no shared token. Real agent admin endpoints require a real forwarded user token and configured admin identity. Never print or commit tokens.

Playwright scripts/config are in `e2e/`; tests may start mock API/container services or target `PULSE_URL`. Run only within the user's authorized test environment. Do not treat mock E2E as cluster deployment validation.

## Source map

- `src/index.tsx` → `src/kubeview/App.tsx` → Shell and `routes/*`.
- Resource routes use `/r/{group~version~plural}/{namespace}/{name}`; domain routes and redirects are authoritative in `routes/domainRoutes.tsx`.
- `engine/query.ts`: Kubernetes CRUD/log helpers; `clusterConnection.ts`: local/remote target registry.
- `hooks/useK8sListWatch.ts`: REST list and WebSocket watch cache updates with safety polling.
- `engine/watch.ts`: watch subscription/reconnection manager.
- `engine/agentClient.ts`: chat streaming/nonce confirmation protocol; `monitorClient.ts`: background events and proposals.
- `store/agentStore.ts`, `monitorStore.ts`, `trustStore.ts`, `inboxStore.ts`, `fleetStore.ts`, `customViewStore.ts`: client state. Inspect each persist partialization before changing storage shape.
- `engine/componentRegistry.ts`, `agentComponents.ts`, renderers and `normalizeAgentProps.ts`: generated UI schema/rendering.
- `engine/types/*`: canonical Kubernetes, incident, and Ask Pulse types.
- `components/logs`, `metrics`, `yaml`: reusable controls; consult their local documentation and actual exports.

## Behavioral requirements

- Preserve active cluster/user identity in query keys, subscriptions, tabs, and pending actions; do not render one cluster's object and mutate another cluster implicitly.
- Do not infer server authorization from localStorage/browser trust. Background monitoring uses server policy and service-account authority; interactive chat and direct Kubernetes writes have different controls.
- Echo the backend confirmation nonce. Observe mode must not approve writes via hidden buttons, keyboard shortcuts, or auto-approval.
- Rollback must replace the intended mutable subtree exactly and reject concurrent changes; strategic merge is insufficient for removing added fields.
- Use real backend data or explicit empty/error states. Feature flags were removed; the old featureFlags module is not available.
- Prefer existing UI primitives, lucide icons, `cn()` and shared types. Maintain accessible contrast, especially menus/overlays. Test changes on actual rendered screens when authorized.
- Distinguish helper-level regression tests from cluster/OAuth acceptance. Check failure and cancellation paths, not just happy paths.

## Toolchain

React 19, TypeScript 5, Tailwind 4 (`@import 'tailwindcss'`/`@theme`), Rspack 2, ESLint 10, and react-grid-layout 2. Exact versions/configurations are in package metadata, `eslint.config.js`, CSS, and `vitest.config.ts`. Type-check currently excludes tests.

## Deployment ownership

The [Pulse Operator](https://github.com/PulseSRE/pulse-operator) deploys and configures Pulse via `OpenShiftPulse`. This repository packages the UI image; `Dockerfile.helm-runner` is for the Helm product feature, not installing Pulse. Use immutable images and the operator's current CR fields/documentation.

Do not delete OAuth, database, or API-key Secrets as a routine upgrade/rotation recipe. Rotation requires a coordinated operator-specific procedure and, for database credentials, synchronization with the stored database password. Do not restate deployment-specific Secret names here. Preserve data and review the operator's documented procedure before changing credentials.

Historical designs under `docs/superpowers/` are design records, not implementation status. Release entries in CHANGELOG are historical. Consult current source and test output for present behavior.
