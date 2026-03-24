<p align="center">
  <img src="docs/logo.svg" width="80" alt="OpenShift Pulse">
</p>

<h1 align="center">OpenShift Pulse</h1>

<p align="center">
  <strong>Next-generation OpenShift Console for Day-2 Operations</strong>
</p>

<p align="center">
  <a href="https://github.com/alimobrem/OpenshiftPulse/releases/tag/v4.2.0"><img src="https://img.shields.io/badge/version-v4.2.0-blue" alt="Version"></a>
  <img src="https://img.shields.io/badge/tests-1269%20passed-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/health%20checks-77+(31+cluster+%2B+46+domain)-orange" alt="Health Checks">
  <img src="https://img.shields.io/badge/security%20audit-passed-green" alt="Security Audit">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

Built with React, TypeScript, and real-time Kubernetes APIs. Every view is auto-generated from the API — browse any resource type, see what needs attention, and take action in seconds. Deployed with OAuth proxy for multi-user authentication.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| **OpenShift** | 4.12+ (including ROSA, ARO, HyperShift) |
| **Node.js** | 24+ |
| **oc CLI** | 4.12+ |
| **Browser** | Modern browser with WebSocket support |

## Screenshots

| | |
|---|---|
| ![Welcome](docs/screenshots/welcome.png) | ![Pulse](docs/screenshots/pulse.png) |
| **Welcome** — Quick navigation, cluster status | **Pulse** — Daily briefing, risk score, alerts |
| ![Workloads](docs/screenshots/workloads.png) | ![Compute](docs/screenshots/compute.png) |
| **Workloads** — Deployments, pods, health audit | **Compute** — Node metrics, CPU/memory |
| ![Table View](docs/screenshots/table-view.png) | ![YAML Editor](docs/screenshots/yaml-editor.png) |
| **Resource Tables** — Auto-generated, sortable | **YAML Editor** — Autocomplete, snippets, diff |
| ![Alerts](docs/screenshots/alerts.png) | ![Storage](docs/screenshots/storage.png) |
| **Alerts** — Severity filters, silence management | **Storage** — PVC health, capacity audit |
| ![Networking](docs/screenshots/networking.png) | ![Security](docs/screenshots/security.png) |
| **Networking** — Routes, policies, health audit | **Security** — Policy status, vulnerability context |
| ![Access Control](docs/screenshots/access-control.png) | ![Admin](docs/screenshots/admin.png) |
| **Access Control** — RBAC audit, cluster-admin review | **Admin** — Readiness, config, updates, snapshots |
| ![Builds](docs/screenshots/builds.png) | ![CRDs](docs/screenshots/crds.png) |
| **Builds** — BuildConfigs, ImageStreams | **CRDs** — Browse by API group, instances |
| ![Operator Catalog](docs/screenshots/operatorhub.png) | ![Admin Updates](docs/screenshots/admin-updates.png) |
| **Operator Catalog** — One-click install | **Cluster Updates** — Pre-checks, operator progress |

## Highlights

| | Feature | Details |
|---|---------|---------|
| | **77 Health Checks** | Automated cluster readiness (31) + domain-specific audits (46) with YAML fix examples |
| | **Daily Briefing** | Risk score ring, control plane status, certificate expiry, attention items with remediation steps |
| | **HyperShift Support** | Auto-detects hosted control plane clusters, adapts health checks, hides irrelevant Machine API panels |
| | **Incident Correlation Timeline** | Unified timeline merging alerts, events, rollouts, and config changes with correlation groups |
| | **Incident Context** | Events, logs (container picker), and metrics inline on detail views |
| | **Pod/Node Terminal** | Interactive WebSocket terminal with command history, suggestions, copy output |
| | **Deployment Rollback** | Revision history with container image diffs, one-click rollback with confirmation |
| | **Cluster Snapshots** | Capture cluster state, compare snapshots field-by-field to find what changed |
| | **Production Readiness** | 31-check automated score across infrastructure, security, observability, reliability |
| | **Dry-Run Validation** | Server-side dry-run before applying YAML changes |
| | **RBAC-Aware UI** | Actions hidden/disabled based on SelfSubjectAccessReview |
| | **User Impersonation** | Test as any user or service account — headers on all API calls |
| | **Real-time Watches** | WebSocket watches with 60s safety-net polling via TanStack Query |
| | **Typed K8s Interfaces** | 30+ TypeScript interfaces for K8s resources — 97% reduction in `as any` casts |
| | **Admin Overview** | Firing alerts, degraded operators, cert warnings, quota hot spots, health score at a glance |
| | **Helm Chart** | One-command deployment with auto-generated secrets and parameterized values |
| | **ACS/StackRox Detection** | Security audit detects Advanced Cluster Security installation |
| | **Security Hardened** | Passed 15-finding security audit — injection, SSRF, TLS, CSP, RBAC |
| | **1269 Tests** | 71 test files, 100% passing, ~3 seconds |

