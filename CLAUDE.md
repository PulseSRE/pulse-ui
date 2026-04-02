# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenShift Pulse — a React/TypeScript dashboard for OpenShift Day-2 operations. All data comes from live Kubernetes APIs (no mock data in production code). v5.18.0, ~190 source files, 1778 unit tests + 28 E2E scenarios.

## Commands

```bash
# Dev server (requires `oc proxy --port=8001` running separately)
npm run dev              # rspack dev server on port 9000

# Build
npm run build            # production build (~1s)

# Tests
npx vitest --run         # run all tests (~7s)
npx vitest --run src/kubeview/views/__tests__/WorkloadsView.test.tsx  # single file
npx vitest --run -t "test name pattern"  # single test by name

# Type checking
npm run type-check       # tsc --noEmit

# Full verify
npm run verify           # type-check + strict + lint + test + build

# E2E tests (auto-starts mock K8s + dev server)
npm run e2e              # headless Playwright
npm run e2e:headed       # visible browser
npm run e2e:ui           # Playwright UI mode

# Lint & format
npm run lint             # eslint with --fix
npm run format           # prettier

# Screenshots (requires Playwright + live cluster)
PULSE_URL=https://... PULSE_USER=cluster-admin PULSE_PASS=... npx tsx scripts/capture-screenshots.ts
```

## Architecture

### Entry & Routing
- **Entry**: `src/index.tsx` → `src/kubeview/App.tsx` (`OpenshiftPulseApp`)
- **Shell**: `components/Shell.tsx` wraps all routes (CommandBar + TabBar + Dock + StatusBar)
- **Routes**: `routes/resourceRoutes.tsx` (generic CRUD), `routes/domainRoutes.tsx` (domain views), `routes/redirects.tsx` (legacy + feature-gated redirects)
- URL pattern for resources: `/r/{group~version~plural}/{namespace}/{name}` (GVR encoding uses `~` separator)
- **Feature flags**: All flags default to ON. Toggle in Admin > Overview > Feature Flags. Stored in localStorage via `engine/featureFlags.ts`.

### Navigation Structure
```
Cluster:        Pulse, Workloads (+Builds tab), Networking, Compute, Storage
Operations:     Incident Center (Now/Investigate/Actions/History/Alerts), Security, GitOps, Fleet
Administration: Admin (7 tabs), Identity & Access, Production Readiness
Agent:          Agent Settings (Settings/Memory/Views tabs)
```

**Key routes:**
- `/welcome` — launchpad with quick stats, AI briefing, 8-card nav grid
- `/pulse` — health overview with topology map, insights rail, overnight activity
- `/incidents` — unified incident triage (5 tabs: Now, Investigate, Actions, History, Alerts)
- `/agent` — consolidated agent config (trust level, monitoring, memory, views management)
- `/identity` — merged Users + Groups + RBAC + Impersonation
- `/readiness` — production readiness wizard (30 gates, 6 categories)
- `/custom/:viewId` — AI-generated custom views (auto-saved, drag-drop grid layout)

**Merged/redirect routes:**
- `/alerts` → `/incidents?tab=alerts`
- `/builds` → `/workloads?tab=builds`
- `/crds` → `/admin?tab=crds`
- `/monitor` → `/incidents`
- `/reviews` → `/incidents?tab=actions`
- `/memory` → `/agent?tab=memory`
- `/views` → `/agent?tab=views`
- `/onboarding` → `/readiness`
- `/access-control` → `/identity?tab=rbac`
- `/users` → `/identity?tab=users`

**Dock panels**: Logs, Terminal, Events, Agent
**StatusBar**: Findings badge, Pending reviews badge, Degraded indicator, Agent toggle
**CommandBar**: `Cmd+K` with NL detection (Ask Pulse) for AI-powered queries

### Data Layer
- **API proxy**: All K8s calls go through `/api/kubernetes` → rspack dev proxy → `oc proxy :8001`
- **Query**: `engine/query.ts` — CRUD functions with TanStack Query
- **List+Watch**: `hooks/useK8sListWatch.ts` — REST list + WebSocket watch with 60s safety polling
- **Watch manager**: `engine/watch.ts` — singleton WebSocket manager with heartbeat/reconnect
- **Discovery**: `engine/discovery.ts` — discovers all resource types from `/apis` endpoint
- **Impersonation**: `getImpersonationHeaders()` in `engine/query.ts`

