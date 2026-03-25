# Changelog

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
