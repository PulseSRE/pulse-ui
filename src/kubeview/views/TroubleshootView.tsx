import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, AlertCircle, XCircle, CheckCircle, ArrowRight, Server, Box,
  Package, HardDrive, Activity, GitBranch, FileText, ChevronDown,
  ChevronRight, Loader2, Zap, Clock, ShieldAlert, Heart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus, getNodeStatus, getDeploymentStatus } from '../engine/renderers/statusUtils';
import { kindToPlural } from '../engine/renderers/index';
import { diagnoseResource, type Diagnosis } from '../engine/diagnosis';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { resourceDetailUrl } from '../engine/gvr';

type Tab = 'issues' | 'health' | 'runbooks';

interface DiagnosedResource {
  resource: K8sResource;
  diagnoses: Diagnosis[];
  maxSeverity: 'critical' | 'warning' | 'info';
}

function filterByNs<T extends { metadata: { namespace?: string } }>(items: T[], ns: string): T[] {
  if (ns === '*') return items;
  return items.filter((i) => i.metadata.namespace === ns);
}

export default function TroubleshootView() {
  const addTab = useUIStore((s) => s.addTab);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [activeTab, setActiveTab] = useState<Tab>('issues');

  const { data: allPods = [], isLoading: podsLoading } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/pods'],
    queryFn: () => k8sList<K8sResource>('/api/v1/pods'),
    refetchInterval: 30000,
  });

  const { data: allDeployments = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/apis/apps/v1/deployments'],
    queryFn: () => k8sList<K8sResource>('/apis/apps/v1/deployments'),
    refetchInterval: 30000,
  });

  const { data: nodes = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/nodes'],
    queryFn: () => k8sList<K8sResource>('/api/v1/nodes'),
    refetchInterval: 30000,
  });

  const { data: allPvcs = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/persistentvolumeclaims'],
    queryFn: () => k8sList<K8sResource>('/api/v1/persistentvolumeclaims'),
    refetchInterval: 30000,
  });

  const { data: allEvents = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/events'],
    queryFn: () => k8sList<K8sResource>('/api/v1/events?limit=100'),
    refetchInterval: 30000,
  });

  // Apply namespace filter
  const pods = useMemo(() => filterByNs(allPods as any[], selectedNamespace), [allPods, selectedNamespace]);
  const deployments = useMemo(() => filterByNs(allDeployments as any[], selectedNamespace), [allDeployments, selectedNamespace]);
  const pvcs = useMemo(() => filterByNs(allPvcs as any[], selectedNamespace), [allPvcs, selectedNamespace]);
  const events = useMemo(() => filterByNs(allEvents as any[], selectedNamespace), [allEvents, selectedNamespace]);

  // Diagnosis (nodes are cluster-scoped, always included)
  const diagnosedResources = useMemo<DiagnosedResource[]>(() => {
    const all = [...pods, ...deployments, ...nodes, ...pvcs];
    const results: DiagnosedResource[] = [];
    for (const resource of all) {
      const diagnoses = diagnoseResource(resource);
      if (diagnoses.length > 0) {
        const hasCritical = diagnoses.some((d) => d.severity === 'critical');
        const hasWarning = diagnoses.some((d) => d.severity === 'warning');
        results.push({ resource, diagnoses, maxSeverity: hasCritical ? 'critical' : hasWarning ? 'warning' : 'info' });
      }
    }
    return results.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.maxSeverity] - { critical: 0, warning: 1, info: 2 }[b.maxSeverity]));
  }, [pods, deployments, nodes, pvcs]);

  const filteredResources = useMemo(() => {
    let results = diagnosedResources;
    if (filter !== 'all') results = results.filter((r) => r.maxSeverity === filter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      results = results.filter((r) =>
        r.resource.metadata.name.toLowerCase().includes(q) ||
        r.resource.kind.toLowerCase().includes(q) ||
        r.resource.metadata.namespace?.toLowerCase().includes(q) ||
        r.diagnoses.some((d) => d.title.toLowerCase().includes(q))
      );
    }
    return results;
  }, [diagnosedResources, filter, searchQuery]);

  // Health by namespace
  const namespaceHealth = useMemo(() => {
    const map = new Map<string, { total: number; healthy: number; critical: number; warning: number }>();
    for (const pod of pods) {
      const ns = pod.metadata.namespace || 'default';
      const name = pod.metadata.name;
      const owners = pod.metadata.ownerReferences || [];

      // Skip completed installer/job pods
      const isInstaller = name.startsWith('installer-') || name.startsWith('revision-pruner-');
      const ownedByJob = owners.some((o) => o.kind === 'Job');
      const status = getPodStatus(pod);
      if ((isInstaller || ownedByJob) && (status.phase === 'Failed' || status.phase === 'Succeeded')) continue;

      const entry = map.get(ns) || { total: 0, healthy: 0, critical: 0, warning: 0 };
      entry.total++;
      if (status.phase === 'Running' && status.ready) entry.healthy++;
      else if (status.phase === 'Succeeded') entry.healthy++;
      else if (status.reason === 'CrashLoopBackOff' || status.reason === 'ImagePullBackOff' || status.phase === 'Failed') entry.critical++;
      else if (status.phase === 'Pending') entry.warning++;
      else entry.healthy++;
      map.set(ns, entry);
    }
    return [...map.entries()]
      .map(([ns, h]) => ({ ns, ...h, score: h.total > 0 ? Math.round((h.healthy / h.total) * 100) : 100 }))
      .sort((a, b) => a.score - b.score);
  }, [pods]);

  // Recent warning events
  const recentWarnings = useMemo(() => {
    return events
      .filter((e) => (e as any).type === 'Warning')
      .sort((a, b) => {
        const at = (a as any).lastTimestamp || (a as any).firstTimestamp || '';
        const bt = (b as any).lastTimestamp || (b as any).firstTimestamp || '';
        return new Date(bt).getTime() - new Date(at).getTime();
      })
      .slice(0, 10);
  }, [events]);

  const criticalCount = diagnosedResources.filter((r) => r.maxSeverity === 'critical').length;
  const warningCount = diagnosedResources.filter((r) => r.maxSeverity === 'warning').length;
  const healthyPods = pods.filter((p) => { const s = getPodStatus(p); return s.phase === 'Running' && s.ready; }).length;
  const healthyDeploys = deployments.filter((d) => getDeploymentStatus(d).available).length;
  const healthyNodes = nodes.filter((n) => getNodeStatus(n).ready).length;
  const isLoading = podsLoading;

  const go = useNavigateTab(); // replaces local go()

  // Use shared resourceDetailUrl from engine/gvr

  const kindIcon: Record<string, React.ReactNode> = {
    Pod: <Box className="w-4 h-4" />, Deployment: <Package className="w-4 h-4" />,
    Node: <Server className="w-4 h-4" />, PersistentVolumeClaim: <HardDrive className="w-4 h-4" />,
  };

  // Runbooks
  const runbooks = [
    { id: 'crashloop', title: 'Pod CrashLoopBackOff', icon: '🔄', severity: 'critical' as const,
      count: pods.filter((p) => getPodStatus(p).reason === 'CrashLoopBackOff').length,
      steps: ['Check pod logs for error messages', 'Verify image exists and is pullable', 'Check resource limits (OOM kills)', 'Review liveness probe configuration', 'Check for missing ConfigMaps/Secrets'] },
    { id: 'imagepull', title: 'Image Pull Failures', icon: '📦', severity: 'critical' as const,
      count: pods.filter((p) => getPodStatus(p).reason === 'ImagePullBackOff' || getPodStatus(p).reason === 'ErrImagePull').length,
      steps: ['Verify image name and tag are correct', 'Check registry credentials (imagePullSecrets)', 'Verify network connectivity to registry', 'Check if image exists in the registry'] },
    { id: 'pending', title: 'Pods Stuck Pending', icon: '⏳', severity: 'warning' as const,
      count: pods.filter((p) => getPodStatus(p).phase === 'Pending').length,
      steps: ['Check node resources (CPU/memory available)', 'Review node taints and pod tolerations', 'Check nodeSelector and affinity rules', 'Verify PVC is bound if volumes are used', 'Check resource quotas in the namespace'] },
    { id: 'deploy', title: 'Deployment Unavailable', icon: '🚫', severity: 'warning' as const,
      count: deployments.filter((d) => !getDeploymentStatus(d).available).length,
      steps: ['Check pod status in the deployment', 'Review deployment events', 'Verify image and pull policy', 'Check for resource quota limits', 'Review rollout history for recent changes'] },
    { id: 'node', title: 'Node Not Ready', icon: '🖥️', severity: 'critical' as const,
      count: nodes.filter((n) => !getNodeStatus(n).ready).length,
      steps: ['Check kubelet status on the node', 'Review node conditions (DiskPressure, MemoryPressure)', 'Check network connectivity to control plane', 'Review system logs (journalctl -u kubelet)', 'Check for certificate expiration'] },
    { id: 'pvc', title: 'PVC Stuck Pending', icon: '💾', severity: 'warning' as const,
      count: pvcs.filter((p) => (p.status as any)?.phase === 'Pending').length,
      steps: ['Check if StorageClass exists and is valid', 'Verify storage provisioner is running', 'Check if PVs are available (for static provisioning)', 'Review storage class parameters', 'Check cloud provider quotas'] },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-6 h-6 text-orange-500" />
              Troubleshoot
            </h1>
            <p className="text-sm text-slate-400 mt-1">Diagnose issues, follow runbooks, and check namespace health</p>
          </div>
          {criticalCount + warningCount === 0 && !isLoading ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-800 rounded-lg">
              <Heart className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-green-300">Cluster is healthy</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span className="text-sm font-medium text-red-300">{criticalCount + warningCount} issue{criticalCount + warningCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Pods" healthy={healthyPods} total={pods.length} icon={<Box className="w-4 h-4" />} onClick={() => go('/r/v1~pods', 'Pods')} />
          <StatCard label="Deployments" healthy={healthyDeploys} total={deployments.length} icon={<Package className="w-4 h-4" />} onClick={() => go('/r/apps~v1~deployments', 'Deployments')} />
          <StatCard label="Nodes" healthy={healthyNodes} total={nodes.length} icon={<Server className="w-4 h-4" />} onClick={() => go('/r/v1~nodes', 'Nodes')} />
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-3 cursor-pointer hover:border-slate-600 transition-colors" onClick={() => go('/timeline', 'Timeline')}>
            <div className="flex items-center gap-2 text-slate-400 mb-1"><Clock className="w-4 h-4" /><span className="text-xs">Warnings</span></div>
            <div className="text-xl font-bold text-slate-100">{recentWarnings.length}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
          {([
            { id: 'issues' as Tab, label: `Issues (${diagnosedResources.length})`, icon: <AlertCircle className="w-3.5 h-3.5" /> },
            { id: 'runbooks' as Tab, label: 'Runbooks', icon: <FileText className="w-3.5 h-3.5" /> },
            { id: 'health' as Tab, label: 'Namespace Health', icon: <Activity className="w-3.5 h-3.5" /> },
          ]).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors', activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Issues tab */}
        {activeTab === 'issues' && (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name, kind, namespace, or issue..." className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex bg-slate-900 rounded-lg border border-slate-700 text-xs">
                {(['all', 'critical', 'warning'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn('px-3 py-2 capitalize transition-colors', filter === f ? (f === 'critical' ? 'bg-red-600 text-white rounded-lg' : f === 'warning' ? 'bg-yellow-600 text-white rounded-lg' : 'bg-blue-600 text-white rounded-lg') : 'text-slate-400 hover:text-slate-200')}>
                    {f} ({f === 'critical' ? criticalCount : f === 'warning' ? warningCount : diagnosedResources.length})
                  </button>
                ))}
              </div>
            </div>

            {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /><span className="ml-3 text-slate-400">Scanning resources...</span></div>}

            {!isLoading && filteredResources.length === 0 && (
              <div className="text-center py-12">
                <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
                <p className="text-slate-300 font-medium">{diagnosedResources.length === 0 ? 'No issues detected' : 'No matching issues'}</p>
                <p className="text-xs text-slate-500 mt-1">All scanned resources are healthy</p>
              </div>
            )}

            <div className="space-y-2">
              {filteredResources.map((item) => {
                const isExpanded = expandedResource === item.resource.metadata.uid;
                return (
                  <div key={item.resource.metadata.uid} className={cn('bg-slate-900 rounded-lg border transition-colors', item.maxSeverity === 'critical' ? 'border-red-900/50' : 'border-slate-800')}>
                    <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/50 transition-colors" onClick={() => setExpandedResource(isExpanded ? null : item.resource.metadata.uid || null)}>
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      {item.maxSeverity === 'critical' ? <XCircle className="w-5 h-5 text-red-500" /> : <AlertCircle className="w-5 h-5 text-yellow-500" />}
                      <div className="flex items-center gap-2 text-slate-400">{kindIcon[item.resource.kind] || <Box className="w-4 h-4" />}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200 truncate">{item.resource.metadata.name}</span>
                          <span className="text-xs text-slate-500">{item.resource.kind}</span>
                          {item.resource.metadata.namespace && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{item.resource.metadata.namespace}</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">{item.diagnoses[0].title}{item.diagnoses.length > 1 && ` (+${item.diagnoses.length - 1} more)`}</div>
                      </div>
                      <span className={cn('text-xs px-2 py-0.5 rounded', item.maxSeverity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>
                        {item.diagnoses.length} issue{item.diagnoses.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-slate-800 px-4 py-3 space-y-3">
                        {item.diagnoses.map((d, idx) => (
                          <div key={idx} className="flex items-start gap-3 py-2">
                            {d.severity === 'critical' ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />}
                            <div className="flex-1">
                              <div className="text-sm font-medium text-slate-200">{d.title}</div>
                              <div className="text-xs text-slate-400 mt-0.5">{d.detail}</div>
                              {d.suggestion && <div className="text-xs text-blue-400 mt-1">💡 {d.suggestion}</div>}
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                          <button onClick={() => go(resourceDetailUrl(item.resource), item.resource.metadata.name)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700">
                            <FileText className="w-3 h-3" /> Details
                          </button>
                          {item.resource.metadata.namespace && (
                            <button onClick={() => { const gvrUrl = resourceDetailUrl(item.resource).replace(/^\/r\//, '').split('/')[0]; go(`/deps/${gvrUrl}/${item.resource.metadata.namespace}/${item.resource.metadata.name}`, `${item.resource.metadata.name} (Deps)`); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700">
                              <GitBranch className="w-3 h-3" /> Dependencies
                            </button>
                          )}
                          {item.resource.kind === 'Pod' && item.resource.metadata.namespace && (
                            <button onClick={() => go(`/logs/${item.resource.metadata.namespace}/${item.resource.metadata.name}`, `${item.resource.metadata.name} (Logs)`)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500">
                              <FileText className="w-3 h-3" /> View Logs
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Runbooks tab — interactive with affected resources */}
        {activeTab === 'runbooks' && (
          <div className="space-y-4">
            {runbooks.map((rb) => {
              const affected = rb.id === 'crashloop' ? pods.filter((p) => getPodStatus(p).reason === 'CrashLoopBackOff') :
                rb.id === 'imagepull' ? pods.filter((p) => getPodStatus(p).reason === 'ImagePullBackOff' || getPodStatus(p).reason === 'ErrImagePull') :
                rb.id === 'pending' ? pods.filter((p) => getPodStatus(p).phase === 'Pending') :
                rb.id === 'deploy' ? deployments.filter((d) => !getDeploymentStatus(d).available) :
                rb.id === 'node' ? nodes.filter((n) => !getNodeStatus(n).ready) :
                rb.id === 'pvc' ? pvcs.filter((p) => (p.status as any)?.phase === 'Pending') : [];

              return (
                <div key={rb.id} className={cn('bg-slate-900 rounded-lg border', rb.count > 0 ? (rb.severity === 'critical' ? 'border-red-900/50' : 'border-yellow-900/50') : 'border-slate-800')}>
                  <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <span>{rb.icon}</span>
                      {rb.title}
                    </h3>
                    {rb.count > 0 ? (
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', rb.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>{rb.count} affected</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-300 rounded">✓ None</span>
                    )}
                  </div>

                  {/* Affected resources */}
                  {affected.length > 0 && (
                    <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/50">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Affected Resources</div>
                      <div className="space-y-1">
                        {affected.slice(0, 3).map((r) => (
                          <div key={r.metadata.uid} onClick={() => go(resourceDetailUrl(r), r.metadata.name)} className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/50 cursor-pointer text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                              <span className="text-slate-200">{r.metadata.name}</span>
                              {r.metadata.namespace && <span className="text-slate-500">{r.metadata.namespace}</span>}
                            </div>
                            <ArrowRight className="w-3 h-3 text-slate-600" />
                          </div>
                        ))}
                        {affected.length > 3 && <div className="text-[10px] text-slate-500 px-2">+{affected.length - 3} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Steps */}
                  <div className="p-4">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Investigation Steps</div>
                    <ol className="space-y-2">
                      {rb.steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs">
                          <span className={cn('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5', rb.count === 0 ? 'bg-green-900/50 text-green-400' : 'bg-slate-800 text-slate-400')}>{rb.count === 0 ? '✓' : i + 1}</span>
                          <span className={cn('leading-relaxed', rb.count === 0 ? 'text-slate-500 line-through' : 'text-slate-300')}>{step}</span>
                        </li>
                      ))}
                    </ol>
                    {rb.count > 0 && affected.length > 0 && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                        <button onClick={() => go(resourceDetailUrl(affected[0]), affected[0].metadata.name)} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
                          Investigate first resource →
                        </button>
                        {affected[0].kind === 'Pod' && affected[0].metadata.namespace && (
                          <button onClick={() => go(`/logs/${affected[0].metadata.namespace}/${affected[0].metadata.name}`, `${affected[0].metadata.name} (Logs)`)} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors">
                            View Logs
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Namespace Health tab */}
        {activeTab === 'health' && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100">Pod Health by Namespace</h2>
            </div>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {namespaceHealth.map(({ ns, total, healthy, critical, warning, score }) => (
                <div
                  key={ns}
                  onClick={() => { useUIStore.getState().setSelectedNamespace(ns); go('/r/v1~pods', 'Pods'); }}
                  className="flex items-center gap-4 px-4 py-2.5 hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <div className="w-48 min-w-0">
                    <span className="text-sm text-blue-400 hover:text-blue-300 truncate block">{ns}</span>
                  </div>
                  <div className="flex-1">
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                      {healthy > 0 && <div className="h-full bg-green-500" style={{ width: `${(healthy / total) * 100}%` }} />}
                      {warning > 0 && <div className="h-full bg-yellow-500" style={{ width: `${(warning / total) * 100}%` }} />}
                      {critical > 0 && <div className="h-full bg-red-500" style={{ width: `${(critical / total) * 100}%` }} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 w-40 justify-end">
                    <span className="text-green-400">{healthy}</span>
                    {warning > 0 && <span className="text-yellow-400">{warning} pending</span>}
                    {critical > 0 && <span className="text-red-400">{critical} failed</span>}
                    <span className={cn('font-mono font-semibold', score === 100 ? 'text-green-400' : score > 80 ? 'text-yellow-400' : 'text-red-400')}>{score}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, healthy, total, icon, onClick }: { label: string; healthy: number; total: number; icon: React.ReactNode; onClick: () => void }) {
  const allHealthy = healthy === total && total > 0;
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3 cursor-pointer hover:border-slate-600 transition-colors', allHealthy ? 'border-slate-800' : 'border-yellow-800')}>
      <div className="flex items-center gap-2 text-slate-400 mb-1">{icon}<span className="text-xs">{label}</span><div className={cn('w-1.5 h-1.5 rounded-full ml-auto', allHealthy ? 'bg-green-500' : 'bg-yellow-500')} /></div>
      <div className="text-xl font-bold text-slate-100">{healthy}/{total}</div>
    </div>
  );
}
