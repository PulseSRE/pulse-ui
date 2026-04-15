import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Network, Loader2, RefreshCw, AlertTriangle, Zap, Shield, Clock, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../components/primitives/Card';
import { EmptyState } from '../components/primitives/EmptyState';
import { useUIStore } from '../store/uiStore';
import GraphRenderer, {
  type TopoNode, type TopoEdge, getKindColor, layoutGraph,
} from '../components/topology/GraphRenderer';
import { agentFetch } from '../engine/safeQuery';

// ── Types ─────────────────────────────────────────────────────────────

interface TopologyData {
  nodes: TopoNode[];
  edges: TopoEdge[];
  summary: {
    nodes: number;
    edges: number;
    kinds: Record<string, number>;
    last_refresh: number;
  };
}

interface BlastRadiusNode {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  relationship: string;
}

// ── Data fetching ─────────────────────────────────────────────────────

async function fetchTopology(namespace?: string): Promise<TopologyData> {
  const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  const res = await agentFetch(`/api/agent/topology${params}`);
  if (!res.ok) throw new Error(`Topology fetch failed (${res.status})`);
  return res.json();
}

async function fetchBlastRadius(nodeId: string): Promise<BlastRadiusNode[]> {
  const res = await agentFetch(
    `/api/agent/topology/blast-radius?node_id=${encodeURIComponent(nodeId)}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.resources ?? [];
}

// ── Helpers ───────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-950/50 border-red-900/50',
  high: 'text-orange-400 bg-orange-950/50 border-orange-900/50',
  medium: 'text-yellow-400 bg-yellow-950/50 border-yellow-900/50',
  low: 'text-green-400 bg-green-950/50 border-green-900/50',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: 'text-green-400' },
  warning: { label: 'Warning', color: 'text-yellow-400' },
  error: { label: 'Error', color: 'text-red-400' },
};

// ── Component ─────────────────────────────────────────────────────────

export default function TopologyView() {
  const activeNs = useUIStore((s) => s.selectedNamespace);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(
    activeNs && activeNs !== '*' ? activeNs : 'openshiftpulse',
  );
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['topology', selectedNamespace],
    queryFn: () => fetchTopology(selectedNamespace || undefined),
    refetchInterval: 120_000,
  });

  const { data: allData } = useQuery({
    queryKey: ['topology', '__all_ns_list__'],
    queryFn: () => fetchTopology(),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  // Blast radius from API (richer than client-side BFS)
  const { data: blastRadiusData } = useQuery({
    queryKey: ['topology-blast-radius', selectedNode],
    queryFn: () => fetchBlastRadius(selectedNode!),
    enabled: !!selectedNode,
  });

  const topology = data ?? { nodes: [], edges: [], summary: { nodes: 0, edges: 0, kinds: {}, last_refresh: 0 } };

  const namespaces = useMemo(() => {
    const ns = new Set<string>();
    for (const n of (allData?.nodes ?? [])) {
      if (n.namespace) ns.add(n.namespace);
    }
    return [...ns].sort();
  }, [allData]);

  const layout = useMemo(() => layoutGraph(topology.nodes, topology.edges), [topology.nodes, topology.edges]);
  const nodeMap = useMemo(() => {
    const map = new Map<string, TopoNode>();
    for (const n of layout) map.set(n.id, n);
    return map;
  }, [layout]);

  // Stats
  const healthCounts = useMemo(() => {
    const counts = { healthy: 0, warning: 0, error: 0, recentlyChanged: 0, atRisk: 0 };
    for (const n of topology.nodes) {
      if (n.status === 'error') counts.error++;
      else if (n.status === 'warning') counts.warning++;
      else counts.healthy++;
      if (n.recentlyChanged) counts.recentlyChanged++;
      if (n.risk && n.risk > 0) counts.atRisk++;
    }
    return counts;
  }, [topology.nodes]);

  // Recently changed nodes for timeline
  const recentlyChanged = useMemo(
    () => topology.nodes.filter(n => n.recentlyChanged),
    [topology.nodes],
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-950/50 border border-red-900/50">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Failed to load topology data</h2>
          <p className="text-sm text-red-400 mb-4">{error instanceof Error ? error.message : 'Unknown error'}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 font-medium mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const selectedNodeData = selectedNode ? nodeMap.get(selectedNode) : null;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Network className="w-6 h-6 text-cyan-400" />
              Impact Analysis
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Resource dependencies, risk overlay, and blast radius
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedNamespace}
              onChange={(e) => { setSelectedNamespace(e.target.value); setSelectedNode(null); }}
              className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">All namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200 transition-colors"
              title="Refresh graph"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-3">
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">Resources</div>
            <div className="text-xl font-bold text-slate-100">{topology.nodes.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">Healthy</div>
            <div className="text-xl font-bold text-green-400">{healthCounts.healthy}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">Issues</div>
            <div className="text-xl font-bold text-red-400">
              {healthCounts.error + healthCounts.warning}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">At Risk</div>
            <div className="text-xl font-bold text-orange-400">{healthCounts.atRisk}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-500 mb-1">
              {selectedNode ? 'Blast Radius' : 'Click a node'}
            </div>
            <div className="text-xl font-bold text-slate-100">
              {blastRadiusData ? blastRadiusData.length : selectedNode ? '...' : '-'}
            </div>
          </Card>
        </div>

        {/* Legend */}
        {topology.nodes.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Kind colors */}
            {[...new Set(topology.nodes.map(n => n.kind))].sort().map((kind) => (
              <div key={kind} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getKindColor(kind) }} />
                {kind} ({topology.nodes.filter(n => n.kind === kind).length})
              </div>
            ))}
            {/* Status legend */}
            <span className="text-slate-700">|</span>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-green-500" /> Healthy
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-yellow-500" /> Warning
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Error
            </div>
          </div>
        )}

        {/* Graph + Detail side-by-side */}
        {topology.nodes.length === 0 ? (
          <EmptyState
            icon={<Network className="w-8 h-8 text-slate-500" />}
            title="No topology data"
            description="The dependency graph is built during scan cycles. It will populate as the monitor scans your cluster."
          />
        ) : (
          <div className={cn('flex gap-4', selectedNodeData ? '' : '')}>
            {/* Graph — shrinks when detail is open */}
            <div className={cn('min-w-0 transition-all', selectedNodeData ? 'flex-1' : 'w-full')}>
              <GraphRenderer
                nodes={topology.nodes}
                edges={topology.edges}
                hoveredNode={hoveredNode}
                setHoveredNode={setHoveredNode}
                selectedNode={selectedNode}
                setSelectedNode={setSelectedNode}
              />
            </div>

            {/* Detail column */}
            {selectedNodeData && (
              <Card className="w-72 shrink-0 p-4 overflow-y-auto self-start max-h-[600px]">
                {/* Close */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {selectedNodeData.kind}/{selectedNodeData.name}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {selectedNodeData.namespace && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                      {selectedNodeData.namespace}
                    </span>
                  )}
                  <span className={cn('text-[10px]', STATUS_LABELS[selectedNodeData.status ?? 'healthy'].color)}>
                    {STATUS_LABELS[selectedNodeData.status ?? 'healthy'].label}
                  </span>
                  {selectedNodeData.riskLevel && (
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded border',
                      RISK_COLORS[selectedNodeData.riskLevel],
                    )}>
                      Risk: {selectedNodeData.risk}
                    </span>
                  )}
                  {selectedNodeData.recentlyChanged && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-950/50 text-orange-400 rounded border border-orange-900/50 flex items-center gap-0.5">
                      <Zap className="w-2.5 h-2.5" /> Deployed
                    </span>
                  )}
                </div>

                {/* Blast radius count */}
                <div className="text-xs text-slate-500 mb-3 pb-3 border-b border-slate-800">
                  Blast radius: {blastRadiusData?.length ?? '...'} resource{(blastRadiusData?.length ?? 0) !== 1 ? 's' : ''}
                </div>

                {/* Upstream */}
                <div className="mb-3">
                  <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Upstream
                  </h4>
                  {(() => {
                    const upstream = topology.edges
                      .filter(e => e.target === selectedNode)
                      .map(e => ({ node: nodeMap.get(e.source), rel: e.relationship }))
                      .filter((x): x is { node: TopoNode; rel: string } => !!x.node);
                    if (upstream.length === 0) return <span className="text-xs text-slate-600">None</span>;
                    return (
                      <div className="space-y-1">
                        {upstream.map(({ node: n, rel }) => (
                          <div key={n.id} className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: getKindColor(n.kind) }} />
                            <span className="truncate">{n.kind}/{n.name}</span>
                            <span className="text-slate-600 text-[10px] shrink-0">({rel})</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Downstream */}
                <div>
                  <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Downstream
                  </h4>
                  {!blastRadiusData ? (
                    <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                  ) : blastRadiusData.length === 0 ? (
                    <span className="text-xs text-slate-600">None (leaf node)</span>
                  ) : (
                    <div className="space-y-1">
                      {blastRadiusData.map((dep) => (
                        <div key={dep.id} className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: getKindColor(dep.kind) }} />
                          <span className="truncate">{dep.kind}/{dep.name}</span>
                          {dep.relationship && (
                            <span className="text-slate-600 text-[10px] shrink-0">({dep.relationship})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Recent Changes Timeline */}
        {recentlyChanged.length > 0 && (
          <Card className="p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Recently Changed ({recentlyChanged.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {recentlyChanged.map((node) => (
                <button
                  key={node.id}
                  onClick={() => setSelectedNode(node.id)}
                  className={cn(
                    'text-xs font-mono px-2.5 py-1.5 rounded border transition-colors flex items-center gap-1.5',
                    selectedNode === node.id
                      ? 'bg-orange-950/50 border-orange-700 text-orange-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-orange-800 hover:text-orange-400',
                  )}
                >
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getKindColor(node.kind) }} />
                  {node.kind}/{node.name}
                  {node.riskLevel && node.riskLevel !== 'low' && (
                    <span className={cn('text-[10px] px-1 rounded', RISK_COLORS[node.riskLevel])}>
                      {node.riskLevel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
