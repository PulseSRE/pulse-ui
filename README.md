<p align="center">
  <img src="docs/logo.svg" width="100" alt="OpenShift Pulse">
</p>

<h1 align="center">OpenShift Pulse</h1>

<p align="center">
  <strong>Next-generation OpenShift Console for Day-2 Operations</strong><br>
  <em>Built for the platform engineer who checks their cluster at 8am Monday morning.</em>
</p>

<p align="center">
  <a href="https://github.com/alimobrem/OpenshiftPulse/releases/tag/v5.14.1"><img src="https://img.shields.io/badge/release-v5.14.1-2563eb?style=for-the-badge" alt="Version"></a>
  <img src="https://img.shields.io/badge/tests-1884%20passed-10b981?style=for-the-badge" alt="Tests">
  <img src="https://img.shields.io/badge/health%20checks-77-f59e0b?style=for-the-badge" alt="Health Checks">
  <img src="https://img.shields.io/badge/CVEs-0-10b981?style=for-the-badge" alt="CVEs">
  <img src="https://img.shields.io/badge/license-MIT-6366f1?style=for-the-badge" alt="License">
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#-screenshots">Screenshots</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-deploy-to-openshift">Deploy</a> &bull;
  <a href="API_CONTRACT.md">API Contract</a> &bull;
  <a href="SECURITY.md">Security</a> &bull;
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

Real-time Kubernetes dashboard built with React, TypeScript, and WebSocket watches. Browse any resource type, see what needs attention, and take action — all through your cluster's OAuth. No external database. No agents to install. Just deploy and go.

### Why Pulse?

| | OpenShift Console | Lens | Rancher | **Pulse** |
|---|:---:|:---:|:---:|:---:|
| AI-powered SRE agent (Claude) | | | | **Yes** |
| Multi-cluster fleet dashboard | | | Yes | **Yes** |
| Cross-cluster search & comparison | | | Partial | **Yes** |
| Fleet compliance matrix | | | | **Yes** |
| 77 automated health checks with YAML fixes | | | | **Yes** |
| ArgoCD integration with auto-PR on save | | | | **Yes** |
| Incident correlation timeline | | | | **Yes** |
| Capacity planning with projections | | | | **Yes** |
| HyperShift / ROSA native | Partial | | | **Yes** |
| In-browser pod terminal | Yes | Yes | Yes | **Yes** |
| Zero install (OAuth SSO) | Yes | | | **Yes** |

---

## Quick Start

```bash
npm install && oc login && oc proxy --port=8001 &
npm run dev    # http://localhost:9000
```

## Screenshots

<details>
<summary><strong>Click to expand 12 screenshots</strong></summary>

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
| **Networking** — Routes, policies, health audit | **Security** — Policy status, ACS detection |
| ![Access Control](docs/screenshots/access-control.png) | ![Admin](docs/screenshots/admin.png) |
| **Access Control** — RBAC audit, cluster-admin review | **Admin** — Alerts, operators, certs, quotas |

</details>

---

## Features

### At a Glance

