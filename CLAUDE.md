# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenShift Pulse — a React/TypeScript dashboard for OpenShift Day-2 operations. All data comes from live Kubernetes APIs (no mock data in production code). v5.16.2, ~200 source files, 1882 tests.

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

### Navigation Structure (14 views)
```
Home:     Welcome (launchpad — stats, briefing, nav cards, collapsible more views)
Operate:  Pulse, Incident Center, Reviews, Workloads (+Builds tab), Compute, Networking, Storage, Fleet
Govern:   Identity & Access, Security, GitOps
Platform: Admin (+CRDs tab, 10 tabs total), Onboarding
```

**Key routes:**
- `/welcome` — launchpad with quick stats, AI briefing, 8-card nav grid
- `/pulse` — health overview with topology map, insights rail, overnight activity
- `/incidents` — unified incident triage (5 tabs: Now, Investigate, Alerts, History, Config)
- `/reviews` — PR-style AI-proposed change review with approve/reject
- `/identity` — merged Users + Groups + RBAC + Impersonation
- `/onboarding` — production readiness wizard (30 gates, 6 categories)

**Merged routes (redirect to parent view):**
- `/alerts` → `/incidents?tab=alerts`
- `/builds` → `/workloads?tab=builds`
- `/crds` → `/admin?tab=crds`
- `/monitor` → `/incidents`

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
- **Agent version**: v1.9.3 (Protocol v2, 112 tools, 11 scanners)

### Incident Center (`/incidents`) — 5 tabs
- **Now**: unified feed from `useIncidentFeed` hook (findings + alerts + errors), silence management
- **Investigate**: correlation groups, evidence rendering (suspectedCause, evidence[], alternativesConsidered[])
- **Alerts**: Prometheus alert rules, silences, firing alerts (merged from standalone `/alerts` view)
- **History**: chronological stream + fix history
- **Config**: monitoring toggle, trust level (0-4), auto-fix categories, scan now

### Review Queue (`/reviews`)
- **Data**: `useAllReviews()` maps `monitorStore.pendingActions` + `recentActions` → `ReviewItem[]` (memoized)
- **Actions**: `approveReview` / `rejectReview` delegate to `monitorStore.approveAction` / `rejectAction`
- **UI**: tabs (Pending/Approved/Rejected), search, risk filter, expandable cards with YAML diffs
- **Connection indicator**: shows Live/Disconnected status from monitorStore

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
- **Operate**: Pulse (briefing + map + insights), Incident Center (5 tabs incl. Alerts), Reviews, Workloads (+Builds tab), Compute, Networking, Storage, Fleet
- **Govern**: Identity (4 tabs), Security, GitOps (ArgoCD)
- **Platform**: Admin (10 tabs: Overview, Readiness, Operators, Config, Updates, Snapshots, Quotas, Certificates, GitOps, CRDs), Onboarding

### Testing
- **Framework**: vitest + jsdom + @testing-library/react
- **Config**: `vitest.config.ts` — excludes `.claude/worktrees/**`
- **Setup**: `src/kubeview/__tests__/setup.tsx` — factories, mock server, renderWithProviders
- **1882 tests** across 141 files

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
# UI only (quick) — build locally, push to Quay
npm run build && podman build -t quay.io/amobrem/openshiftpulse:latest . && podman push quay.io/amobrem/openshiftpulse:latest && oc rollout restart deployment/openshiftpulse -n openshiftpulse

# Full stack (UI + Agent)
./deploy/deploy.sh --agent-repo ../pulse-agent

# Agent only (quick)
cd ../pulse-agent && ./deploy/quick-deploy.sh openshiftpulse
```
Helm chart in `deploy/helm/openshiftpulse/`. OAuth proxy, 2 replicas, PDB, topology spread. WS token auto-synced from agent secret on re-deploys. Container images go to `quay.io/amobrem/openshiftpulse` (UI) and `quay.io/amobrem/pulse-agent` (agent) — never use S2I builds on the cluster.

### GitHub Pages
- **UI**: https://alimobrem.github.io/OpenshiftPulse/ (cyberpunk theme, `docs/index.html`)
- **Agent**: https://alimobrem.github.io/pulse-agent/ (cyberpunk theme, custom robot logo)
- Cross-linked between projects
- Screenshots captured via Playwright: `scripts/capture-screenshots.ts`
