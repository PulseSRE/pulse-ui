# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenShift Pulse — a React/TypeScript dashboard for OpenShift Day-2 operations. All data comes from live Kubernetes APIs (no mock data in production code). v6.1.0, ~200 source files, 1944 unit tests + 53 E2E scenarios.

## Commands

```bash
# Dev server (requires `oc proxy --port=8001` running separately)
pnpm dev                 # rspack dev server on port 9000

# Build
pnpm build               # production build (~1s)

# Tests
pnpm exec vitest --run   # run all unit tests (~9s, 1944 tests)
pnpm exec vitest --run src/kubeview/views/__tests__/WorkloadsView.test.tsx  # single file
pnpm exec vitest --run -t "test name pattern"  # single test by name

# Helm chart validation (no cluster needed)
./deploy/test-helm.sh    # 12 tests: lint, template, security, token leak check

# Type checking
pnpm type-check          # tsc --noEmit

# Full verify
pnpm verify              # type-check + strict + lint + test + build

# E2E tests (auto-starts mock K8s + dev server)
pnpm e2e                 # headless Playwright
pnpm e2e:headed          # visible browser
pnpm e2e:ui              # Playwright UI mode

# Lint & format
pnpm lint                # eslint with --fix
pnpm format              # prettier

# Screenshots (requires Playwright + live cluster)
PULSE_URL=https://... PULSE_USER=cluster-admin PULSE_PASS=... pnpm exec tsx scripts/capture-screenshots.ts
```

## Architecture

### Entry & Routing
- **Entry**: `src/index.tsx` → `src/kubeview/App.tsx` (`OpenshiftPulseApp`)
- **Shell**: `components/Shell.tsx` wraps all routes (CommandBar + TabBar + Dock + StatusBar)
- **Routes**: `routes/resourceRoutes.tsx` (generic CRUD), `routes/domainRoutes.tsx` (domain views), `routes/redirects.tsx` (legacy + feature-gated redirects)
- URL pattern for resources: `/r/{group~version~plural}/{namespace}/{name}` (GVR encoding uses `~` separator)
- **Feature flags**: Removed — all features shipped. `engine/featureFlags.ts` deleted.

### Navigation Structure
```
Cluster:        Pulse, Workloads (+Builds tab), Networking, Compute, Storage
Operations:     Incident Center (Now/Investigate/Actions/Postmortems/History/Alerts), Impact Analysis, Security, GitOps, Fleet
Administration: Admin (7 tabs), Identity & Access, Production Readiness
Agent:          Mission Control (Trust Policy/Agent Health/Agent Accuracy/Capability Discovery), Toolbox (Catalog/Skills/Connections/Components/Usage/Analytics)
```

**Key routes:**
- `/welcome` — launchpad with quick stats, AI briefing, 8-card nav grid
- `/pulse` — health overview with topology map, insights rail, overnight activity
- `/incidents` — unified incident triage (6 tabs: Now, Investigate, Actions, Postmortems, History, Alerts)
- `/topology` — impact analysis / dependency graph with blast radius visualization
- `/agent` — agent config (trust level, scanners, memory, views, evals)
- `/toolbox` — tools catalog, skills management, MCP connections, component registry, usage log, analytics
- `/identity` — merged Users + Groups + RBAC + Impersonation
- `/readiness` — production readiness wizard (30 gates, 6 categories)
- `/custom/:viewId` — AI-generated custom views (auto-saved, drag-drop grid layout)

**Merged/redirect routes:**
- `/tools` → `/toolbox`
- `/extensions` → `/toolbox?tab=skills`
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
- **Agent version**: v2.2.0 (Protocol v2, 111 tools [75 native + 36 MCP], 17 scanners)
- **MCP integration**: OpenShift MCP server with 11 toolsets, 36 tools including Prometheus queries and Helm management
- **Skills**: 8 skill packages (sre, security, view_designer, capacity_planner, postgres_troubleshooter, plan-builder, postmortem, slo-management) with hot reload, routing, version history, and AI-generated skill badges
- **Custom views**: auto-saved to PostgreSQL on `create_dashboard`, user-scoped via OAuth token
- **19 component types**: data_table, info_card_grid, chart, status_list, badge_list, key_value, relationship_tree, tabs, grid, section, log_viewer, yaml_viewer, metric_card, node_map, resource_counts, bar_list, progress_list, donut_chart, summary_bar

### Incident Center (`/incidents`) — 6 tabs
- **Now**: unified feed from `useIncidentFeed` hook (findings + alerts + errors), silence management, inline investigation phase progress
- **Investigate**: correlation groups, evidence rendering (suspectedCause, evidence[], alternativesConsidered[])
- **Actions**: embedded ReviewQueueView — approve/reject AI-proposed changes with YAML diffs
- **Postmortems**: auto-generated postmortem reports with timeline, root cause, blast radius, prevention recommendations
- **History**: chronological stream + fix history
- **Alerts**: Prometheus alert rules, silences, firing alerts (merged from standalone `/alerts` view)

### Mission Control (`/agent`) — single page, 4 sections + 3 drawers
- **Trust Policy**: trust level slider (0-4), impact preview, auto-fix categories, communication style
- **Agent Health**: quality gate card, scanner coverage card, outcomes card (click to open detail drawers)
- **Agent Accuracy**: quality trend, override rate, recurring issues, learning activity (collapsible)
- **Capability Discovery**: contextual recommendations with dismiss + inline actions
- **Drawers**: Scanner detail, Eval suite breakdown, Agent Memory (slide-over panels)

