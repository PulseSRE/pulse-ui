import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  AlertCircle,
  XCircle,
  CheckCircle,
  ArrowRight,
  Server,
  Box,
  Package,
  HardDrive,
  Activity,
  GitBranch,
  FileText,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { getPodStatus, getNodeStatus, getDeploymentStatus } from '../engine/renderers/statusUtils';
import { diagnoseResource, type Diagnosis } from '../engine/diagnosis';
import { useUIStore } from '../store/uiStore';

export default function TroubleshootView() {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');

  // Fetch all resources for diagnosis
  const { data: pods = [], isLoading: podsLoading } = useQuery<K8sResource[]>({
    queryKey: ['troubleshoot', 'pods'],
    queryFn: () => k8sList<K8sResource>('/api/v1/pods'),
    refetchInterval: 30000,
  });

  const { data: deployments = [] } = useQuery<K8sResource[]>({
    queryKey: ['troubleshoot', 'deployments'],
    queryFn: () => k8sList<K8sResource>('/apis/apps/v1/deployments'),
    refetchInterval: 30000,
  });

  const { data: nodes = [] } = useQuery<K8sResource[]>({
    queryKey: ['troubleshoot', 'nodes'],
    queryFn: () => k8sList<K8sResource>('/api/v1/nodes'),
    refetchInterval: 30000,
  });

  const { data: pvcs = [] } = useQuery<K8sResource[]>({
    queryKey: ['troubleshoot', 'pvcs'],
    queryFn: () => k8sList<K8sResource>('/api/v1/persistentvolumeclaims'),
    refetchInterval: 30000,
  });

  // Run diagnosis on all resources
  interface DiagnosedResource {
    resource: K8sResource;
    diagnoses: Diagnosis[];
    maxSeverity: 'critical' | 'warning' | 'info';
  }

  const diagnosedResources = useMemo<DiagnosedResource[]>(() => {
    const all = [...pods, ...deployments, ...nodes, ...pvcs];
    const results: DiagnosedResource[] = [];

    for (const resource of all) {
      const diagnoses = diagnoseResource(resource);
      if (diagnoses.length > 0) {
        const hasCritical = diagnoses.some((d) => d.severity === 'critical');
        const hasWarning = diagnoses.some((d) => d.severity === 'warning');
        results.push({
          resource,
          diagnoses,
          maxSeverity: hasCritical ? 'critical' : hasWarning ? 'warning' : 'info',
        });
      }
    }

    // Sort: critical first, then warning, then info
    results.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.maxSeverity] - order[b.maxSeverity];
    });

    return results;
  }, [pods, deployments, nodes, pvcs]);

  // Filter and search
  const filteredResources = useMemo(() => {
    let results = diagnosedResources;

    if (filter !== 'all') {
      results = results.filter((r) => r.maxSeverity === filter);
    }

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

  // Summary counts
  const criticalCount = diagnosedResources.filter((r) => r.maxSeverity === 'critical').length;
  const warningCount = diagnosedResources.filter((r) => r.maxSeverity === 'warning').length;

  // Healthy resource counts
  const healthyPods = pods.filter((p) => { const s = getPodStatus(p); return s.phase === 'Running' && s.ready; }).length;
  const healthyDeploys = deployments.filter((d) => getDeploymentStatus(d).available).length;
  const healthyNodes = nodes.filter((n) => getNodeStatus(n).ready).length;

  function getGvrUrl(resource: K8sResource) {
    const apiVersion = resource.apiVersion || 'v1';
    const kind = resource.kind || '';
    const [group, version] = apiVersion.includes('/') ? apiVersion.split('/') : ['', apiVersion];
    const plural = kind.toLowerCase() + 's';
    const gvr = group ? `${group}~${version}~${plural}` : `${version}~${plural}`;
    const ns = resource.metadata.namespace;
    return ns ? `/r/${gvr}/${ns}/${resource.metadata.name}` : `/r/${gvr}/_/${resource.metadata.name}`;
  }

  function goTo(path: string, title: string) {
    addTab({ title, path, pinned: false, closable: true });
    navigate(path);
  }

  const kindIcon: Record<string, React.ReactNode> = {
    Pod: <Box className="w-4 h-4" />,
    Deployment: <Package className="w-4 h-4" />,
    Node: <Server className="w-4 h-4" />,
    PersistentVolumeClaim: <HardDrive className="w-4 h-4" />,
  };

  const isLoading = podsLoading;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-6 h-6 text-orange-500" />
              Troubleshoot
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Auto-diagnose cluster issues with suggested fixes
            </p>
          </div>
          {diagnosedResources.length === 0 && !isLoading && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-800 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-green-300">All resources healthy</span>
            </div>
          )}
        </div>

        {/* Health Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <HealthCard label="Pods" healthy={healthyPods} total={pods.length} icon={<Box className="w-4 h-4" />} />
          <HealthCard label="Deployments" healthy={healthyDeploys} total={deployments.length} icon={<Package className="w-4 h-4" />} />
          <HealthCard label="Nodes" healthy={healthyNodes} total={nodes.length} icon={<Server className="w-4 h-4" />} />
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <AlertCircle className="w-4 h-4" />
              <span className="text-xs">Issues Found</span>
            </div>
            <div className="flex items-center gap-3">
              {criticalCount > 0 && (
                <span className="text-lg font-bold text-red-400">{criticalCount} critical</span>
              )}
              {warningCount > 0 && (
                <span className="text-lg font-bold text-yellow-400">{warningCount} warning</span>
              )}
              {criticalCount === 0 && warningCount === 0 && (
                <span className="text-lg font-bold text-green-400">None</span>
              )}
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, kind, namespace, or issue..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex bg-slate-900 rounded-lg border border-slate-700 text-xs">
            {(['all', 'critical', 'warning'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-2 capitalize transition-colors',
                  filter === f
                    ? f === 'critical' ? 'bg-red-600 text-white rounded-lg' :
                      f === 'warning' ? 'bg-yellow-600 text-white rounded-lg' :
                      'bg-blue-600 text-white rounded-lg'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {f} {f === 'critical' ? `(${criticalCount})` : f === 'warning' ? `(${warningCount})` : `(${diagnosedResources.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            <span className="ml-3 text-slate-400">Scanning resources...</span>
          </div>
        )}

        {/* Results */}
        {!isLoading && filteredResources.length === 0 && diagnosedResources.length > 0 && (
          <div className="text-center py-12 text-slate-500">
            No matching issues found. Try a different search or filter.
          </div>
        )}

        {!isLoading && (
          <div className="space-y-2">
            {filteredResources.map((item) => {
              const isExpanded = expandedResource === item.resource.metadata.uid;
              const detailPath = getGvrUrl(item.resource);

              return (
                <div
                  key={item.resource.metadata.uid}
                  className={cn(
                    'bg-slate-900 rounded-lg border transition-colors',
                    item.maxSeverity === 'critical' ? 'border-red-900/50' : 'border-slate-800'
                  )}
                >
                  {/* Row header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
                    onClick={() => setExpandedResource(isExpanded ? null : item.resource.metadata.uid || null)}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}

                    {item.maxSeverity === 'critical' ? (
                      <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                    )}

                    <div className="flex items-center gap-2 text-slate-400">
                      {kindIcon[item.resource.kind] || <Box className="w-4 h-4" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200 truncate">{item.resource.metadata.name}</span>
                        <span className="text-xs text-slate-500">{item.resource.kind}</span>
                        {item.resource.metadata.namespace && (
                          <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{item.resource.metadata.namespace}</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {item.diagnoses[0].title}
                        {item.diagnoses.length > 1 && ` (+${item.diagnoses.length - 1} more)`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded',
                        item.maxSeverity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300'
                      )}>
                        {item.diagnoses.length} issue{item.diagnoses.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 px-4 py-3 space-y-3">
                      {item.diagnoses.map((d, idx) => (
                        <div key={idx} className="flex items-start gap-3 py-2">
                          {d.severity === 'critical' ? (
                            <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                          ) : d.severity === 'warning' ? (
                            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-200">{d.title}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{d.detail}</div>
                            {d.suggestion && (
                              <div className="text-xs text-blue-400 mt-1">💡 {d.suggestion}</div>
                            )}
                            {d.fix && (
                              <button className="mt-2 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
                                {d.fix.label}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                        <button
                          onClick={() => goTo(detailPath, item.resource.metadata.name)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          View Details
                        </button>
                        {item.resource.metadata.namespace && (
                          <>
                            <button
                              onClick={() => {
                                const gvrUrl = getGvrUrl(item.resource).replace(/^\/r\//, '').split('/')[0];
                                const ns = item.resource.metadata.namespace;
                                const path = `/deps/${gvrUrl}/${ns}/${item.resource.metadata.name}`;
                                goTo(path, `${item.resource.metadata.name} (Deps)`);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 transition-colors"
                            >
                              <GitBranch className="w-3 h-3" />
                              Dependencies
                            </button>
                            {item.resource.kind === 'Pod' && (
                              <button
                                onClick={() => goTo(`/logs/${item.resource.metadata.namespace}/${item.resource.metadata.name}`, `${item.resource.metadata.name} (Logs)`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 transition-colors"
                              >
                                <FileText className="w-3 h-3" />
                                Logs
                              </button>
                            )}
                          </>
                        )}
                        <button
                          onClick={() => {
                            const gvrUrl = getGvrUrl(item.resource).replace(/^\/r\//, '').split('/')[0];
                            const ns = item.resource.metadata.namespace || '_';
                            const path = `/investigate/${gvrUrl}/${ns}/${item.resource.metadata.name}`;
                            goTo(path, `${item.resource.metadata.name} (Investigate)`);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
                        >
                          <Search className="w-3 h-3" />
                          Investigate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthCard({ label, healthy, total, icon }: {
  label: string; healthy: number; total: number; icon: React.ReactNode;
}) {
  const allHealthy = healthy === total && total > 0;
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
      <div className="flex items-center gap-2 text-slate-400 mb-1">
        {icon}
        <span className="text-xs">{label}</span>
        <div className={cn('w-1.5 h-1.5 rounded-full ml-auto', allHealthy ? 'bg-green-500' : 'bg-yellow-500')} />
      </div>
      <div className="text-lg font-bold text-slate-100">{healthy}/{total}</div>
    </div>
  );
}
