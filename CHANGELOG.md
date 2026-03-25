# Changelog

## [5.3.0] - 2026-03-25

### Added
- **Claude Harness** — optimizations for getting the most out of the agent:
  - Dynamic Tool Selection: 8 categories (diagnostics, workloads, networking, security, storage, monitoring, operations, gitops), reduces 54→15-25 tools per query
  - Prompt Caching: system prompt + runbooks cached via `cache_control: ephemeral` (~90% cost reduction)
  - Cluster Context Injection: pre-fetches node count, namespaces, OCP version, failing pods, firing alerts (saves 2-3 tool calls)
  - Component Rendering Hints: guides Claude to focus on analysis, not data formatting
- **Version Contract** — `/version` endpoint returns protocol version, tool count, features; UI warns on mismatch
- **Deploy Script** (`deploy/deploy.sh`) — single command deploys both Pulse UI + Agent with matching auth tokens
- **Integration Test** (`deploy/integration-test.sh`) — 13-check verification: pods, health, version, tools, WS auth, nginx proxy, OAuth, Vertex AI, NetworkPolicy
- **HTML Dashboard Rendering** — agent-generated HTML renders in sandboxed iframe with expand/minimize
- **Build Cancel Button** — stop icon on running/pending builds, patches `status.cancelled: true`

### Fixed
- **WebSocket auth** — nginx injects WS token at proxy level (not via JS sub_filter)
- **nginx resolver** — static proxy_pass for WS locations (no variable-based routing)
- **Build logs** — uses OpenShift Build API instead of Pod API
- **Browser performance** — streaming deltas batched via requestAnimationFrame, MessageBubble memoized
- **SSRF IPv6** — dev proxy blocks IPv6 loopback, mapped, unique local, link-local

### Stats
- **1472 tests** across 97 test files
- **17 views**, 45+ routes
- **54 agent tools** with dynamic selection harness
- **0 npm CVEs**, all Red Hat UBI images
- **13-check integration test** for deployment verification

---

## [5.2.0] - 2026-03-24

### Added
- **Dynamic UI Generation** — Agent tools render rich interactive components inline in chat:
  - `ComponentSpec` protocol: data_table, info_card_grid, badge_list, status_list, key_value, chart
  - `AgentComponentRenderer` maps specs to existing primitives (DataTable, InfoCard, Badge, MetricsChart)
  - `MarkdownRenderer` for text responses (headers, bold, code blocks, lists) — no npm dependency
  - 4 tools enhanced: `list_pods`, `list_deployments`, `get_events`, `top_pods_by_restarts` return structured tables
  - Auto-colored status/severity columns in rendered tables
  - New WebSocket event type: `component` with tool-emitted specs
- **Cancel/Stop button** — Red square button (or Escape key) aborts running agent queries, saves partial response
- **Edit last message** — Pencil button loads last user message back into input for re-submission
- **Build logs** — Uses OpenShift Build API (`/apis/build.openshift.io/v1/.../builds/{name}/log`) instead of Pod API

### Fixed
- **Browser memory/performance** — Streaming deltas batched via `requestAnimationFrame` instead of per-token re-renders; `MessageBubble` wrapped in `React.memo`; message history capped at 100 in memory / 50 persisted
- **SSRF IPv6 bypass** — Dev proxy helmrepo endpoint now blocks IPv6 loopback, IPv4-mapped, unique local, and link-local addresses
- **Helm values** — Added `agent.serviceName` default to prevent template rendering error
- **Build log 404s** — Build view was fetching pod logs for build names; now uses correct Build API endpoint

### Stats
- **1472 tests** across 97 test files
- **17 views**, 45+ routes
- **54 agent tools** with 4 returning rich UI component specs
- **0 npm CVEs**, all Red Hat UBI images

---

## [5.1.0] - 2026-03-24

### Added
- **AI Agent Integration** — Claude-powered SRE diagnostics and security scanning embedded in the Pulse UI:
  - Chat interface at `/agent` with SRE and Security modes
  - WebSocket streaming with thinking indicators, tool execution badges
  - Confirmation gates for write operations with plain English descriptions, risk levels, keyboard shortcuts (Y/N)
  - Context-aware "Ask Agent" action on every resource detail page
  - Namespace-aware quick prompts that adapt to selected namespace
  - Chat persistence across navigation (localStorage via zustand persist)
  - Copy button and timestamps on all messages
  - Full ARIA accessibility (role="log", role="article", role="alertdialog", aria-live)
