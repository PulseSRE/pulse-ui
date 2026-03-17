# OpenShiftView

A next-generation OpenShift Console built with React, TypeScript, and real-time Kubernetes APIs. Every view is auto-generated from the API — browse any resource type, see what needs attention, and take action in seconds.

![Cluster Pulse](docs/screenshots/pulse.png)

## Features

### Cluster Pulse — Your Landing Page
See only what matters: failing pods, degraded operators, unhealthy deployments, unready nodes, and cluster CPU/memory at a glance. When everything is healthy, it tells you so.

![Pulse View](docs/screenshots/pulse-healthy.png)

### Auto-Generated Resource Tables
Every resource type in your cluster gets a fully functional table with sortable columns, search, per-column filters, bulk operations, keyboard navigation (j/k/Enter), CSV/JSON export, and a preview panel — all auto-detected from the resource data.

![Table View](docs/screenshots/table-view.png)

### Resource Detail with Actions
Full resource detail with inline actions: scale deployments, restart pods, open terminal, view logs, edit YAML, navigate dependencies. Smart diagnosis automatically identifies CrashLoopBackOff, OOM, scheduling failures, and suggests fixes.

![Detail View](docs/screenshots/detail-view.png)

### Interactive Troubleshooting
Auto-diagnose cluster issues with interactive runbooks. Six built-in playbooks cover CrashLoopBackOff, ImagePull errors, pending pods, deployment rollout failures, node issues, and storage problems — each showing affected resources inline with direct action buttons.

![Troubleshoot View](docs/screenshots/troubleshoot.png)

### Cluster Config Editor
Configure OAuth identity providers, proxy settings, image registry policies, scheduler profiles, TLS security, and ingress — all with proper forms, validation, and real API patches.

![Cluster Config](docs/screenshots/cluster-config.png)

### Cluster Updates & Snapshots
Initiate cluster upgrades, change update channels, and track update history. Capture cluster configuration snapshots, persist them across sessions, and compare side-by-side to see what changed.

![Admin Updates](docs/screenshots/admin-updates.png)

### YAML Editor with Intelligence
Edit resources with syntax highlighting, live validation, diff view against the original, context-aware snippets for 12+ resource types, and OpenAPI schema documentation.

![YAML Editor](docs/screenshots/yaml-editor.png)

### Dependency Graph
Visualize relationships between deployments, replicasets, pods, services, secrets, and configmaps as an interactive SVG graph. Right-click any node to highlight its blast radius.

![Dependency Graph](docs/screenshots/dependency-graph.png)

### Prometheus Alerts
View firing alerts with direct links to affected resources, browse alerting rules with copyable PromQL, and manage Alertmanager silences.

![Alerts View](docs/screenshots/alerts.png)

### Timeline
Chronological event feed with time range filters and type filtering. Click any event to navigate to the involved resource.

![Timeline View](docs/screenshots/timeline.png)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript 5.9 |
| **Bundler** | Rspack 1.7 (Rust-based, ~1s builds) |
| **State** | Zustand (client) + TanStack Query (server) |
| **Styling** | Tailwind CSS 3.4 |
| **Icons** | Lucide React |
| **Editor** | CodeMirror 6 |
| **Routing** | React Router 7 |
| **Testing** | Vitest + jsdom (646 tests) |

## Getting Started

### Prerequisites
- Node.js 24.x or higher
- Access to an OpenShift cluster
- `oc` CLI installed

### Setup

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

