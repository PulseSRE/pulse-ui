# Topology Component

## Goal

Add a new `topology` component kind that the agent can return inline in chat and place on dashboards. Renders an interactive resource graph (drag, zoom/pan, click-to-inspect) showing K8s resource relationships — workloads, networking, policies, quotas.

## Architecture

Three pieces:

### 1. GraphRenderer (extracted from TopologyView)

Reusable SVG + d3-force graph component. Handles all rendering and interaction.

**File:** `src/kubeview/components/topology/GraphRenderer.tsx`

**Extracted from:** `src/kubeview/views/TopologyView.tsx` — the BFS layout, SVG rendering, node circles, edge lines, drag handlers, zoom/pan, and tooltip logic move here.

**Props:**
```typescript
interface GraphRendererProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  height?: number;                    // default 400
  onNodeClick?: (node: TopologyNode) => void;
}

interface TopologyNode {
  id: string;
  kind: string;        // Pod, Deployment, Service, NetworkPolicy, ResourceQuota, etc.
  name: string;
  namespace?: string;
  status?: string;     // healthy, warning, error, unknown
}

interface TopologyEdge {
  source: string;      // node id
  target: string;      // node id
  label?: string;      // "owns", "selects", "mounts", "allows", "limits"
  type?: string;       // for edge color/style
}
```

**What GraphRenderer owns:**
- SVG container with viewBox
- d3-force simulation (charge, link, center forces)
- Node circles colored by kind (Pod=blue, Deployment=violet, Service=emerald, NetworkPolicy=amber, etc.)
- Status ring on nodes (green=healthy, amber=warning, red=error)
- Edge lines with optional labels
- Drag handler on nodes (d3-drag)
- Zoom/pan on SVG (d3-zoom)
- Click-to-inspect tooltip showing node details
- Responsive width via ResizeObserver or container query

**What TopologyView keeps:**
- Namespace filter dropdown
- Blast radius overlay controls
- API fetching (`GET /topology`)
- Page-level layout and header
- Imports and renders `GraphRenderer`

### 2. AgentComponentRenderer integration

**File:** `src/kubeview/components/agent/AgentComponentRenderer.tsx`

Add a new case for `kind: "topology"`:
```typescript
case 'topology':
  return <GraphRenderer
    nodes={spec.nodes}
    edges={spec.edges}
    height={spec.height || 400}
  />;
```

### 3. Component spec type

**File:** `src/kubeview/engine/agentComponents.ts`

Add `TopologySpec` to the `ComponentSpec` union type:
```typescript
interface TopologySpec {
  kind: 'topology';
  title?: string;
  description?: string;
  nodes: Array<{
    id: string;
    kind: string;
    name: string;
    namespace?: string;
    status?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label?: string;
    type?: string;
  }>;
  height?: number;
}
```

### 4. Backend tool update

**File:** `sre_agent/k8s_tools/diagnostics.py` (or wherever `get_resource_relationships` lives)

Update `get_resource_relationships` to return `kind: "topology"` component spec instead of `kind: "relationship_tree"`. The tool already returns nodes and edges — just change the component kind and restructure the data slightly.

Also register `topology` in the component registry so the layout engine knows its default size.

**File:** `sre_agent/layout_engine.py`

Add to `_KIND_MAP`:
```python
"topology": ("chart", 4, 14),  # full width, tall
```

## Data Flow

```
User: "show me the network topology for production namespace"
  → Agent calls get_resource_relationships(namespace="production")
  → Tool queries K8s API for resources + relationships
  → Returns (text_summary, {kind: "topology", nodes: [...], edges: [...]})
  → Component event emitted to UI
  → AgentComponentRenderer renders GraphRenderer
  → d3-force positions nodes
  → User drags, zooms, clicks nodes
```

## Node Kind Color Map

| Kind | Color | Icon |
|------|-------|------|
| Pod | blue-400 | circle |
| Deployment | violet-400 | circle |
| Service | emerald-400 | circle |
| NetworkPolicy | amber-400 | diamond |
| ConfigMap | slate-400 | circle |
| Secret | red-400 | circle |
| PVC | cyan-400 | circle |
| Node | orange-400 | square |
| ResourceQuota | pink-400 | circle |
| LimitRange | pink-300 | circle |

## What NOT to Build

- No new backend endpoints — reuse `get_resource_relationships` and `GET /topology`
- No new d3 dependency — already installed
- No clustering/grouping — flat node graph
- No real-time traffic data — would need eBPF/service mesh
- No layout persistence — force simulation runs fresh each render
- No edge animation — static lines with optional labels

## Testing

- Unit test: GraphRenderer renders correct number of SVG circles/lines from nodes/edges props
- Unit test: AgentComponentRenderer handles `kind: "topology"` 
- Unit test: TopologyView still works after extraction (renders GraphRenderer)
- Integration: agent returns topology component, renders on dashboard