## Views

| View | Description |
|------|-------------|
| **Welcome** | Hero, cluster status, quick nav, start-here cards, all views grid, key capabilities, keyboard shortcuts |
| **Pulse** | 4-tab cluster health: Daily Briefing (risk score, CP status, certs, attention items), Issues, Runbooks, Namespace Health |
| **Workloads** | Metrics, health audit (6 checks), pod status, deployments, jobs |
| **Builds** | BuildConfigs with trigger buttons, build status/duration, ImageStreams with tags |
| **Networking** | Metrics, health audit (6 checks), endpoints, ingress, network policies |
| **Compute** | Metrics, health audit (6 checks), nodes with CPU/memory bars, MachineSets, MachineConfig. HyperShift-aware — hides Machine API when CP is external |
| **Storage** | Metrics, health audit (6 checks), capacity, CSI drivers, snapshots |
| **Alerts** | Severity filters, grouping, duration, silence lifecycle, runbooks |
| **Access Control** | RBAC audit (6 checks), recent RBAC changes (7 days) |
| **User Management** | Users/groups/SAs, impersonation, identity audit (6 checks), sessions |
| **CRDs** | Browse by API group, search, filter, instance navigation |
| **Security** | Security overview (10 checks incl. ACS detection), policy status, HyperShift-adapted |
| **Admin** | 9 tabs: Overview, Readiness (31 checks), Operators, Cluster Config (10 editable sections), Updates, Snapshots, Quotas, Certificates, Timeline |

## Features

### Health Audits (46 Domain Checks + 31 Cluster Checks = 77 Total)
Each overview view has an expandable audit with score %, per-resource pass/fail, "Why it matters" explanations, YAML fix examples, and direct "Edit YAML" links.

- **Workloads (6)**: Resource limits, liveness probes, readiness probes, PDBs, replicas, rolling update strategy
- **Storage (6)**: Default StorageClass, PVC binding, reclaim policy, WaitForFirstConsumer, volume snapshots, storage quotas
- **Networking (6)**: Route TLS, network policies, NodePort avoidance, ingress controller health, route admission, egress policies
- **Compute (6)**: HA control plane, dedicated workers, MachineHealthChecks, node pressure, kubelet version consistency, cluster autoscaling
- **Access Control (6)**: Default SA privileges, overprivileged bindings, wildcard rules, stale bindings, namespace isolation, automount tokens
- **Identity (6)**: Identity providers, kubeadmin removal, cluster-admin audit, SA privileges, inactive users, group membership
- **Security (10)**: TLS profiles, encryption at rest, network policies, secrets management, SCC audit, kubeadmin, cluster-admin audit, certificates, ACS/StackRox detection. HyperShift-adapted (skips TLS/encryption checks managed externally)

### HyperShift / Hosted Control Plane Support
Automatically detects HyperShift clusters via the Infrastructure resource (`controlPlaneTopology: External`) and adapts the entire UI:

- **Persistent "Hosted" badge** in the CommandBar — visible on every view
- **"Hosted Control Plane" badge** on Pulse daily briefing with tooltip
- **Health checks adapted** — HA CP, MachineHealthChecks, and Autoscaling checks skipped (irrelevant on hosted clusters)
- **Production Readiness adapted** — etcd backup and HA CP auto-pass with "Managed by hosting provider"
- **Machine Management hidden** — MachineSets, Machines, MHCs, Autoscaling panels replaced with info block explaining NodePool model
- **API queries gated** — Machine API requests skipped entirely on HyperShift (no unnecessary 404s)
- **Snapshot tracking** — `controlPlaneTopology` captured in snapshots for drift detection

