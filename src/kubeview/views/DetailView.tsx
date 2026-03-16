import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  XCircle,
  Info,
  CheckCircle,
  FileText,
  Activity,
  Trash2,
  Terminal,
  FileCode,
  ArrowLeft,
  RotateCw,
  Plus,
  Minus,
  GitBranch,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sGet, k8sList, k8sDelete, k8sPatch } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { diagnoseResource, type Diagnosis } from '../engine/diagnosis';
import { buildApiPath } from '../hooks/useResourceUrl';
import { useUIStore } from '../store/uiStore';

interface DetailViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

export default function DetailView({ gvrKey, namespace, name }: DetailViewProps) {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);
  const addToast = useUIStore((s) => s.addToast);

  // Build GVR URL segment for navigation
  const gvrUrl = gvrKey.replace(/\//g, '~');

  // Build API path for this specific resource
  const apiPath = React.useMemo(
    () => buildApiPath(gvrKey, namespace, name),
    [gvrKey, namespace, name]
  );

  // Fetch the resource
  const { data: resource, isLoading, error } = useQuery<K8sResource>({
    queryKey: ['detail', apiPath],
    queryFn: () => k8sGet<K8sResource>(apiPath),
    refetchInterval: 30000,
  });

  // Fetch related events using field selector
  const { data: events = [] } = useQuery<K8sResource[]>({
    queryKey: ['events', namespace, name, resource?.kind],
    queryFn: async () => {
      if (!resource) return [];
      const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${resource.kind}`;
      const eventsPath = namespace
        ? `/api/v1/namespaces/${namespace}/events?fieldSelector=${encodeURIComponent(fieldSelector)}`
        : `/api/v1/events?fieldSelector=${encodeURIComponent(fieldSelector)}`;
      return k8sList<K8sResource>(eventsPath);
    },
    enabled: !!resource,
    refetchInterval: 30000,
  });

  // Run diagnosis
  const diagnoses = React.useMemo<Diagnosis[]>(() => {
    if (!resource) return [];
    return diagnoseResource(resource);
  }, [resource]);

  // Sort events by timestamp
  const sortedEvents = React.useMemo(() => {
    return [...events].sort((a, b) => {
      const aTime = (a as any).lastTimestamp || (a as any).firstTimestamp || '';
      const bTime = (b as any).lastTimestamp || (b as any).firstTimestamp || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [events]);

  // Find related resources
  const relatedResources = React.useMemo(() => {
    if (!resource) return [];

    const related: Array<{ type: string; name: string; path: string }> = [];

    // Owner references
    const ownerRefs = resource.metadata.ownerReferences || [];
    for (const owner of ownerRefs) {
      // Build GVR URL from owner apiVersion + kind
      const [ownerGroup, ownerVersion] = owner.apiVersion.includes('/')
        ? owner.apiVersion.split('/')
        : ['', owner.apiVersion];
      const ownerPlural = owner.kind.toLowerCase() + 's';
      const ownerGvr = ownerGroup
        ? `${ownerGroup}~${ownerVersion}~${ownerPlural}`
        : `${ownerVersion}~${ownerPlural}`;
      const ns = namespace || '_';

      related.push({
        type: owner.kind,
        name: owner.name,
        path: `/r/${ownerGvr}/${ns}/${owner.name}`,
      });
    }

    return related;
  }, [resource, namespace]);

  const handleApplyFix = async (diagnosis: Diagnosis) => {
    if (!diagnosis.fix) return;
    console.log('Applying fix:', diagnosis.fix);
    // TODO: Implement fix application using k8sPatch
  };

  const handleDelete = async () => {
    if (!resource) return;
    const confirmed = window.confirm(`Delete ${resource.kind} "${resource.metadata.name}"?`);
    if (!confirmed) return;

    try {
      await k8sDelete(apiPath);
      addToast({ type: 'success', title: `${resource.kind} "${resource.metadata.name}" deleted` });
      // Navigate back to list
      navigate(`/r/${gvrUrl}`);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Delete failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleViewYaml = () => {
    const ns = namespace || '_';
    const path = `/yaml/${gvrUrl}/${ns}/${name}`;
    addTab({ title: `${name} (YAML)`, path, pinned: false, closable: true });
    navigate(path);
  };

  const handleViewLogs = () => {
    if (!namespace) return;
    const path = `/logs/${namespace}/${name}`;
    addTab({ title: `${name} (Logs)`, path, pinned: false, closable: true });
    navigate(path);
  };

  const handleViewMetrics = () => {
    const ns = namespace || '_';
    const path = `/metrics/${gvrUrl}/${ns}/${name}`;
    addTab({ title: `${name} (Metrics)`, path, pinned: false, closable: true });
    navigate(path);
  };

  const handleScale = async (delta: number) => {
    if (!resource) return;
    const currentReplicas = (resource.spec as any)?.replicas ?? 0;
    const newReplicas = Math.max(0, currentReplicas + delta);
    try {
      await k8sPatch(apiPath, { spec: { replicas: newReplicas } });
      addToast({ type: 'success', title: `Scaled to ${newReplicas} replicas` });
    } catch (err) {
      addToast({ type: 'error', title: 'Scale failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const handleRestart = async () => {
    if (!resource) return;
    try {
      await k8sPatch(apiPath, {
        spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } },
      });
      addToast({ type: 'success', title: `Rollout restart triggered` });
    } catch (err) {
      addToast({ type: 'error', title: 'Restart failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const isScalable = resource?.kind === 'Deployment' || resource?.kind === 'StatefulSet' || resource?.kind === 'ReplicaSet';
  const isRestartable = resource?.kind === 'Deployment';

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 text-sm">Error loading resource</p>
          <p className="text-slate-500 text-xs mt-2">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (isLoading || !resource) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-slate-500 text-sm">Loading...</div>
      </div>
    );
  }

  const status = (resource.status as any) || {};
  const spec = (resource.spec as any) || {};

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => navigate(`/r/${gvrUrl}`)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                title="Back to list"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-2xl font-bold text-slate-100">{resource.metadata.name}</h1>
              {resource.metadata.namespace && (
                <span className="px-2 py-1 text-xs bg-purple-900/50 text-purple-300 rounded border border-purple-700">
                  {resource.metadata.namespace}
                </span>
              )}
              <StatusBadge resource={resource} />
            </div>
            <p className="text-sm text-slate-400">
              {resource.kind} · {resource.apiVersion}
            </p>
          </div>
          <div className="flex gap-2">
            {resource.kind === 'Pod' && namespace && (
              <button
                onClick={handleViewLogs}
                className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1.5"
              >
                <FileText className="w-3 h-3" />
                Logs
              </button>
            )}
            {isScalable && (
              <div className="flex items-center gap-1">
                <button onClick={() => handleScale(-1)} className="px-2 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700">
                  <Minus className="w-3 h-3" />
                </button>
                <span className="px-2 py-1.5 text-xs bg-blue-900 text-blue-300 rounded font-mono">
                  {(resource.spec as any)?.replicas ?? 0}
                </span>
                <button onClick={() => handleScale(1)} className="px-2 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}
            {isRestartable && (
              <button
                onClick={handleRestart}
                className="px-3 py-1.5 text-xs bg-orange-900 text-orange-300 rounded hover:bg-orange-800 flex items-center gap-1.5"
              >
                <RotateCw className="w-3 h-3" />
                Restart
              </button>
            )}
            {namespace && (
              <>
                <button
                  onClick={() => {
                    const path = `/deps/${gvrUrl}/${namespace}/${name}`;
                    addTab({ title: `${name} (Deps)`, path, pinned: false, closable: true });
                    navigate(path);
                  }}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1.5"
                >
                  <GitBranch className="w-3 h-3" />
                  Dependencies
                </button>
                <button
                  onClick={() => {
                    const path = `/investigate/${gvrUrl}/${namespace}/${name}`;
                    addTab({ title: `${name} (Investigate)`, path, pinned: false, closable: true });
                    navigate(path);
                  }}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1.5"
                >
                  <Search className="w-3 h-3" />
                  Investigate
                </button>
              </>
            )}
            <button
              onClick={handleViewMetrics}
              className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1.5"
            >
              <Activity className="w-3 h-3" />
              Metrics
            </button>
            <button
              onClick={handleViewYaml}
              className="px-3 py-1.5 text-xs bg-slate-800 text-slate-200 rounded hover:bg-slate-700 flex items-center gap-1.5"
            >
              <FileCode className="w-3 h-3" />
              YAML
            </button>
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-xs bg-red-900/50 text-red-300 rounded hover:bg-red-900 flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </div>

        {/* Diagnosis Box */}
        {diagnoses.length > 0 && (
          <div className="bg-slate-900 rounded-lg border border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-500" />
                Diagnoses ({diagnoses.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-800">
              {diagnoses.map((diagnosis, idx) => (
                <div key={idx} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    {diagnosis.severity === 'critical' ? (
                      <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    ) : diagnosis.severity === 'warning' ? (
                      <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-100 mb-1">
                        {diagnosis.title}
                      </p>
                      <p className="text-sm text-slate-300 mb-2">{diagnosis.detail}</p>
                      {diagnosis.suggestion && (
                        <p className="text-xs text-slate-400 mb-2">
                          💡 {diagnosis.suggestion}
                        </p>
                      )}
                      {diagnosis.fix && (
                        <button
                          onClick={() => handleApplyFix(diagnosis)}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          {diagnosis.fix.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Metadata */}
            <DetailSection title="Metadata">
              <DetailField label="Name" value={resource.metadata.name} />
              {resource.metadata.namespace && (
                <DetailField label="Namespace" value={resource.metadata.namespace} />
              )}
              <DetailField label="UID" value={resource.metadata.uid} mono />
              <DetailField
                label="Created"
                value={
                  resource.metadata.creationTimestamp
                    ? new Date(resource.metadata.creationTimestamp).toLocaleString()
                    : '-'
                }
              />
              {resource.metadata.resourceVersion && (
                <DetailField
                  label="Resource Version"
                  value={resource.metadata.resourceVersion}
                  mono
                />
              )}
            </DetailSection>

            {/* Containers (Pods only) */}
            {resource.kind === 'Pod' && spec.containers && (
              <DetailSection title={`Containers (${(spec.containers as any[]).length})`}>
                <div className="space-y-3">
                  {(spec.containers as any[]).map((container: any) => {
                    const containerStatus = (status.containerStatuses as any[] || []).find(
                      (cs: any) => cs.name === container.name
                    );
                    const isReady = containerStatus?.ready === true;
                    const restarts = containerStatus?.restartCount ?? 0;
                    const state = containerStatus?.state;
                    const stateLabel = state?.running ? 'Running' : state?.waiting ? state.waiting.reason || 'Waiting' : state?.terminated ? 'Terminated' : 'Unknown';

                    return (
                      <div key={container.name} className="flex items-start gap-4 py-2 border-b border-slate-800 last:border-b-0">
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${isReady ? 'bg-green-500' : 'bg-yellow-500'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-slate-200">{container.name}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${isReady ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                              {stateLabel}
                            </span>
                            {restarts > 0 && (
                              <span className="text-xs text-orange-400">{restarts} restart{restarts !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 font-mono truncate">{container.image}</div>
                          {container.ports && (
                            <div className="text-xs text-slate-500 mt-1">
                              Ports: {(container.ports as any[]).map((p: any) => `${p.containerPort}/${p.protocol || 'TCP'}`).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </DetailSection>
            )}

            {/* Labels */}
            {resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0 && (
              <DetailSection title="Labels">
                <div className="space-y-2">
                  {Object.entries(resource.metadata.labels).map(([key, value]) => (
                    <div key={key} className="flex items-start gap-2">
                      <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48">
                        {key}
                      </span>
                      <span className="text-xs text-slate-200 font-mono">{value}</span>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}

            {/* Annotations */}
            {resource.metadata.annotations &&
              Object.keys(resource.metadata.annotations).length > 0 && (
                <DetailSection title="Annotations" collapsible>
                  <div className="space-y-2">
                    {Object.entries(resource.metadata.annotations).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-2">
                        <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48">
                          {key}
                        </span>
                        <span className="text-xs text-slate-200 font-mono break-all">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </DetailSection>
              )}

            {/* Spec (simplified) */}
            {spec && Object.keys(spec).length > 0 && (
              <DetailSection title="Spec" collapsible>
                <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded overflow-auto max-h-96">
                  {JSON.stringify(spec, null, 2)}
                </pre>
              </DetailSection>
            )}

            {/* Status (simplified) */}
            {status && Object.keys(status).length > 0 && (
              <DetailSection title="Status" collapsible>
                <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded overflow-auto max-h-96">
                  {JSON.stringify(status, null, 2)}
                </pre>
              </DetailSection>
            )}
          </div>

          {/* Right column - Timeline & Related */}
          <div className="space-y-6">
            {/* Related Resources */}
            {relatedResources.length > 0 && (
              <div className="bg-slate-900 rounded-lg border border-slate-800">
                <div className="px-4 py-3 border-b border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-100">Related Resources</h2>
                </div>
                <div className="divide-y divide-slate-800">
                  {relatedResources.map((related, idx) => (
                    <button
                      key={idx}
                      onClick={() => navigate(related.path)}
                      className="w-full px-4 py-2 text-left hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="text-xs text-slate-400">{related.type}</div>
                      <div className="text-sm text-blue-400 font-medium">{related.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-slate-900 rounded-lg border border-slate-800">
              <div className="px-4 py-3 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Events ({sortedEvents.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-800 max-h-96 overflow-auto">
                {sortedEvents.length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-500 text-xs">
                    No events found
                  </div>
                ) : (
                  sortedEvents.slice(0, 20).map((event, idx) => {
                    const eventAny = event as any;
                    const timestamp =
                      eventAny.lastTimestamp || eventAny.firstTimestamp || '';
                    const type = eventAny.type || 'Normal';
                    const reason = eventAny.reason || '';
                    const message = eventAny.message || '';

                    return (
                      <div key={idx} className="px-4 py-3">
                        <div className="flex items-start gap-2 mb-1">
                          {type === 'Warning' ? (
                            <AlertCircle className="w-3 h-3 text-yellow-500 flex-shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-slate-400 mb-1">
                              {timestamp
                                ? new Date(timestamp).toLocaleTimeString()
                                : 'Unknown time'}
                            </div>
                            <div className="text-xs font-medium text-slate-200 mb-1">
                              {reason}
                            </div>
                            <div className="text-xs text-slate-400">{message}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper components
function StatusBadge({ resource }: { resource: K8sResource }) {
  const { detectResourceStatus } = require('../engine/renderers/statusUtils');
  const { status, reason } = detectResourceStatus(resource);

  const colorMap: Record<string, string> = {
    healthy: 'bg-green-900/50 text-green-300 border-green-700',
    warning: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    error: 'bg-red-900/50 text-red-300 border-red-700',
    pending: 'bg-blue-900/50 text-blue-300 border-blue-700',
    terminating: 'bg-orange-900/50 text-orange-300 border-orange-700',
    unknown: 'bg-slate-900/50 text-slate-400 border-slate-700',
  };

  const colorClass = colorMap[status] || colorMap.unknown;

  return (
    <span className={cn('px-2 py-1 text-xs rounded border', colorClass)}>
      {reason}
    </span>
  );
}

function DetailSection({
  title,
  children,
  collapsible = false,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(true);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div
        className={cn(
          'px-4 py-3 border-b border-slate-800',
          collapsible && 'cursor-pointer hover:bg-slate-800/50'
        )}
        onClick={() => collapsible && setIsOpen(!isOpen)}
      >
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      {isOpen && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 py-2">
      <span className="text-xs text-slate-400 w-40 flex-shrink-0">{label}</span>
      <span className={cn('text-xs text-slate-200', mono && 'font-mono')}>
        {value || '-'}
      </span>
    </div>
  );
}