| Category | What You Get |
|----------|-------------|
| **AI Agent** | Claude-powered SRE diagnostics and security scanning. 68 tools, 10 runbooks, dynamic UI rendering (tables, charts, cards), dashboard generation, prompt caching, dynamic tool selection, cluster context injection. [pulse-agent](https://github.com/alimobrem/pulse-agent) |
| **Predictive AI** | Live cluster-aware smart prompts: AI suggestions reflect actual issues (crash-looping pods, degraded operators, pending PVCs) not generic templates. Integrated into Command Palette (`?` mode), dock agent panel, and empty states. |
| **Native AI Layer** | Unified intelligence layer across all surfaces: smart prompts adapt to cluster state, AI query mode in Command Palette (`?`), violet-branded AI surfaces, auto-expanding InlineAgent for unhealthy resources, "Ask AI" buttons on PulseView attention items, first-run onboarding, dock notification dot for background insights |
| **Ambient AI** | AI insights on every resource detail view, inline "Ask about this" agent, natural language table filters, dock agent panel, proactive background notifications, fleet-wide AI analysis |
| **Error Intelligence** | Structured PulseError classification (7 categories), actionable suggestions on every error toast, "Ask AI" button for agent-assisted diagnosis, Admin > Errors tab for ops visibility, error tracking store with persistence |
| **Multi-Cluster Fleet** | Fleet dashboard with health scores, cluster switcher (`Cmd+Shift+C`), cross-cluster search, compliance matrix, certificate heat map, RBAC comparison, config drift detection. Auto-detects ACM/MCE managed clusters. |
| **Cluster Health** | 77 automated checks (31 cluster + 46 domain) with YAML fix examples and "Why it matters" explanations |
| **Daily Briefing** | Risk score ring, control plane status, certificate expiry, attention items with remediation steps. "Cluster Zen" calm state when everything is healthy. |
| **Instant Navigation** | Hover-prefetch preloads view data before click — navigation feels instant with zero skeleton flash. Applied to Welcome tiles and Command Palette. |
| **Incident Center** | Consolidates Monitor + Alerts + Errors + Timeline into 4 tabs: Now (live findings), Investigate (alerts + errors + AI root-cause investigation reports), Actions (auto-fix history + post-fix verification), History (correlated timeline). Trust controls are backend-capability-aware. |
| **Identity & Access** | Unified view merging User Management + Access Control into a single surface for users, groups, service accounts, RBAC audit, and impersonation |
| **Incident Timeline** | Unified timeline merging alerts, events, rollouts, and config changes with correlation groups |
| **Admin Overview** | Firing alerts, named degraded operators, cert warnings, quota hot spots, health score, and Agent quality gate status with PASS/FAIL emphasis — the 8am view |
| **ArgoCD / GitOps** | 4-step setup wizard (operator install → git config → first app → verify), sync badges, auto-PR on save, drift detection, Rollouts (canary/blue-green), Projects. GitHub, GitLab, Bitbucket. |
| **Capacity Planning** | predict_linear() projections for CPU, memory, disk, pods with days-until-exhaustion and trend charts |
| **HyperShift** | Auto-detects hosted control planes, adapts checks, hides irrelevant Machine API panels |
| **Production Readiness Program** | 30 gates across 6 categories (infrastructure, security, observability, reliability, operations, compliance). Wizard + checklist modes, blocking gates, waiver workflow, continuous re-checks on schedule |
| **Degraded Mode UX** | Standardized failure handling across all views — graceful degradation with inline error states, retry actions, and partial data rendering when APIs are unavailable |
| **Feature Flags** | localStorage-based feature flag system with toggle UI in Admin. Gate unreleased features, A/B test surfaces, disable features without redeployment |
| **Security** | 10 audit checks incl. ACS/StackRox detection, HyperShift-adapted. [Full details](SECURITY.md) |

### Operations

| Feature | Details |
|---------|---------|
| **AI Agent** | Chat with Claude-powered SRE/Security agent. "Ask Agent" from any resource. Streaming, tool execution indicators, confirmation gates. |
| **Native AI UX** | Unified violet-branded intelligence layer: `?` in Command Palette sends to agent, smart prompts adapt to cluster state, "Ask AI" on PulseView attention items, auto-expand InlineAgent for unhealthy resources, AI empty state suggestions, first-run onboarding card, dock agent notification dot. |
| **Ambient AI** | AmbientInsight cards on pod/workload detail views. InlineAgent scoped conversations on every resource. NL table filters via AI-branded button. Agent dock panel accessible from any view. Background proactive notifications every 5 min. |
| **Rich Confirmations** | Visual confirmation cards with risk badges (LOW/MEDIUM/HIGH), impact preview, rollback info, keyboard shortcuts (Y/N/Esc). |
| **Deployment Rollback** | Revision history with container image diffs, one-click rollback |
| **Pod/Node Terminal** | WebSocket exec with command history, copy output, GitHub-dark theme |
| **Cluster Snapshots** | Capture state, compare field-by-field to find what changed |
| **Dry-Run Validation** | Server-side dry-run before applying YAML changes |
| **RBAC-Aware UI** | Actions disabled with explanatory tooltips based on SelfSubjectAccessReview |
| **User Impersonation** | Test as any user/SA — headers on all API calls, amber banner |
| **Real-time Watches** | WebSocket + 60s polling fallback via TanStack Query |

### Developer Experience

| Feature | Details |
|---------|---------|
| **YAML Editor** | CodeMirror with K8s autocomplete, schema panel, 71 snippets, inline diff |
| **Resource Creation** | 5 modes: Quick Deploy, Templates (30), Helm, Import YAML, Operators |
| **Operator Catalog** | 500+ operators, one-click install, 4-step progress tracking |
| **Smart Diagnosis** | 10 error patterns from pod logs with specific fix suggestions |
| **Auto-Generated Tables** | Sortable, searchable, j/k navigation, CSV/JSON export |

### Views (15)

| View | Highlights |
|------|-----------|
| **Welcome** | Quick nav, cluster status with error recovery, all capabilities clickable, keyboard shortcuts |
| **Pulse** | Daily briefing with 4-zone risk assessment. "Cluster Zen" calm state when healthy. Fleet mode: cluster health table, risk scores, AI analysis |
| **Workloads** | Metrics + 6-check health audit, deployments sorted unhealthy-first |
| **Compute** | Node metrics, CPU/memory bars, HyperShift-aware |
| **Storage** | PVC health, capacity audit, CSI drivers |
| **Networking** | Routes, network policies, ingress health |
| **Alerts** | Severity filters, silence lifecycle, URL-persisted filters |
| **Builds** | BuildConfigs, ImageStreams, one-click trigger |
| **Access Control** | RBAC audit (6 checks), recent changes |
| **User Management** | Users/groups/SAs, impersonation, identity audit |
| **CRDs** | Browse by API group, search, filter |
| **Security** | 10 checks, SCC audit, ACS detection |
| **GitOps** | 4-step setup wizard, ArgoCD Applications, sync history, drift, Rollouts (canary/blue-green), Projects |
| **Fleet** | Multi-cluster dashboard, cross-cluster search, comparison, compliance, cert heat map |
| **Admin** | 11 tabs: Overview, Readiness, Operators, Config, Updates, Snapshots, Quotas, Certificates, GitOps, Errors, Timeline |

---

## Tech Stack

| | Technology | Why |
|---|-----------|-----|
| **Framework** | React 19 + TypeScript 5.9 | Type-safe, 50+ K8s interfaces |
| **Bundler** | Rspack 1.7 | Rust-based, ~1s production builds |
| **State** | Zustand + TanStack Query | Client + server state separation |
| **Real-time** | WebSocket watches | Instant updates, 60s polling fallback |
| **Styling** | Tailwind CSS 3.4 + Radix UI | Utility-first, headless components, CVA variants |
| **Testing** | Vitest + jsdom | 1888 tests in ~4s |
| **Charts** | Pure SVG sparklines | Zero chart library dependency |
| **Security** | Red Hat UBI images | 0 CVEs, all images from Red Hat registries |

---

## Deploy to OpenShift

> **Requires `cluster-admin`** — creates ClusterRole, ClusterRoleBinding, OAuthClient.

### One-Command Deploy (UI + Agent)

```bash
# Option A: Vertex AI (GCP)
ANTHROPIC_VERTEX_PROJECT_ID=your-project CLOUD_ML_REGION=us-east5 \
  ./deploy/deploy.sh --agent-repo /path/to/pulse-agent --gcp-key ~/sa-key.json

# Option B: Anthropic API (no GCP needed)
ANTHROPIC_API_KEY=sk-ant-... ./deploy/deploy.sh --agent-repo /path/to/pulse-agent

# Verify
./deploy/integration-test.sh
```

Auto-detects cluster domain, OAuth proxy image, monitoring stack. Prerequisite checks for `oc`, `helm`, `npm`. Fails early with clear fix instructions if credentials are missing.

**WS token auto-sync**: On every deploy (initial or re-deploy), `deploy.sh` automatically reads the WS token from the agent's Kubernetes Secret and injects it into the UI's nginx proxy configuration. This ensures the UI and agent always share the same authentication token — no manual token management or coordination needed.

### Helm (UI only)

```bash
npm run build
helm install openshiftpulse deploy/helm/openshiftpulse/ -n openshiftpulse --create-namespace
oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse
```

Auto-generates OAuth secrets. See [`values.yaml`](deploy/helm/openshiftpulse/values.yaml) for customization.

<details>
<summary><strong>Manual setup (without Helm)</strong></summary>

```bash
oc login --server=https://api.your-cluster.example.com:6443

CLIENT_SECRET=$(openssl rand -base64 32 | tr -d '\n')
COOKIE_SECRET=$(openssl rand -hex 16)

oc create namespace openshiftpulse
oc create secret generic openshiftpulse-oauth-secrets \
  --from-literal=client-secret="$CLIENT_SECRET" \
  --from-literal=cookie-secret="$COOKIE_SECRET" \
  -n openshiftpulse

helm template openshiftpulse deploy/helm/openshiftpulse/ \
  -n openshiftpulse \
  --set oauthProxy.clientSecret="$CLIENT_SECRET" \
  --set oauthProxy.cookieSecret="$COOKIE_SECRET" \
  | oc apply -f -
oc patch oauthclient openshiftpulse -p "{\"secret\":\"$CLIENT_SECRET\"}"
oc new-build --binary --name=openshiftpulse --to=openshiftpulse:latest -n openshiftpulse

npm run build
oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse

ROUTE=$(oc get route openshiftpulse -n openshiftpulse -o jsonpath='{.spec.host}')
oc patch oauthclient openshiftpulse --type merge \
  -p "{\"redirectURIs\":[\"https://${ROUTE}/oauth/callback\"]}"
oc rollout restart deployment/openshiftpulse -n openshiftpulse
```

</details>

### Quick Redeploy

```bash
npm run build && oc start-build openshiftpulse --from-dir=dist --follow -n openshiftpulse && oc rollout restart deployment/openshiftpulse -n openshiftpulse
```

### CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | PR, push to main | Type check + lint + test + build + npm audit |
| `build-push.yml` | `v*` tag push, manual | Builds image, pushes to `quay.io/amobrem/openshiftpulse` |

**To release:**
```bash
git tag v5.14.0 && git push origin v5.14.0
# GitHub Actions builds and pushes to Quay.io
```

**Required GitHub Secrets:** `QUAY_USERNAME`, `QUAY_PASSWORD` (robot account `amobrem+cibot`)

### Uninstall

```bash
# Helm
helm uninstall openshiftpulse -n openshiftpulse
oc delete namespace openshiftpulse
oc delete clusterrole openshiftpulse-reader
oc delete clusterrolebinding openshiftpulse-reader
oc delete oauthclient openshiftpulse
```

### Security

OAuth proxy with per-user auth. Non-root containers, read-only filesystem, CSP headers, TLS verification. 15/15 audit findings resolved. 0 npm CVEs. All images from Red Hat registries. See **[SECURITY.md](SECURITY.md)** for full details.

<details>
<summary><strong>Troubleshooting</strong></summary>

| Problem | Fix |
|---------|-----|
| 503 on login | Delete TLS secret, re-add `serving-cert-secret-name` annotation |
| 403 on API calls | OAuthClient needs `user:full` in `scopeRestrictions` |
| oauth-proxy crash (tokenreviews) | ClusterRole needs tokenreviews/subjectaccessreviews — re-apply manifests |
| cookie_secret error | Regenerate with `openssl rand -hex 16` (not base64) |
| Metrics blank (SSL error) | Use `service-ca.crt` (not `ca.crt`) for Prometheus/Alertmanager |
| Build stuck | Check configmap quota (`oc get resourcequota`) — need headroom (set >=50) |
| Pods not scheduling | Need 2+ nodes for topology spread constraints |

</details>

---

## Development

```bash
npm install          # Install dependencies
cp .env.example .env # Configure cluster URLs (optional)
oc proxy --port=8001 & # Start API proxy
npm run dev          # Dev server on port 9000
npm test             # Run test suite once
npm run build        # Production build (~1s)
npm run type-check   # TypeScript checking
```

| Variable | Default | Description |
|----------|---------|-------------|
| `K8S_API_URL` | `http://localhost:8001` | K8s API proxy target |
| `THANOS_URL` | *(disabled)* | Thanos Querier for Prometheus metrics |
| `ALERTMANAGER_URL` | *(disabled)* | Alertmanager for alert management |
| `PULSE_AGENT_URL` | `http://localhost:8080` | Pulse Agent API server for AI diagnostics |

---

## Architecture

```
src/kubeview/
├── engine/              # Query, discovery, watch, snapshot, timeline
│   └── types/           # 50+ typed K8s interfaces
├── views/               # 15 views + admin tabs
│   └── admin/           # Overview, Operators, Updates, Snapshots, Quotas, Certificates, Errors
├── components/          # Design system primitives, feedback, YAML editor, Terminal, Dock
│   ├── primitives/      # Button, Card, Badge, Tabs, Input, Tooltip, DataTable, StatCard, SectionHeader
│   ├── feedback/        # Toast, ConfirmDialog, ProgressModal, InlineFeedback
│   └── agent/           # MessageBubble, InlineAgent, AmbientInsight, ConfirmationCard, NLFilterBar, DockAgentPanel
├── hooks/               # useK8sListWatch, useCanI, useSmartPrompts, usePrefetchOnHover
├── store/               # Zustand (UI, cluster, fleet, agent state)
└── App.tsx              # Shell + routes (~45 lines)
```

```
Browser --> OAuth Proxy (8443/TLS) --> nginx (8080) --> K8s API / Prometheus / Alertmanager
                  |                                  \
          User's OAuth token forwarded               --> Pulse Agent (8080/WS) --> Claude API + K8s API
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Command Palette |
| `Cmd+B` | Resource Browser |
| `Cmd+J` | Toggle Dock |
| `Cmd+.` | Quick Actions |
| `j / k` | Navigate table rows |
| `Esc` | Close overlays |

---

<p align="center">
  <strong>1884 tests</strong> &bull; <strong>77 health checks</strong> &bull; <strong>~1s builds</strong> &bull; <strong>0 CVEs</strong> &bull; <strong>15 views</strong> &bull; <strong>68 AI tools</strong> &bull; <strong>500+ operators</strong>
</p>

<p align="center">
  <a href="https://github.com/alimobrem/OpenshiftPulse/releases">Releases</a> &bull;
  <a href="SECURITY.md">Security</a> &bull;
  <a href="CHANGELOG.md">Changelog</a> &bull;
  <a href="https://github.com/alimobrem/OpenshiftPulse/issues">Issues</a>
</p>

<p align="center">MIT License</p>