### Daily Briefing (Pulse Overview)
4-zone risk assessment visible on the Pulse view:

- **Zone 1 — Heartbeat**: Risk score ring (0-100), control plane operator status, API latency (p99), etcd leader changes, certificate expiry warnings
- **Zone 2 — Capacity**: Node/pod/deployment counts, resource quotas, PV usage, pending pods
- **Zone 3 — Attention**: Degraded operators, unhealthy nodes, critical alerts, failed pods, expiring certificates — each with remediation steps
- **Zone 4 — Activity**: Recent events, deployment rollouts, scaling activity

### Cluster Snapshots & Comparison
Capture a point-in-time snapshot of your cluster state (ClusterVersion, nodes, operators, CRDs, storage classes, RBAC, config, topology). Compare any two snapshots field-by-field to find what changed — operators upgraded, CRDs added/removed, RBAC changes, config drift. Stored in localStorage (max 10 snapshots).

### Deployment Rollback
Every Deployment detail view shows revision history with container image diffs and ReplicaSet comparison. One-click rollback with ConfirmDialog — no kubectl required.

### Pod/Node Terminal
Interactive WebSocket exec terminal with GitHub-dark theme. Command history, copy output, clear, command suggestions. For nodes: privileged debug pod with host filesystem access.

### Dry-Run Validation
Server-side dry-run panel validates YAML changes before applying. Shows what would change, catches validation errors, and prevents accidental misconfigurations.

### Resource Creation (5 Modes)
The Create view offers 5 tabs: Quick Deploy (image + name), Templates (30 resource templates), Helm (real repo integration with validated release names), Import YAML (paste or upload), and Installed operators.

### Dock Panel
Resizable bottom panel for terminal and log sessions. Minimize, close, or drag-resize. IDE-like experience for debugging workflows.

### Incident Correlation Timeline
Unified timeline merging 4 data sources — Prometheus alerts, K8s events, deployment rollouts, and ClusterVersion/Operator config changes. Features:
- **Category toggles**: Enable/disable alerts, events, rollouts, config independently
- **Time ranges**: 15m, 1h, 6h, 24h, 3d, 7d (URL-persisted)
- **Correlation groups**: Related entries grouped by resource key with severity ranking
- **Vertical timeline**: Severity-colored dots, grouped by date, clickable resource links
- Available as a tab in Admin view

### Workload Health on Detail Views
Every Deployment, StatefulSet, and DaemonSet detail view shows per-container health checks: resource limits, resource requests, liveness probes, readiness probes, HA replicas, update strategy, and security context (runAsNonRoot, privilege escalation, capabilities). Expandable rows show probe descriptions.

### Builds
BuildConfigs with one-click trigger, average build duration, last build status. Builds table with status, strategy, duration, timestamps. In-progress and failed builds panels. ImageStreams with tag badges.

### Cluster Config (10 Editable Sections)
OAuth, Proxy, Image, Ingress, Scheduler, API Server (full editors). DNS (warning: breaks routing), Network (warning: cluster disruption), FeatureGate (warning: irreversible), Console (product name, logo, route, statuspage).

### Cluster Upgrades
Pre-update checklist (nodes ready, operators healthy, channel, etcd backup, PDBs), ClusterVersion conditions (Progressing/Failing banners), version skip indicators, risk badges, duration estimates, per-operator update progress during rolling upgrade, history with duration. HyperShift-aware — etcd backup check auto-passes on hosted clusters.

### Operator Catalog & Lifecycle
Browse 500+ operators. One-click install with 4-step progress tracking. Post-install guidance for 9+ operators. Full uninstall flow. Channel selector, namespace auto-suggestion. Helm install with validated release names and `--repo` flag (no shell injection).

### Alerts & Silence Management
Severity filters (Critical/Warning/Info), group by namespace or alertname, firing duration display, silenced indicators, runbook links, silence creation from any alert, silence expiration with confirmation.

### User Management & Impersonation
Users, groups, service accounts with role bindings. One-click impersonation — all API requests include `Impersonate-User` headers (CRLF-sanitized). Amber banner shows active impersonation across all views.

### Auto-Generated Resource Tables
Every resource type gets sortable columns, search, per-column filters, bulk delete, keyboard navigation (j/k), CSV/JSON export, Edit YAML + Delete on every row, and inline scale controls for deployments.

