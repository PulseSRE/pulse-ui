# ShiftOps

A next-generation OpenShift Console — scored **93/100** by a Senior SysAdmin reviewer and recommended as **"primary tool for single-cluster day-2 operations."** Built with React, TypeScript, and real-time Kubernetes APIs. Every view is auto-generated from the API — browse any resource type, see what needs attention, and take action in seconds.

**Live on cluster**: Deployed with OAuth proxy for multi-user authentication.

## Highlights

- **67 automated health checks** across cluster readiness and domain-specific audits
- **36 workload/storage/networking/compute/RBAC/identity checks** with per-resource pass/fail, YAML fix examples, and "Edit YAML" links
- **Workload health audit on detail pages** — 7 checks per Deployment/StatefulSet/DaemonSet
- **RBAC-aware UI** — actions hidden/disabled based on user permissions
- **User impersonation** — test as any user or service account
- **Metrics sparklines** on every overview page with threshold-based colors
- **Alert silence lifecycle** — create, pre-fill from alerts, expire
- **Operator lifecycle** — install, progress tracking, post-install guidance, uninstall
- **1103 tests** across 66 test files

## Pages

| Page | Description |
|------|-------------|
| **Pulse** | Cluster health overview with 4 tabs: Overview, Issues, Runbooks, Namespace Health |
| **Workloads** | Metrics, health audit (6 checks), pod status, deployments, jobs |
| **Builds** | BuildConfigs with trigger buttons, build status/duration, ImageStreams with tags |
| **Networking** | Metrics, health audit (6 checks), endpoints, ingress, network policies |
| **Compute** | Metrics, health audit (6 checks), nodes with CPU/memory bars, MachineConfig |
| **Storage** | Metrics, health audit (6 checks), capacity, CSI drivers, snapshots |
| **Alerts** | Severity filters, grouping, duration, silence lifecycle, runbooks |
| **Access Control** | RBAC audit (6 checks), recent RBAC changes (7 days) |
| **User Management** | Users/groups/SAs, impersonation, identity audit (6 checks), sessions |
| **Software** | Installed inventory, operators, Quick Deploy, Helm, templates, Import YAML |
| **Admin** | 8 tabs: Readiness (31 checks), Cluster Config (10 editable sections), Updates (pre-update checklist + operator progress), Snapshots (RBAC+config), Quotas, Timeline |

## Features

### Health Audits (36 Domain Checks + 31 Cluster Checks = 67 Total)
Each overview page has an expandable audit with score %, per-resource pass/fail, "Why it matters" explanations, YAML fix examples, and direct "Edit YAML" links.

- **Workloads (6)**: Resource limits, liveness probes, readiness probes, PDBs, replicas, rolling update strategy
- **Storage (6)**: Default StorageClass, PVC binding, reclaim policy, WaitForFirstConsumer, volume snapshots, storage quotas
- **Networking (6)**: Route TLS, network policies, NodePort avoidance, ingress controller health, route admission, egress policies
- **Compute (6)**: HA control plane, dedicated workers, MachineHealthChecks, node pressure, kubelet version consistency, cluster autoscaling
- **Access Control (6)**: Default SA privileges, overprivileged bindings, wildcard rules, stale bindings, namespace isolation, automount tokens
- **Identity (6)**: Identity providers, kubeadmin removal, cluster-admin audit, SA privileges, inactive users, group membership

### Workload Health on Detail Pages
Every Deployment, StatefulSet, and DaemonSet detail page shows per-container health checks: resource limits, resource requests, liveness probes, readiness probes, HA replicas, update strategy, and security context (runAsNonRoot, privilege escalation, capabilities). Expandable rows show probe descriptions.

### Builds
BuildConfigs with one-click trigger, average build duration, last build status. Builds table with status, strategy, duration, timestamps. In-progress and failed builds panels. ImageStreams with tag badges.

### Cluster Config (10 Editable Sections)
OAuth, Proxy, Image, Ingress, Scheduler, API Server (full editors). DNS (warning: breaks routing), Network (warning: cluster disruption), FeatureGate (warning: irreversible), Console (product name, logo, route, statuspage).

### Cluster Upgrades
Pre-update checklist (nodes ready, operators healthy, channel, etcd backup, PDBs), ClusterVersion conditions (Progressing/Failing banners), version skip indicators, risk badges, duration estimates, per-operator update progress during rolling upgrade, history with duration.

### Operator Catalog & Lifecycle
Browse 500+ operators. One-click install with 4-step progress tracking. Post-install guidance for 9+ operators. Full uninstall flow. Channel selector, namespace auto-suggestion.

### Alerts & Silence Management
Severity filters (Critical/Warning/Info), group by namespace or alertname, firing duration display, silenced indicators, runbook links, silence creation from any alert, silence expiration with confirmation.

### User Management & Impersonation
Users, groups, service accounts with role bindings. One-click impersonation — all API requests include `Impersonate-User` headers. Amber banner shows active impersonation across all pages.

