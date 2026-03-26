# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenShift Pulse — a React/TypeScript dashboard for OpenShift Day-2 operations. All data comes from live Kubernetes APIs (no mock data in production code). v5.6.0, ~130 source files, 1606 tests.

## Commands

```bash
# Dev server (requires `oc proxy --port=8001` running separately)
npm run dev              # rspack dev server on port 9000

# Build
npm run build            # production build (~1s)

# Tests
npx vitest --run         # run all tests (~3s)
npx vitest --run src/kubeview/views/__tests__/WorkloadsView.test.tsx  # single file
npx vitest --run -t "test name pattern"  # single test by name

# Type checking
npm run type-check       # tsc --noEmit

# Lint & format
npm run lint             # eslint with --fix
npm run format           # prettier
```

## Architecture

### Entry & Routing
- **Entry**: `src/index.tsx` → `src/kubeview/App.tsx` (`OpenshiftPulseApp`)
- **Shell**: `components/Shell.tsx` wraps all routes (CommandBar + TabBar + Dock + StatusBar)
- **Routes**: `routes/resourceRoutes.tsx` (generic CRUD), `routes/domainRoutes.tsx` (views like Workloads, Storage), `routes/redirects.tsx`
- URL pattern for resources: `/r/{group~version~plural}/{namespace}/{name}` (GVR encoding uses `~` separator)

### Data Layer
- **API proxy**: All K8s calls go through `/api/kubernetes` → rspack dev proxy → `oc proxy :8001`
- **Query**: `engine/query.ts` — CRUD functions (`k8sList`, `k8sGet`, `k8sCreate`, `k8sPatch`, `k8sDelete`, `k8sSubresource`) with TanStack Query
- **List+Watch**: `hooks/useK8sListWatch.ts` — REST list + WebSocket watch with 60s safety polling
- **Watch manager**: `engine/watch.ts` — singleton WebSocket manager with heartbeat/reconnect
- **Discovery**: `engine/discovery.ts` — discovers all resource types from `/apis` endpoint, builds `ResourceRegistry` (Map<string, ResourceType>)
- **Impersonation**: `getImpersonationHeaders()` in `engine/query.ts` — added to ALL fetch calls from `uiStore` state

### State Management
- **`store/clusterStore.ts`** (zustand) — cluster discovery, version info, HyperShift detection (`isHyperShift` when `controlPlaneTopology === 'External'`)
- **`store/uiStore.ts`** (zustand + persist) — tabs, toasts, dock panel, namespace, impersonation, connection status. Persisted to `localStorage` with `openshiftpulse-` prefix

### Engine (src/kubeview/engine/)
- **renderers/** — `K8sResource` type definition, `ColumnDef` for list tables, `kindToPlural()`, status color mapping
- **enhancers/** — per-kind column/action extensions (pods, deployments, nodes, services, secrets). Register via `enhancers/register.ts`
- **actions.ts** — `ResourceAction` registry (quick/navigate/danger categories)
- **gvr.ts** — `K8S_BASE` constant (`/api/kubernetes`), GVR↔URL encoding utilities
- **snapshot.ts** — cluster state capture/compare

### UI Components
- **Primitives**: `components/primitives/` — Panel, Card, DataTable, Badge, Dropdown, SearchInput, StatusBadge, ActionMenu, EmptyState
- **Feedback**: `components/feedback/` — Toast, ConfirmDialog (not native `confirm()`), ProgressModal, InlineFeedback
- **YAML**: `components/yaml/` — YamlEditor (CodeMirror), DryRunPanel, DiffPreview, SchemaPanel, SnippetEngine
- **Logs/Metrics**: `components/logs/`, `components/metrics/` — LogStream, MultiContainerLogs, MetricsChart, Prometheus helpers

### Views (src/kubeview/views/)
14 domain views (Workloads, Storage, Networking, Compute, Pulse, Alerts, etc.) + detail views (IncidentContext, WorkloadAudit, RollbackPanel) + admin tabs. Each domain view typically has metrics + health audit (6 checks each).

### Testing
- **Framework**: vitest + jsdom + @testing-library/react
- **Test setup**: `src/kubeview/__tests__/setup.tsx` — factories (`makeDeployment`, `makePod`, `makeNode`, `makeConfigMap`), `wrapList()`, `createMockServer()`, `k8sHandlers()`, `renderWithProviders()`
- **Mocking patterns**: Most tests (24/63 files) use `vi.mock` with `_mockListWatchData` objects to feed data to components. Integration tests (2 files) use MSW `http.get/post/patch/delete` handlers against `*/api/kubernetes*` paths for network-level mocking.
- `__APP_VERSION__` is defined in both `rspack.config.ts` and `vitest.config.ts` via DefinePlugin/define

### Key Conventions
- Path alias: `@/` maps to `src/`
- CSS: Tailwind + PatternFly 6. Main class `.openshiftpulse` in `styles/index.css`
- Icons: lucide-react
- State: zustand (no Redux)
- Routing: react-router-dom v7
- PromQL values sanitized via `sanitizePromQL()` in `engine/query.ts`
- Header values sanitized against CRLF injection
- RBAC checks via `hooks/useCanI.ts` (SelfSubjectAccessReview)

### Environment Variables (dev server)
- `K8S_API_URL` — K8s API target (default: `http://localhost:8001`)
- `OC_TOKEN` — bearer token (auto-detected from `oc whoami -t`)
- `THANOS_URL` — Prometheus/Thanos endpoint for metrics
- `ALERTMANAGER_URL` — Alertmanager endpoint
- `CONSOLE_URL` — OpenShift console URL for Helm proxy

### Deploy to OpenShift
```bash
npm run build && oc start-build openshiftpulse --from-dir=. --follow -n openshiftpulse && oc rollout restart deployment/openshiftpulse -n openshiftpulse
```
Manifests in `deploy/deployment.yaml`. OAuth proxy, 2 replicas, PDB, topology spread.