### State Management (Zustand stores)
| Store | Purpose | Persisted |
|-------|---------|-----------|
| `uiStore` | tabs, toasts, dock, namespace, impersonation, degradedReasons | yes (except degradedReasons) |
| `clusterStore` | cluster discovery, version, HyperShift detection | no |
| `monitorStore` | findings, predictions, actions, fix history | yes (partial) |
| `agentStore` | chat messages, streaming, confirmations | yes |
| `trustStore` | trust level (0-4), auto-fix categories | yes |
| `errorStore` | tracked K8s API errors by category | yes |
| `fleetStore` | multi-cluster connections, ACM detection | no |
| `argoCDStore` | ArgoCD availability, apps, sync status | no |
| `onboardingStore` | readiness gate results, waivers, wizard mode | yes |
| `reviewStore` | UI state for review queue (filters, tabs) | yes (partial) |

### Canonical Data Models (define once, import everywhere)
- **`engine/types/incident.ts`** — `IncidentItem`, `PrometheusAlert`, `FleetAlert` + 5 mapper functions
- **`engine/types/askPulse.ts`** — `AskPulseResponse`, `QuickAction`
- **`engine/readiness/types.ts`** — `ReadinessGate`, `GateResult`, `GateStatus`, `GatePriority`, `ReadinessReport`, `CategorySummary`
- **`engine/monitorClient.ts`** — `Finding`, `ResourceRef`, `ActionReport`, `Prediction`, `MonitorEvent`
- **`engine/fixHistory.ts`** — `ActionRecord`, `FixHistoryResponse`, `BriefingResponse`
- **`store/reviewStore.ts`** — `ReviewItem`, `RiskLevel`, `useAllReviews()` (maps from monitorStore)

### Agent Integration
- **Default agent mode**: `auto` — uses `/ws/agent` endpoint which auto-routes between SRE and Security based on query intent
- **Agent endpoint**: `/ws/agent?token=...` — auto-routing orchestrated agent (classifies intent per message)
- **Legacy endpoints**: `/ws/sre` and `/ws/security` still available for explicit mode selection
- **Monitor WebSocket**: `engine/monitorClient.ts` → `store/monitorStore.ts` — single connection via `agentNotifications.ts`
- **Ask Pulse**: `hooks/useAskPulse.ts` — dedicated `AgentClient` WebSocket for Cmd+K NL queries (separate from dock chat)
- **Trust level**: sent as integer (0-4) to backend, NOT as label string
- **Agent Chat**: `engine/agentClient.ts` → `store/agentStore.ts`
- **Confirmation flow**: `confirm_request` with nonce → UI shows dialog → `confirm_response` with nonce echoed back
- **Degraded mode**: `engine/degradedMode.ts` — 5 failure reasons, displayed via `DegradedBanner`
- **Auto-fix**: at trust level 3/4, monitor fixes crashloop (pod delete) and workloads (deployment restart) WITHOUT confirmation gate. Has safety guardrails: max 3/scan, 5min cooldown, no bare pods.
- **Agent version**: v1.13.0 (Protocol v2, 103 tools, 11 scanners)
- **Custom views**: auto-saved to PostgreSQL on `create_dashboard`, user-scoped via OAuth token
- **10 component types**: data_table, info_card_grid, chart, status_list, badge_list, key_value, relationship_tree, tabs, grid, section

### Incident Center (`/incidents`) — 5 tabs
- **Now**: unified feed from `useIncidentFeed` hook (findings + alerts + errors), silence management
- **Investigate**: correlation groups, evidence rendering (suspectedCause, evidence[], alternativesConsidered[])
- **Actions**: embedded ReviewQueueView — approve/reject AI-proposed changes with YAML diffs
- **History**: chronological stream + fix history
- **Alerts**: Prometheus alert rules, silences, firing alerts (merged from standalone `/alerts` view)

### Agent Settings (`/agent`) — 3 tabs
- **Settings**: trust level (0-4), monitoring toggle, scan now, auto-fix categories, communication style, eval score
- **Memory**: agent's learned runbooks, detected patterns, incident history (embedded MemoryView)
- **Views**: manage AI-generated custom dashboards (embedded ViewsManagement)

### Enhanced Pulse (`/pulse`)
- **Briefing**: `fetchBriefing(12)` via TanStack Query, shows current state ("Right now: N incidents, N findings")
- **Insights rail**: `useIncidentFeed({ limit: 5 })` for live incident cards, quick action pills
- **Overnight activity**: `monitorStore.recentActions` sorted by timestamp
- **Stat pills**: clickable node count, incident count, pending reviews → navigate to relevant views

### Ask Pulse (Cmd+K enhancement)
- **Detection**: `detectNaturalLanguage(query)` — heuristic (question words, word count, K8s patterns)
- **Agent**: dedicated `AgentClient` instance via ref-counted singleton (separate from dock chat)
- **Fallback**: `response: null` + "Agent offline" indicator when agent unavailable
- **UI**: `AskPulsePanel` with response text, suggestion pills, action buttons, "Open in Agent"