### Auto-Generated Resource Tables
Every resource type gets sortable columns, search, per-column filters, bulk delete, keyboard navigation (j/k), CSV/JSON export, Edit YAML + Delete on every row, and inline scale controls for deployments.

### Smart Diagnosis with Log Analysis
10 error patterns detected from pod logs: Permission denied, Connection refused, OOM, DNS failure, read-only filesystem, wrong architecture — each with specific fix suggestions.

### YAML Editor
CodeMirror with K8s autocomplete, YAML linting, Schema panel (from CRD OpenAPI), 71 context-aware sub-snippets (insert at cursor), 30 full resource templates, inline diff view, keyboard shortcuts help.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript 5.9 |
| **Bundler** | Rspack 1.7 (Rust-based, ~1s builds) |
| **State** | Zustand (client) + TanStack Query (server) |
| **Real-time** | WebSocket watches + 60s polling fallback |
| **Styling** | Tailwind CSS 3.4 |
| **Testing** | Vitest + jsdom + MSW (1103 tests) |
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

# Start the dev server (port 9000)
npm run dev
```

Open http://localhost:9000. Clear `shiftops-ui-storage` from localStorage on first run to get default pinned tabs.

## Deploy to OpenShift

### First-time setup

```bash
# Log in to your cluster
oc login --server=https://api.your-cluster.example.com:6443

# Apply deployment manifests (creates Namespace, ServiceAccount, OAuthClient,
# ConfigMap, Deployment, PDB, Service, Route)
oc apply -f deploy/deployment.yaml

# Create a BuildConfig for binary builds
oc new-build --binary --name=shiftops --to=shiftops:latest -n shiftops

# Update the OAuthClient redirectURI to match your cluster's route
ROUTE=$(oc get route shiftops -n shiftops -o jsonpath='{.spec.host}')
oc patch oauthclient shiftops --type merge \
  -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}"
```

### Build and deploy

```bash
# Build the frontend
npm run build

# Build container image and push to internal registry
oc start-build shiftops --from-dir=. --follow -n shiftops

# Restart pods to pick up the new image
oc rollout restart deployment/shiftops -n shiftops
```

### Quick redeploy (one-liner)

```bash
npm run build && oc start-build shiftops --from-dir=. --follow -n shiftops && oc rollout restart deployment/shiftops -n shiftops
```

### What the deployment includes

| Component | Details |
|-----------|---------|
| **OAuth proxy** | Sidecar with explicit OAuthClient, `user:full` scope, per-user authentication |
| **nginx** | Reverse proxy forwarding user's `X-Forwarded-Access-Token` to K8s API, Prometheus, Alertmanager |
| **2 replicas** | PodDisruptionBudget (minAvailable: 1), topology spread across nodes |
| **Zero-downtime** | RollingUpdate with maxUnavailable: 0 |
| **Security** | runAsNonRoot, drop ALL capabilities, seccomp RuntimeDefault |
| **TLS** | Auto-generated by OpenShift service-ca, reencrypt route termination |

### Troubleshooting

- **503 on login page**: Delete the TLS secret and re-add the `serving-cert-secret-name` annotation on the Service to trigger service-ca regeneration
- **403 on API calls**: Ensure the OAuthClient has `user:full` in `scopeRestrictions` — SA-based OAuth clients cannot use this scope
- **Build stuck/pending**: Check configmap quota (`oc get resourcequota -n shiftops`) — builds need headroom for temp configmaps (set ≥50)
- **Pods not scheduling**: Check PDB and topology constraints — need ≥2 nodes for topology spread

## Testing

```bash
npm test              # Run 1103 tests
npm run type-check    # TypeScript checking
```

## Architecture

```
src/kubeview/
├── engine/              # Query (with impersonation), discovery, diagnosis, renderers
├── views/               # 18 page components + health audits
├── components/          # Shared UI (ClusterConfig, Sparkline, YamlEditor, etc.)
├── hooks/               # useK8sListWatch, useCanI (RBAC), useNavigateTab
├── store/               # Zustand (uiStore with impersonation, clusterStore)
└── App.tsx              # 22 routes
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘K / ⌘. | Command Palette |
| ⌘B | Resource Browser |
| j / k | Navigate table rows |

## Stats

- **100+** production files
- **1103** tests across 66 files
- **22** routes
- **30** YAML templates + 71 context-aware sub-snippets
- **67** automated health checks (31 cluster + 36 domain)
- **500+** operators in catalog
- **10** error pattern detections
- **93/100** SysAdmin review score

## SysAdmin Review Score: 93/100

| Dimension | Score |
|-----------|-------|
| Day-1 Usefulness | 9/10 |
| Incident Response | 9/10 |
| Operational Efficiency | 10/10 |
| Learning & Discovery | 10/10 |
| Production Readiness | 10/10 |
| Operator Management | 9/10 |
| Multi-cluster / Enterprise | 7/10 |
| Trust & Safety | 10/10 |
| Completeness vs OCP Console | 9/10 |
| Would Recommend | 10/10 |

> "Primary tool for single-cluster day-2 operations. ShiftOps would be my default tab."

## License

MIT