- **Pulse Agent backend** ([pulse-agent](https://github.com/alimobrem/pulse-agent)) — 54 tools:
  - 39 read diagnostics: pods, nodes, deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Ingresses, Routes, HPAs, PDBs, LimitRanges, ReplicaSets, services (with endpoints), TLS certificates, operator subscriptions
  - Prometheus/PromQL queries via Thanos, Alertmanager alert triage
  - `top_pods_by_restarts`, `get_recent_changes` convenience tools
  - 9 write operations: scale, restart, cordon, uncordon, delete pod, rollback deployment, drain node, apply YAML (server-side apply with dry-run), create network policy (with dry-run)
  - Cluster ConfigMap audit trail with retry-on-409
  - 10 built-in runbooks (CrashLoopBackOff, ImagePullBackOff, OOMKilled, Node NotReady, PVC Pending, DNS failures, etc.)

### Security (from architecture + sysadmin review)
- Replaced wildcard RBAC `patch */*` with scoped rules (apps, batch, autoscaling only)
- Fixed event loop threading in WebSocket API (captured loop before thread)
- Added context field sanitization to prevent prompt injection
- Added 1MB message size limit on WebSocket receive
- Removed `force:true` from server-side apply
- Added dry-run validation to network policy creation
- Fixed NetworkPolicy to allow ingress on port 8080
- Added audit retry-on-409 with microsecond key precision
- Sanitized error messages (no internal details to client)
- Added reconnect jitter to prevent thundering herd
- Fixed handler memory leak in agentStore

### Changed
- Production nginx config proxies `/api/agent/` to pulse-agent service
- rspack dev server proxies `/api/agent` to `PULSE_AGENT_URL` (default localhost:8080)
- CommandPalette and WelcomeView include Agent entry
- README updated with AI Agent comparison row, 17 views, 54 tools

### Stats
- **1472 tests** across 97 test files
- **17 views**, 45+ routes
- **54 agent tools** (39 read + 9 write + 6 audit)
- **0 npm CVEs**, all Red Hat UBI images

---

## [5.0.0] - 2026-03-24

### Added
- **Multi-Cluster Fleet Management** — 6-phase implementation:
  - Phase 1: Cluster-aware engine layer (query, watch, discovery, snapshot all gain `clusterId`)
  - Phase 2: Fleet Dashboard at `/fleet` with cluster cards, health scores, setup guide
  - Phase 3: Cluster Switcher in CommandBar with `Cmd+Shift+C`, StatusBar active cluster
  - Phase 4: Cross-cluster search in Command Palette, CompareView, FleetSnapshotView
  - Phase 5: FleetResourceView, FleetWorkloadsView, FleetAlertsView with correlation badges
  - Phase 6: ComplianceView with security matrix, certificate heat map, RBAC baseline, config drift
- **Health Score Engine** — composite 0-100 score from nodes, operators, alerts, pods
- **Fleet Engine** — `fleetList`, `fleetSearch`, `fleetCount`, `fleetAlertCorrelation` with Promise.allSettled resilience
- **Cluster Connection Manager** — `getClusterBase(clusterId?)` replacing hardcoded K8S_BASE, supports local/ACM-proxy/direct-proxy
- **Fleet Store** — ACM auto-detection, health polling (60s), cluster registration/switching
- **Enhanced ArgoCD** — sync failure details, external URLs, deployed images, pruning warnings, condition timeline, resource history panel, live state diff, Argo Rollouts (canary/blue-green), AppProjects
- **17 ArgoCD security fixes** from 5-agent review (SSRF validation, ARIA, sanitization, impersonation)

### Changed
- All engine functions (`k8sList`, `k8sGet`, `k8sPatch`, etc.) now accept optional `clusterId` — fully backward compatible
- WebSocket watch keys include cluster ID for multi-cluster isolation
- API discovery cached per-cluster instead of globally
- Snapshot capture supports `clusterId`, cross-cluster comparison
- Progressive disclosure: multi-cluster UI only appears when 2+ clusters connected

### Stats
- **1438 tests** across 94 test files
- **16+ views**, 40+ routes
- **0 npm CVEs**, all Red Hat UBI images
- **6 custom agents**, 4 automated hooks

---

## [4.4.0] - 2026-03-24

### Added
- **Capacity Planning** — predict_linear() projections for CPU, memory, disk, and pods with days-until-exhaustion cards, trend sparklines, and configurable lookback (7d/30d/90d). New "Capacity Planning" tab in Compute view.
- **NodePool visibility for HyperShift** — Real NodePool panel with instance type, autoscaling, auto-repair, conditions. NodePool Health audit check. Instance type fallback via node label.
- **GitOps Repository readiness check** — Production Readiness now checks if ArgoCD is installed AND Git repo is connected in Pulse. Links to Admin → GitOps for setup.
- **ControlPlaneMetrics** in Admin Overview — API server latency (p99), error rate, etcd leader, WAL fsync sparklines.
- **ArgoCD in Pulse daily briefing** — Out-of-sync applications surface as attention items.
- **GitOps config tab** in Admin view (10th tab) for Git provider setup.
- **MetricGrid primitive** adopted across 16 files (18 replacements).
- **Full test coverage** — all views and components now have tests (DependencyView, LogsView, MetricsView, NodeLogsView, PodTerminal added).
- **6 custom agents** — deploy-validator, changelog-writer, api-compatibility, performance-auditor, screenshot-updater, migration-guide.
- **Automated hooks** — pre-commit/push tests, post-write lint, async deploy validation, screenshot capture on release.

### Changed
- **Welcome page** — Added GitOps and Timeline tiles, GitOps/ArgoCD and Incident Timeline capability rows, fixed security check count (9→10).
- **Command Palette** — Added GitOps entry, updated Admin subtitle with all 10 tabs.
- **Logo** — Replaced "P" letter with pulse/heartbeat line design (blue-violet gradient).
- **Compute view** — Refactored to tabbed layout (Overview + Capacity Planning).

### Fixed
- **Timeline TypeError** — guarded against undefined entries/correlationGroups on initial render.
- CHANGELOG.md updated with v4.3.0 entry (was missing).

### Stats
- **1347 tests** across 83 test files
- **77 health checks** (31 cluster + 46 domain)
- **15 views**, 35 routes
- **6 custom agents**, **4 automated hooks**

---

## [4.3.0] - 2026-03-24

### Added
- **ArgoCD deep integration** — 5-phase implementation: auto-detection, sync badges on every resource, `/gitops` view (Applications, Sync History, Drift Detection), Git provider abstraction (GitHub/GitLab/Bitbucket), three-option save dialog (Apply+PR / PR Only / Apply Only)
- **NodePool visibility for HyperShift** — Real NodePool panel replaces static info card, shows instance type, autoscaling, auto-repair, conditions. NodePool Health audit check.
- **Incident Correlation Timeline** — Unified timeline merging Prometheus alerts, K8s events, deployment rollouts, and ClusterVersion/Operator config changes with correlation groups
- **Admin Overview redesign** — Firing alerts banner, named degraded operators, recent Warning events, certificate expiry warnings, quota hot spots, cluster health score, loading/error states
- **Control Plane Metrics** — API server latency (p99), error rate, etcd leader status, WAL fsync duration sparklines
- **Helm chart** — One-command deployment with auto-generated OAuth secrets (`deploy/helm/openshiftpulse/`)
- **SECURITY.md** — Comprehensive security documentation (model, audit, RBAC, hardening, checklist)
- **GitOps config tab** in Admin view for configuring Git provider, repo, and token

### Changed
- **Typed K8s interfaces** — 50+ interfaces in `engine/types/`, reduced `as any` from 179 to 5 (97%)
- **AdminView split** — 1412→488 lines, extracted OverviewTab, OperatorsTab, UpdatesTab, SnapshotsTab
- **CSS cleanup** — Removed dead PatternFly deps (4 packages), centralized chart colors (`engine/colors.ts`), Card primitive adopted (89 replacements), terminal theme extracted to CSS variables
- **Container images** — All Red Hat UBI (replaced Docker Hub nginx), pinned tags (ose-oauth-proxy:v4.17, nginx:1.26-ubi9)
- **Dependencies** — Replaced deprecated `xterm` with `@xterm/xterm`, resolved 6 high-severity CVEs, npm audit: 0 vulnerabilities
- **Logo** — Replaced "P" letter with pulse/heartbeat line design
- **README** — Professional redesign with comparison table, collapsible sections, for-the-badge badges

### Fixed
- Back button uses browser history instead of hardcoded list path
- Quota parsing uses `parseResourceValue` for correct K8s quantity units (was showing 30000%)
- SecurityView adapted for HyperShift (skips TLS/encryption checks managed externally)
- Cluster-admin threshold now a named constant (was hardcoded 3)
- Alert filter state persisted in URL search params
- Deployments sorted unhealthy-first in WorkloadsView
- Multiple audit checks expandable simultaneously (Set instead of string)
- Channel selector uses dropdown instead of free-text input
- `parseQuantity` handles Ei, Pi, and decimal SI units
- CPU metrics use `kube_node_info` join for reliable node name matching

### Stats
- **1308 tests** across 76 test files (up from 1162/63 in v4.1.0)
- **77 health checks** (31 cluster + 46 domain)
- **15 views**, 35 routes
- **0 npm CVEs**

---

## [4.1.0] - 2026-03-19

### Added
- **HyperShift / Hosted Control Plane support** — Auto-detects hosted clusters via Infrastructure resource (`controlPlaneTopology: External`). Adapts health checks, production readiness, and compute view for hosted control plane model.
- **Persistent topology badge** — "Hosted" pill in CommandBar visible on every view when running on a HyperShift cluster.
- **"Hosted Control Plane" badge** on Pulse daily briefing with tooltip explaining the hosting model.
- **Control Plane InfoCard** in Admin overview showing topology type (Hosted/Self-managed) and API server URL.
- **Snapshot topology tracking** — `controlPlaneTopology` captured in cluster snapshots and included in diff comparisons.
- **Prerequisites section** in README with OCP, Node.js, oc CLI, and browser requirements.

### Changed
- **Health checks adapted for HyperShift** — HA Control Plane, MachineHealthChecks, and Cluster Autoscaling checks skip on hosted clusters (irrelevant when CP is external). Production Readiness shows "Hosted Control Plane: Managed externally" as auto-pass.
- **Etcd backup check** auto-passes on HyperShift with "Managed by hosting provider" instead of SSH backup instructions.
- **Worker Nodes check** threshold adjusted to 1+ on HyperShift (vs 2+ on traditional) since all nodes are workers.
- **Machine Management section** hidden on HyperShift ComputeView with info block explaining NodePool model.
- **Machine API queries gated** — Machines, MachineSets, MachineHealthChecks, MachineAutoscalers, and ClusterAutoscaler queries disabled on HyperShift clusters (`enabled: !isHyperShift`) to avoid unnecessary API calls.
- **AdminView** unified to read `isHyperShift` from `useClusterStore` instead of deriving locally, matching all other views.
- **Create button hidden** for Nodes in resource browser (nodes are provisioned via MachineSet/NodePool, not created directly).
- **README rewritten** — Added 10 previously undocumented features, fixed stale test/health check counts, added all keyboard shortcuts, added prerequisites section.

### Fixed
- Control plane operator list on Pulse no longer shows missing operators as broken on HyperShift — only shows operators that actually exist in the cluster.
- Health check count corrected from 67 to 76 (Security view's 9 checks were previously uncounted).

### Stats
- **1162 tests** across 63 test files (up from 1128/61 in v4.0.0)
- **76 health checks** (31 cluster + 45 domain)
- **13 views**, 35 routes
- Build time: ~1s (Rspack)

---

## [4.0.0] - 2026-03-15

### Added
- **Project renamed** from ShiftOps to **OpenShift Pulse**
- **New logo** — Blue gradient P with sparkles (`docs/logo.svg`)
- **Favicon** — Inline SVG P letter in `public/index.html`
- **Welcome view** — Hero, cluster status, Pulse CTA, quick nav, start-here cards, all views grid, key capabilities showcase, keyboard shortcuts
- **Pulse view** — 4-tab cluster health: Daily Briefing (risk score ring, CP status, certs, attention items), Issues, Runbooks, Namespace Health
- **Security view** — 9-check security audit, policy status, vulnerability context
- **Admin view** — 9 tabs: Overview, Readiness (31 checks), Operators, Cluster Config (10 editable sections), Updates, Snapshots, Quotas, Certificates, Timeline
- **Cluster Snapshots** — Capture and compare cluster state (ClusterVersion, nodes, operators, CRDs, storage classes, RBAC, config)
- **Cluster Timeline** — Event timeline with 1h/6h/24h ranges, severity filters, namespace filtering
- **Production Readiness** — 31-check automated score across infrastructure, security, observability, reliability
- **Deployment Rollback** — Revision history with container image diffs, one-click rollback
- **Pod/Node Terminal** — WebSocket exec with GitHub-dark theme, command history, suggestions
- **Dry-Run Validation** — Server-side dry-run before applying YAML changes
- **Dock Panel** — Resizable bottom panel for terminal and log sessions
- **Resource Creation** — 5 modes: Quick Deploy, Templates, Helm, Import YAML, Installed operators
- **Operator Catalog** — Browse 500+ operators, one-click install with 4-step progress tracking
- **Smart Diagnosis** — 10 error patterns detected from pod logs with fix suggestions
- **User Impersonation** — `Impersonate-User` headers on all API calls, CRLF-sanitized
- **WebSocket watches** — Real-time resource updates with 60s polling fallback
- **OAuth proxy deployment** — 2 replicas, PDB, topology spread, zero-downtime, security hardened

### Security
- Passed 15-finding security audit (1 critical, 4 high, 7 medium, 3 low — all resolved)
- Helm command injection, SSRF, CRLF injection, path traversal, RegExp DoS — all fixed
- CSP, HSTS, X-Frame-Options, TLS verification, readOnlyRootFilesystem