### Toolbox (`/toolbox`) — 6 tabs
- **Catalog**: all tools (native + MCP) with source badges, search, mode/source filter
- **Skills**: skill packages with editor, version history, diff viewer, routing tester, investigation plan templates section, AI-generated skill badges
- **Connections**: MCP server management with 11 toolset toggles
- **Components**: 19 component kinds by category with mutation support
- **Usage**: tool invocation audit log with source (native/mcp) column
- **Analytics**: merged tool stats + skill usage + by-source breakdown + handoffs

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
- **Operations**: Incident Center (6 tabs: Now/Investigate/Actions/Postmortems/History/Alerts), Impact Analysis, Security, GitOps (ArgoCD), Fleet
- **Administration**: Admin (7 tabs), Identity (4 tabs), Production Readiness
- **Agent**: Mission Control (4 sections + 3 drawers), Toolbox (6 tabs), Custom Views

### Testing
- **Framework**: vitest + jsdom + @testing-library/react
- **Config**: `vitest.config.ts` — excludes `.claude/worktrees/**` and `e2e/`
- **Coverage thresholds**: 40% statements, 30% branches, 35% functions, 40% lines (enforced in vitest.config.ts)
- **Setup**: `src/kubeview/__tests__/setup.tsx` — factories, mock server, renderWithProviders
- **1,944 unit tests** across 163 files (~9s)
- **E2E**: Playwright (53 test cases across 6 specs) — `pnpm e2e` auto-starts mock K8s + agent (podman) + dev server, tears down containers after
- **E2E config**: `e2e/playwright.config.ts`, mock K8s in `e2e/mock-k8s-server.mjs`, agent+pg in `e2e/docker-compose.agent.yml`
- **E2E agent stack**: `e2e/start-agent.sh` / `e2e/stop-agent.sh` — starts real agent + PostgreSQL in podman containers
- Do not use `sed` to edit test files — use the Edit tool instead. Sed commands have repeatedly mangled test files requiring manual cleanup.

### Code Quality
- Path alias: `@/` maps to `src/`
- State: Zustand with `persist` middleware, `openshiftpulse-` prefix
- Routing: react-router-dom v7
- Types: define once in `engine/types/` or `engine/readiness/`, import everywhere. **Never duplicate interfaces.**
- This project uses TypeScript strictly. Always ensure imports are valid, types are correct, and avoid introducing type regressions when editing files. Run `tsc --noEmit` after making changes to TypeScript files.

### UI Framework & Styling
- CSS: Tailwind with slate/violet color scheme
- Icons: lucide-react
- When working with PatternFly (PF6), always check the PF6 API docs for component prop placement (e.g., selectableActions goes on CardHeader not Card). Do not assume PF5 patterns.
- For dark-mode UI work, always verify text visibility, dropdown/menu contrast, and avoid glassmorphism effects that reduce readability. Test all CSS changes against both light and dark themes.
- Feature flags: all shipped and removed. `engine/featureFlags.ts` deleted.
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

## Deployment

When deploying to OpenShift clusters, always verify NetworkPolicy egress rules, image pull access, and OAuth/TLS configuration before the first deploy attempt. Run a pre-deploy checklist rather than iterating through failures.

**Pre-deploy checklist (run before every deploy):**
1. `./deploy/test-helm.sh` — validate Helm charts locally (12 tests, no cluster needed)
2. `oc whoami` — verify cluster auth works
3. `oc get networkpolicy -n openshiftpulse` — check egress allows agent → Kubernetes API, Prometheus, Vertex AI
4. `podman login --get-login quay.io` — verify image push access
5. `oc get secret openshiftpulse-oauth-secrets -n openshiftpulse` — verify OAuth secrets exist (or will be created)
6. Verify `ANTHROPIC_VERTEX_PROJECT_ID` or `ANTHROPIC_API_KEY` is set

When fixing PostgreSQL deployment issues, validate password encoding, avoid reserved SQL keywords in schema, and check SERIAL/sequence conflicts before the first deploy. Prefer testing with a local PG instance first.

**Secret rotation procedures:**
- **OAuth cookie-secret**: `oc delete secret openshiftpulse-oauth-secrets -n openshiftpulse` then redeploy. All users must re-login.
- **OAuth client-secret**: Same as above. Also update OAuthClient: `oc patch oauthclient openshiftpulse -p '{"secret":"NEW_SECRET"}'`
- **WS token**: `oc delete secret pulse-ws-token -n openshiftpulse` then redeploy. New token auto-generated and shared between UI and agent.
- **GCP SA key**: `oc delete secret gcp-sa-key -n openshiftpulse` then redeploy with `--gcp-key /path/to/new-key.json`
- **Anthropic API key**: `oc delete secret anthropic-api-key -n openshiftpulse` then redeploy with `ANTHROPIC_API_KEY=new-key`
- **PostgreSQL password**: `oc delete secret pulse-openshift-sre-agent-pg-auth -n openshiftpulse` then redeploy. Requires PostgreSQL pod restart.

### GitHub Pages
- **UI**: https://alimobrem.github.io/OpenshiftPulse/ (cyberpunk theme, `docs/index.html`)
- **Agent**: https://alimobrem.github.io/pulse-agent/ (cyberpunk theme, custom robot logo)
- Cross-linked between projects
- Screenshots captured via Playwright: `scripts/capture-screenshots.ts`