### Smart Diagnosis with Log Analysis
10 error patterns detected from pod logs: Permission denied, Connection refused, OOM, DNS failure, read-only filesystem, wrong architecture — each with specific fix suggestions.

### YAML Editor
CodeMirror with K8s autocomplete, YAML linting, Schema panel (from CRD OpenAPI), 71 context-aware sub-snippets (insert at cursor), 30 full resource templates, inline diff view, keyboard shortcuts help. Impersonation headers included on all save operations.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript 5.9 |
| **Bundler** | Rspack 1.7 (Rust-based, ~1s builds) |
| **State** | Zustand (client) + TanStack Query (server) |
| **Real-time** | WebSocket watches + 60s polling fallback |
| **Styling** | Tailwind CSS 3.4 |
| **Types** | 50+ typed K8s interfaces (`engine/types/`) |
| **Testing** | Vitest + jsdom (1269 tests, 71 files) |
| **Icons** | Lucide React (icon registry, ~50 icons) |
| **Charts** | Pure SVG sparklines (no chart library) |

## Getting Started

```bash
# Install dependencies
npm install

# Log in to your cluster
oc login --server=https://api.your-cluster.example.com:6443

# Start the API proxy
oc proxy --port=8001 &

# Copy the env example and configure for your cluster
# (optional — needed for Prometheus/Alertmanager proxying in dev)
cp .env.example .env
# Edit .env with your cluster's Thanos and Alertmanager route URLs

# Start the dev server (port 9000)
npm run dev
```

Open http://localhost:9000. Clear `openshiftpulse-ui-storage` from localStorage on first run to get default pinned tabs.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `K8S_API_URL` | No | `http://localhost:8001` | K8s API proxy target (via `oc proxy`) |
| `THANOS_URL` | No | *(disabled)* | Thanos Querier route URL for Prometheus proxy |
| `ALERTMANAGER_URL` | No | *(disabled)* | Alertmanager route URL |
| `CONSOLE_URL` | No | *(auto-detected)* | OpenShift Console URL for Helm API proxy |
| `OC_TOKEN` | No | *(auto-detected)* | Override for `oc whoami -t` token |

## Deploy to OpenShift

**Requires `cluster-admin` permissions** — the deployment creates cluster-scoped resources (ClusterRole, ClusterRoleBinding, OAuthClient).

### First-time setup

```bash
# Log in to your cluster (as cluster-admin)
oc login --server=https://api.your-cluster.example.com:6443

# Generate OAuth secrets
# - Client secret: any length, used for OAuthClient authentication
# - Cookie secret: must be exactly 16, 24, or 32 bytes for AES (required when pass_access_token=true)
CLIENT_SECRET=$(openssl rand -base64 32 | tr -d '\n')
COOKIE_SECRET=$(openssl rand -hex 16)  # 32 hex chars = 16 bytes

# Create namespace and secrets
oc create namespace openshiftpulse
oc create secret generic openshiftpulse-oauth-secrets \
  --from-literal=client-secret="$CLIENT_SECRET" \
  --from-literal=cookie-secret="$COOKIE_SECRET" \
  -n openshiftpulse

# Apply deployment manifests (creates ServiceAccount, RBAC, OAuthClient,
# ConfigMap, Deployment, PDB, ResourceQuota, LimitRange, Service, Route)
oc apply -f deploy/deployment.yaml

# Patch the OAuthClient with the generated client secret
oc patch oauthclient openshiftpulse \
  -p "{\"secret\":\"$CLIENT_SECRET\"}"

# Create a BuildConfig for binary builds
oc new-build --binary --name=openshiftpulse --to=openshiftpulse:latest -n openshiftpulse

# Build and deploy
npm run build
oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse

# Update the OAuthClient redirectURI to match your cluster's route
ROUTE=$(oc get route openshiftpulse -n openshiftpulse -o jsonpath='{.spec.host}')
oc patch oauthclient openshiftpulse --type merge \
  -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}"

# Restart to pick up the new image
oc rollout restart deployment/openshiftpulse -n openshiftpulse
```

### Deploy with Helm (recommended)

```bash
npm run build
helm install openshiftpulse deploy/helm/openshiftpulse/ -n openshiftpulse --create-namespace
oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse
```