Open [http://localhost:9000](http://localhost:9000) in your browser.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build |
| `npm test` | Run 646 tests |
| `npm run type-check` | TypeScript type checking |

## Architecture

```
src/kubeview/
├── engine/              # Core logic
│   ├── query.ts         # k8sList, k8sGet, k8sPatch, k8sDelete
│   ├── discovery.ts     # API discovery with Promise.allSettled
│   ├── gvr.ts           # GVR URL encoding/decoding
│   ├── watch.ts         # WebSocket watch manager
│   ├── actions.ts       # Resource action registry
│   ├── diagnosis.ts     # Auto-diagnosis rules
│   ├── schema.ts        # OpenAPI schema resolution
│   ├── renderers/       # Auto-column detection, status utils
│   └── enhancers/       # Kind-specific column enhancers
├── views/               # Page components
│   ├── PulseView.tsx    # Landing page — active issues + metrics
│   ├── TableView.tsx    # Universal resource table
│   ├── DetailView.tsx   # Resource detail + actions
│   ├── AdminView.tsx    # Config, updates, snapshots, quotas
│   ├── AlertsView.tsx   # Prometheus alerts + rules + silences
│   └── ...              # Troubleshoot, Timeline, Storage, etc.
├── components/          # Shared UI
│   ├── Shell.tsx        # Layout: CommandBar + TabBar + Dock
│   ├── ClusterConfig.tsx # OAuth, Proxy, Image, Ingress, Scheduler, API Server
│   ├── CommandPalette.tsx
│   ├── ResourceBrowser.tsx
│   └── yaml/            # YAML editor with autocomplete + schema
├── hooks/               # Shared hooks
│   ├── useNavigateTab.ts
│   └── useClusterHealthData.ts
├── store/               # State
│   ├── uiStore.ts       # Tabs, toasts, namespace, dock (persisted)
│   └── clusterStore.ts  # API discovery registry
└── App.tsx              # Routes
```

### Key Patterns

- **Single source of truth**: `K8sResource` type in `renderers/index.tsx`, `ResourceType` in `discovery.ts`
- **Tab deduplication**: All navigation via `useNavigateTab()` — clicking the same resource reuses the existing tab
- **Merge-patch for CRDs**: OpenShift `config.openshift.io` resources use `application/merge-patch+json`, not strategic-merge-patch
- **Error resilience**: All API error handlers have try-catch around JSON parse (handles HTML 502/503 from proxies)
- **Dark theme only**: `slate-*` palette, inline CSS in `index.html` prevents white flash

## Routes

| Route | View |
|-------|------|
| `/welcome` | Welcome / Getting started |
| `/pulse` | Cluster Pulse (landing page) |
| `/troubleshoot` | Troubleshoot with runbooks |
| `/alerts` | Prometheus alerts |
| `/timeline` | Event timeline |
| `/storage` | Storage overview |
| `/access-control` | RBAC overview |
| `/operators` | ClusterOperator health |
| `/admin` | Administration (config, updates, snapshots, quotas) |
| `/r/:gvr` | Resource list (any type) |
| `/r/:gvr/:ns/:name` | Resource detail |
| `/yaml/:gvr/:ns/:name` | YAML editor |
| `/logs/:ns/:name` | Pod logs |
| `/node-logs/:name` | Node logs (audit, journal, CRI-O) |
| `/metrics/:gvr/:ns/:name` | Prometheus metrics |
| `/deps/:gvr/:ns/:name` | Dependency graph |
| `/investigate/:gvr/:ns/:name` | Correlation analysis |
| `/create/:gvr` | Create from YAML template |

## Screenshots

> **Note**: To add screenshots, take them from the running app and save to `docs/screenshots/`. The README references these paths.

To capture screenshots:
1. Start the app with `npm run dev`
2. Navigate to each view
3. Use your browser's screenshot tool or `⌘⇧4` on macOS
4. Save as PNG to `docs/screenshots/` with the filenames referenced above

## Testing

```bash
# Run all 646 tests
npm test

# Run tests in watch mode
npx vitest

# Run specific test file
npx vitest run src/kubeview/engine/__tests__/actions.test.ts
```

Test coverage spans:
- Engine: query, actions, diagnosis, discovery, renderers, schema, enhancers
- Store: uiStore (tabs, toasts), clusterStore (discovery)
- Components: CommandPalette, ResourceBrowser, Toast, TabBar
- Hooks: useResourceUrl

## Contributing

1. All fixes must include tests
2. No mock data — all data from real K8s APIs
3. No stub toasts — every action makes a real API call
4. Use `slate-*` colors (dark theme only)
5. Use `useNavigateTab()` for navigation (never raw `navigate()`)
6. Use `application/merge-patch+json` for OpenShift CRD patches

## License

MIT
