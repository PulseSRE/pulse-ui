/**
 * FleetView — the Monday morning multi-cluster dashboard.
 * Shows all clusters as cards sorted by "needs attention" priority.
 * Only visible when multiple clusters are connected.
 */

import React from 'react';
import {
  Globe, RefreshCw, Loader2, Plus, Info, Server,
  CheckCircle, AlertTriangle, Layers, Bell, GitCompare, Box,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFleetStore } from '../store/fleetStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { Card } from '../components/primitives/Card';
import { EmptyState } from '../components/primitives/EmptyState';
import { FleetCard } from './fleet/FleetCard';
import type { HealthScoreInput } from '../engine/healthScore';
import { computeHealthScore } from '../engine/healthScore';

export default function FleetView() {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const {
    fleetMode, clusters, activeClusterId,
    acmAvailable, acmDetecting,
    setActiveCluster, refreshAllHealth, detectACM,
  } = useFleetStore();

  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAllHealth();
    setRefreshing(false);
  };

  // Sort clusters: needs-attention first, then by name
  const sortedClusters = React.useMemo(() => {
    return [...clusters].sort((a, b) => {
      // Unreachable clusters first
      if (a.status !== 'connected' && b.status === 'connected') return -1;
      if (a.status === 'connected' && b.status !== 'connected') return 1;
      // Then by name
      return a.name.localeCompare(b.name);
    });
  }, [clusters]);

  const connectedCount = clusters.filter(c => c.status === 'connected').length;
  const unreachableCount = clusters.filter(c => c.status !== 'connected' && c.id !== 'local').length;

  // Single cluster — show guidance
  if (fleetMode === 'single') {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Globe className="w-6 h-6 text-blue-500" /> Fleet
            </h1>
            <p className="text-sm text-slate-400 mt-1">Multi-cluster management</p>
          </div>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-4">Connect Your Clusters</h2>
            <p className="text-sm text-slate-400 mb-6">
              The Fleet view shows all your clusters in one place — health scores, alerts, drift detection, and version tracking. Connect clusters to get started.
            </p>

            <div className="space-y-4">
              <StepCard
                number={1}
                title="ACM / Multicluster Engine (Recommended)"
                description="If this cluster has Advanced Cluster Management installed, Pulse auto-discovers all managed clusters. No configuration needed."
                action={acmDetecting ? 'Detecting...' : acmAvailable ? 'ACM Detected' : 'Detect ACM'}
                onClick={!acmDetecting ? () => detectACM() : undefined}
                done={acmAvailable}
              />
              {!acmAvailable && !acmDetecting && (
                <div className="ml-11 rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-xs text-slate-400 space-y-3">
                  <p className="text-slate-300 font-medium">ACM not detected. To install:</p>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      Install the <span className="text-blue-400">Advanced Cluster Management</span> operator from OperatorHub:
                      <pre className="mt-1 bg-slate-900 rounded px-2 py-1 text-slate-300 overflow-x-auto">oc create ns open-cluster-management{'\n'}# Then install from OperatorHub in the OpenShift Console{'\n'}# Or via CLI:{'\n'}cat {'<<'}EOF | oc apply -f -{'\n'}apiVersion: operators.coreos.com/v1alpha1{'\n'}kind: Subscription{'\n'}metadata:{'\n'}  name: advanced-cluster-management{'\n'}  namespace: open-cluster-management{'\n'}spec:{'\n'}  channel: release-2.12{'\n'}  name: advanced-cluster-management{'\n'}  source: redhat-operators{'\n'}  sourceNamespace: openshift-marketplace{'\n'}EOF</pre>
                    </li>
                    <li>
                      Create a <span className="text-blue-400">MultiClusterHub</span> resource:
                      <pre className="mt-1 bg-slate-900 rounded px-2 py-1 text-slate-300 overflow-x-auto">cat {'<<'}EOF | oc apply -f -{'\n'}apiVersion: operator.open-cluster-management.io/v1{'\n'}kind: MultiClusterHub{'\n'}metadata:{'\n'}  name: multiclusterhub{'\n'}  namespace: open-cluster-management{'\n'}spec: {'{}'}{'\n'}EOF</pre>
                    </li>
                    <li>Wait for the operator to become ready (~5 min), then import clusters via the ACM console or <code className="text-blue-400">clusteradm</code> CLI.</li>
                    <li>Click <span className="text-blue-400">Detect ACM</span> above once your clusters are imported.</li>
                  </ol>
                  <p className="text-slate-500">
                    Alternatively, use <span className="text-blue-400">Multicluster Engine (MCE)</span> if you only need cluster lifecycle management without governance.
                  </p>
                </div>
              )}
              <StepCard
                number={2}
                title="Manual Proxy Connection"
                description="Run 'oc proxy --port=8002' for each additional cluster and register them here. Good for development and testing."
              />
            </div>
          </Card>

          {/* Current cluster info */}
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300">Connected to local cluster</span>
              {clusters[0]?.metadata?.version && (
                <span className="text-xs text-slate-500 font-mono ml-auto">{clusters[0].metadata.version}</span>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Multi-cluster fleet dashboard
  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Globe className="w-6 h-6 text-blue-500" /> Fleet
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {connectedCount} cluster{connectedCount !== 1 ? 's' : ''} connected
              {unreachableCount > 0 && <span className="text-red-400 ml-1">· {unreachableCount} unreachable</span>}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs text-slate-400 rounded hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh All
          </button>
        </div>

        {/* Fleet summary bar */}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            {clusters.reduce((sum, c) => sum + (c.metadata?.nodeCount || 0), 0)} total nodes
          </span>
          <span>·</span>
          <span>{clusters.filter(c => c.status === 'connected').length}/{clusters.length} healthy</span>
          {acmAvailable && (
            <>
              <span>·</span>
              <span className="text-violet-400">ACM managed</span>
            </>
          )}
        </div>

        {/* Fleet navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => go('/fleet/r/apps~v1~deployments', 'Fleet Resources')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3 h-3" /> Resources
            </span>
          </button>
          <button
            onClick={() => go('/fleet/workloads', 'Fleet Workloads')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <Box className="w-3 h-3" /> Workloads
            </span>
          </button>
          <button
            onClick={() => go('/fleet/alerts', 'Fleet Alerts')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <Bell className="w-3 h-3" /> Alerts
            </span>
          </button>
          <button
            onClick={() => go('/fleet/compare', 'Fleet Compare')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <GitCompare className="w-3 h-3" /> Compare
            </span>
          </button>
          <button
            onClick={() => go('/fleet/compliance', 'Fleet Compliance')}
            className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">Compliance</span>
          </button>
        </div>

        {/* Cluster cards grid */}
        {sortedClusters.length === 0 ? (
          <EmptyState
            icon={<Globe className="w-8 h-8" />}
            title="No clusters connected"
            description="Fleet mode requires Red Hat Advanced Cluster Management (ACM) or a multi-cluster hub. Connect additional clusters to compare health, drift, and compliance across your fleet."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedClusters.map((cluster) => (
              <FleetCard
                key={cluster.id}
                cluster={cluster}
                onClick={() => {
                  setActiveCluster(cluster.id);
                  go('/pulse', `${cluster.name} — Pulse`);
                }}
              />
            ))}
          </div>
        )}

        {/* Active cluster indicator */}
        <div className="text-center text-xs text-slate-600">
          Active: <span className="text-slate-400">{clusters.find(c => c.id === activeClusterId)?.name || 'Local'}</span>
          <span className="text-slate-700 ml-2">⌘⇧C to switch</span>
        </div>
      </div>
    </div>
  );
}

function StepCard({ number, title, description, action, onClick, done }: {
  number: number; title: string; description: string; action?: string; onClick?: () => void; done?: boolean;
}) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-slate-800 bg-slate-800/30">
      <div className={cn('w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center shrink-0',
        done ? 'bg-emerald-600' : 'bg-blue-600'
      )}>
        {done ? <CheckCircle className="w-4 h-4" /> : number}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <p className="text-xs text-slate-400 mt-1">{description}</p>
        {action && onClick && !done && (
          <button onClick={onClick} className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            {action}
          </button>
        )}
        {done && <span className="text-xs text-emerald-400 mt-1 block">Detected</span>}
      </div>
    </div>
  );
}