### Readiness Engine
- **Gates**: `engine/readiness/gates.ts` — 30 gates across 6 categories
- **Scoring**: `engine/readiness/scoring.ts` — weighted scoring, `isProductionReady()` with 80% threshold
- **UI bridge**: `components/onboarding/types.ts` — `CategoryView` + `buildCategoryViews()`
- **OnboardingView**: dual mode (wizard/checklist), uses `evaluateAllGates()` for real checks

### Unified Incident Feed
- **`hooks/useIncidentFeed.ts`** — merges 4 sources via canonical mappers, deduplicates by correlationKey, sorts by severity
- Sets `observability_unavailable` degraded reason on Prometheus failure
- Configurable: severity filter, limit, sources, timeRange

### UI Components
- **Primitives**: Panel, Card, DataTable, Badge, EmptyState, DegradedBanner, SearchInput, SectionHeader, StatCard, MetricGrid
- **Feedback**: Toast, ConfirmDialog, ProgressModal
- **Agent**: DockAgentPanel, AskPulsePanel, InlineAgent, AmbientInsight, ConfirmationCard, NLFilterBar
- **Onboarding**: ReadinessWizard, ReadinessChecklist, GateCard, ReadinessScore, WaiverDialog, CategoryStep

### Views (14 top-level)
- **Cluster**: Pulse (briefing + map + insights), Workloads (+Builds tab), Networking, Compute, Storage
- **Operations**: Incident Center (5 tabs: Now/Investigate/Actions/History/Alerts), Security, GitOps (ArgoCD), Fleet
- **Administration**: Admin (7 tabs), Identity (4 tabs), Production Readiness
- **Agent**: Agent Settings (Settings/Memory/Views), Custom Views

### Testing
- **Framework**: vitest + jsdom + @testing-library/react
- **Config**: `vitest.config.ts` — excludes `.claude/worktrees/**` and `e2e/`
- **Coverage thresholds**: 40% statements, 30% branches, 35% functions, 40% lines (enforced in vitest.config.ts)
- **Setup**: `src/kubeview/__tests__/setup.tsx` — factories, mock server, renderWithProviders
- **1,882 unit tests** across 160 files (~9s)
- **E2E**: Playwright (28 scenarios) — `npm run e2e` auto-starts mock K8s + dev server
- **E2E config**: `e2e/playwright.config.ts`, mock K8s in `e2e/mock-k8s-server.mjs`
- **Integration stack**: `docker compose -f e2e/docker-compose.yml up` for full UI + Agent + mock K8s

### Key Conventions
- Path alias: `@/` maps to `src/`
- CSS: Tailwind with slate/violet color scheme
- Icons: lucide-react
- State: Zustand with `persist` middleware, `openshiftpulse-` prefix
- Routing: react-router-dom v7
- Types: define once in `engine/types/` or `engine/readiness/`, import everywhere. **Never duplicate interfaces.**
- Feature flags: all default ON. Toggle in Admin. `isFeatureEnabled(flag)` to check. Current flags: `incidentCenter`, `identityView`, `welcomeLaunchpad`, `onboarding`, `reviewQueue`, `enhancedPulse`, `askPulse`
- Trust level: always send as integer (0-4), never as string label
- Confirmation nonce: always echo `nonce` from `confirm_request` back in `confirm_response`
- Welcome page: every element must be clickable and link to a valid route
- No mock data fallbacks: all features use real backend data, show empty/error states when unavailable

### Deploy to OpenShift
```bash
# Deploy UI + Agent together (always — never deploy UI-only)
./deploy/deploy.sh
# Agent repo auto-detected from ../pulse-agent or ~/ali/pulse-agent

# Skip image builds (reuse existing images)
./deploy/deploy.sh --skip-build

# Uninstall
./deploy/deploy.sh --uninstall
```
Helm umbrella chart in `deploy/helm/pulse/`. UI and agent always deployed together to prevent token/config drift. OAuth secrets (cookie-secret, client-secret) persist across upgrades via Helm `lookup()`. Container images go to `quay.io/amobrem/openshiftpulse` (UI) and `quay.io/amobrem/pulse-agent` (agent) — never use S2I builds on the cluster.

**Key deployment facts:**
- WS token stored in `pulse-ws-token` Secret, persists across upgrades
- OAuth cookie-expire: 168h (7 days), refresh: 1h
- Agent repo auto-detected; override with `PULSE_AGENT_REPO` env var or `--agent-repo`

### GitHub Pages
- **UI**: https://alimobrem.github.io/OpenshiftPulse/ (cyberpunk theme, `docs/index.html`)
- **Agent**: https://alimobrem.github.io/pulse-agent/ (cyberpunk theme, custom robot logo)
- Cross-linked between projects
- Screenshots captured via Playwright: `scripts/capture-screenshots.ts`