Helm auto-generates OAuth secrets, creates all RBAC/Service/Route resources, and configures the OAuthClient. See `deploy/helm/openshiftpulse/values.yaml` for customization options (replicas, resources, route host).

### Quick redeploy (one-liner)

```bash
npm run build && oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse && oc rollout restart deployment/openshiftpulse -n openshiftpulse
```

### Uninstall

```bash
# Helm
helm uninstall openshiftpulse -n openshiftpulse
oc delete namespace openshiftpulse
oc delete clusterrole openshiftpulse-reader
oc delete clusterrolebinding openshiftpulse-reader
oc delete oauthclient openshiftpulse

# Manual (non-Helm)
oc delete -f deploy/deployment.yaml
```

### Upgrade

```bash
npm run build
oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse
oc rollout restart deployment/openshiftpulse -n openshiftpulse
```

### Security Model

| Layer | Mechanism |
|-------|-----------|
| **User authentication** | OAuth proxy sidecar with OAuthClient (`user:full` scope — required for write operations) |
| **User authorization** | User's OAuth token forwarded via `X-Forwarded-Access-Token` header to K8s API |
| **Service account** | Minimal ClusterRole (`openshiftpulse-reader`) with read-only access + token review for OAuth proxy |
| **Secrets** | OAuth client secret and cookie secret mounted from a K8s Secret via files (`--client-secret-file`, `--cookie-secret-file`) |
| **Container security** | `runAsNonRoot`, `readOnlyRootFilesystem`, drop ALL capabilities, seccomp RuntimeDefault |
| **TLS verification** | `proxy_ssl_verify on` with `ca.crt` for K8s API, `service-ca.crt` for Prometheus/Alertmanager |
| **HTTP headers** | CSP (`default-src 'self'`), X-Frame-Options DENY, HSTS, X-Content-Type-Options nosniff, Referrer-Policy |
| **Input validation** | Helm release names validated (`^[a-z0-9][a-z0-9-]{0,52}$`), PromQL sanitized, CRLF stripped from impersonation headers, regex escaped in log search |
| **SSRF protection** | Dev proxy validates URL protocol, blocks private/internal IPs |
| **Resource limits** | ResourceQuota (10 pods, 1 CPU, 1Gi memory) and LimitRange (per-container defaults and maximums) |

### Security Audit Results

A comprehensive security audit was performed covering authentication, injection vulnerabilities, sensitive data exposure, API security, deployment security, and client-side security. All 15 findings (1 critical, 4 high, 7 medium, 3 low) have been resolved:

| Severity | Finding | Resolution |
|----------|---------|------------|
| Critical | Helm command injection via `sh -c` | Validate release names, use array args with `--repo` flag |
| High | SSRF in dev proxy | Validate URL protocol, block private/link-local IPs |
| High | Impersonation CRLF injection | Strip `\r\n` from all impersonation header values |
| High | Missing nginx security headers | Added CSP, X-Frame-Options, HSTS, nosniff, Referrer-Policy |
| High | `proxy_ssl_verify off` | Enabled with correct CA certs (`ca.crt` for API, `service-ca.crt` for monitoring) |
| Medium | Prometheus label path injection | Validate label names against `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| Medium | Path traversal in `buildApiPathFromResource` | Apply `sanitizePathSegment` to namespace and name |
| Medium | Node log file path traversal | Validate filenames against `^[a-zA-Z0-9._-]+$` |
| Medium | RegExp DoS in log search | Escape regex special chars before `new RegExp()` |
| Medium | Missing `readOnlyRootFilesystem` | Added to both containers with emptyDir for writable paths |
| Medium | Placeholder secrets in manifest | Documented generation steps, added deployment validation |
| Medium | Broad `user:full` OAuth scope | Documented requirement (app performs write operations) |
| Low | Impersonation header format | Fixed to comma-separated `Impersonate-Group`, sanitized CRLF |
| Low | YAML editor missing impersonation | Added `getImpersonationHeaders()` to GET and PUT requests |
| Low | Token logging risk in dev | Documented in `.env.example` |

### What the deployment includes

| Component | Details |
|-----------|---------|
| **OAuth proxy** | Sidecar with explicit OAuthClient, `user:full` scope, per-user authentication |
| **nginx** | Reverse proxy forwarding user's `X-Forwarded-Access-Token` to K8s API, Prometheus, Alertmanager |
| **2 replicas** | PodDisruptionBudget (minAvailable: 1), topology spread across nodes |
| **Zero-downtime** | RollingUpdate with maxUnavailable: 0 |
| **Minimal RBAC** | Scoped ClusterRole with read-only access + token review — user actions use the user's own token |
| **ResourceQuota** | 10 pods, 1 CPU / 1Gi memory requests, 2 CPU / 2Gi limits, 50 configmaps, 20 secrets |
| **LimitRange** | Default 200m/256Mi per container, max 1 CPU/1Gi |
| **Security hardening** | readOnlyRootFilesystem, CSP headers, TLS verification, non-root containers |

### Troubleshooting

- **503 on login page**: Delete the TLS secret and re-add the `serving-cert-secret-name` annotation on the Service to trigger service-ca regeneration
- **403 on API calls**: Ensure the OAuthClient has `user:full` in `scopeRestrictions` — SA-based OAuth clients cannot use this scope
- **oauth-proxy crash (tokenreviews forbidden)**: The ClusterRole needs `tokenreviews` and `subjectaccessreviews` create permissions — re-apply `deploy/deployment.yaml`
- **oauth-proxy crash (cookie_secret must be 16/24/32 bytes)**: Regenerate cookie secret with `openssl rand -hex 16` (not base64)
- **Metrics blank (SSL certificate verify error)**: Prometheus/Alertmanager use service-ca certs — ensure nginx uses `service-ca.crt` (not `ca.crt`) for those upstreams
- **Build stuck/pending**: Check configmap quota (`oc get resourcequota -n openshiftpulse`) — builds need headroom for temp configmaps (set ≥50)
- **Pods not scheduling**: Check PDB and topology constraints — need ≥2 nodes for topology spread

## Testing

```bash
npm test              # Run all tests
npm run type-check    # TypeScript checking
```

### Test Results

```
 Test Files  71 passed (71)
      Tests  1269 passed (1269)
   Duration  ~3s
```

## Architecture

```
src/kubeview/
├── engine/              # Query, discovery, diagnosis, watch, snapshot, timeline, types/
│   └── types/           # 30+ typed K8s interfaces (Pod, Deployment, Node, etc.)
├── views/               # 14 view components + health audits + admin tabs
│   └── admin/           # Extracted admin tabs (Overview, Operators, Updates, Snapshots, etc.)
├── components/          # Shared UI (Panel, Card, InfoCard, MetricGrid, YamlEditor, Terminal, Dock)
├── hooks/               # useK8sListWatch, useCanI, useNavigateTab, useIncidentTimeline
├── store/               # Zustand (uiStore with impersonation, clusterStore with HyperShift detection)
├── routes/              # Route modules (resource, domain, redirects)
│   ├── resourceRoutes.tsx   # GVR wrapper components + resource routes
│   ├── domainRoutes.tsx     # Domain view routes (workloads, networking, etc.)
│   ├── redirects.tsx        # Legacy path redirects
│   └── index.ts             # Barrel export
└── App.tsx              # Shell + composed route children (~45 lines)
```

### Data Flow

```
Browser → OAuth Proxy (8443) → nginx (8080) → K8s API / Prometheus / Alertmanager
                ↓
        User's OAuth token forwarded via X-Forwarded-Access-Token
        (SA token NOT used for API calls — only for pod identity)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘K | Command Palette |
| ⌘. | Quick Actions |
| ⌘B | Resource Browser |
| ⌘J | Toggle Dock |
| Escape | Close overlays (priority-ordered) |
| j / k | Navigate table rows |

## Stats

| Metric | Value |
|--------|-------|
| Production files | ~140 |
| Tests | 1269 (100% passing) |
| Test files | 71 |
| Routes | 35 |
| Views | 14 |
| Health checks | 77 (31 cluster + 46 domain) |
| YAML templates | 30 + 71 context-aware snippets |
| Operators in catalog | 500+ |
| Error pattern detections | 10 |
| Security findings resolved | 15/15 |
| Build time | ~1s (Rspack) |
| Test time | ~3s |

---

## Contributing

```bash
npm install          # Install dependencies
cp .env.example .env # Configure cluster URLs
npm run dev          # Dev server on port 9000
npm test             # Run 1269 tests
npm run build        # Production build (~1s)
```

## License

MIT
