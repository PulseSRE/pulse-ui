import React, { Suspense, lazy } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const AmbientInsight = lazy(() => import('../components/agent/AmbientInsight').then(m => ({ default: m.AmbientInsight })));
const InlineAgent = lazy(() => import('../components/agent/InlineAgent').then(m => ({ default: m.InlineAgent })));
import { useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  AlertCircle,
  XCircle,
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
  Copy,
  Star,
  ArrowRight,
  Box,
  Bug,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sGet, k8sList, k8sDelete, k8sPatch, k8sCreate, k8sLogs } from '../engine/query';
import { MetricCard } from '../components/metrics/Sparkline';
import type { K8sResource } from '../engine/renderers';
import type { Deployment, StatefulSet, DaemonSet, Pod, Event, Container, ContainerPort, ContainerStatus, Condition } from '../engine/types';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { kindToPlural } from '../engine/renderers/index';
import { buildApiPath } from '../hooks/useResourceUrl';
import { useUIStore } from '../store/uiStore';
import { jsonToYaml, resourceToYaml } from '../engine/yamlUtils';
// Terminal now opens in dock panel via useUIStore.openTerminal()
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import DataEditor from '../components/DataEditor';
import DeployProgress from '../components/DeployProgress';
import { toggleFavorite, isFavorite } from '../engine/favorites';
import { showErrorToast } from '../engine/errorToast';
import { copyToClipboard } from '../engine/clipboard';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { StatusBadge } from '../components/primitives/StatusBadge';
import { ActionMenu, type ActionMenuItem } from '../components/primitives/ActionMenu';
import { IncidentContext } from './detail/IncidentContext';
import { WorkloadAudit } from './detail/WorkloadAudit';
import { RollbackPanel } from './detail/RollbackPanel';
import { DeploymentSummary } from './detail/DeploymentSummary';
import { PodSummary } from './detail/PodSummary';
import { Card } from '../components/primitives/Card';
import { ArgoSyncBadge } from '../components/ArgoSyncBadge';
import { GitOpsInfoCard } from '../components/GitOpsInfoCard';
import { ResourceHistoryPanel } from './argocd/ResourceHistoryPanel';
import { useArgoSyncInfo } from '../hooks/useArgoCD';
import { useCanI } from '../hooks/useCanI';

interface DetailViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

export default function DetailView({ gvrKey, namespace, name }: DetailViewProps) {
  const navigate = useNavigate();
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const setDockContext = useUIStore((s) => s.setDockContext);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  // Build GVR URL segment for navigation
  const gvrUrl = gvrKey.replace(/\//g, '~');
  const gvrParts = gvrKey.split('/');
  const resourcePlural = gvrParts[gvrParts.length - 1];
  const resourceGroup = gvrParts.length === 3 ? gvrParts[0] : '';

  // RBAC permission checks
  const { allowed: canDelete } = useCanI('delete', resourceGroup, resourcePlural, namespace);
  const { allowed: canUpdate } = useCanI('update', resourceGroup, resourcePlural, namespace);

  // Build API path for this specific resource
  const apiPath = React.useMemo(
    () => buildApiPath(gvrKey, namespace, name),
    [gvrKey, namespace, name]
  );

  // Build list API path for cache invalidation (e.g., /apis/apps/v1/deployments)
  const listApiPath = React.useMemo(() => {
    if (gvrParts.length === 2) return `/api/${gvrParts[0]}/${gvrParts[1]}`;
    return `/apis/${gvrParts[0]}/${gvrParts[1]}/${gvrParts[2]}`;
  }, [gvrKey]);

  // Fetch the resource
  const { data: resource, isLoading, error } = useQuery<K8sResource>({
    queryKey: ['detail', apiPath],
    queryFn: () => k8sGet<K8sResource>(apiPath),
    refetchInterval: 30000,
  });

  // Fetch managed pods for workloads (Deployment/StatefulSet/DaemonSet)
  const isWorkload = resource?.kind === 'Deployment' || resource?.kind === 'StatefulSet' || resource?.kind === 'DaemonSet';
  const selectorLabels = (resource?.spec as Deployment['spec'])?.selector?.matchLabels as Record<string, string> | undefined;
  const podsApiPath = React.useMemo(() => {
    if (!selectorLabels || !namespace) return '';
    const labelSelector = Object.entries(selectorLabels).map(([k, v]) => `${k}=${v}`).join(',');
    return `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(labelSelector)}`;
  }, [selectorLabels, namespace]);

  const { data: managedPods = [] } = useK8sListWatch<K8sResource>({
    apiPath: podsApiPath,
    enabled: !!resource && isWorkload && !!selectorLabels && !!namespace && !!podsApiPath,
  });

  // Set dock context for logs tab — show logs for the first managed pod or the pod itself
  React.useEffect(() => {
    if (resource?.kind === 'Pod' && namespace) {
      setDockContext({ namespace, podName: name });
    } else if (isWorkload && managedPods.length > 0 && namespace) {
      setDockContext({ namespace, podName: managedPods[0].metadata.name });
    }
    return () => setDockContext(null);
  }, [resource?.kind, namespace, name, isWorkload, managedPods.length > 0 ? managedPods[0]?.metadata?.name : null]);

  // Fetch related events — for workloads, fetch all namespace events and filter client-side
  // because Deployments don't emit events directly (events are on ReplicaSets/Pods)
  const eventsApiPath = React.useMemo(() => {
    if (!resource) return '';
    if (isWorkload && namespace) {
      // Fetch all events in namespace, filter client-side to include managed pod/RS events
      return `/api/v1/namespaces/${namespace}/events`;
    }
    const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${resource.kind}`;
    return namespace
      ? `/api/v1/namespaces/${namespace}/events?fieldSelector=${encodeURIComponent(fieldSelector)}`
      : `/api/v1/events?fieldSelector=${encodeURIComponent(fieldSelector)}`;
  }, [resource, name, namespace, isWorkload]);

  const { data: rawEvents = [] } = useK8sListWatch<K8sResource>({
    apiPath: eventsApiPath,
    enabled: !!resource && !!eventsApiPath,
  });

  // Filter and sort events — for workloads include events from managed pods/ReplicaSets
  const sortedEvents = React.useMemo(() => {
    const managedPodNames = new Set(managedPods.map(p => p.metadata.name));
    const filtered = isWorkload
      ? rawEvents.filter((e) => {
          const ev = e as unknown as Event;
          const objName = ev.involvedObject?.name || '';
          const objKind = ev.involvedObject?.kind || '';
          // Direct events on this resource
          if (objName === name) return true;
          // Events on managed pods
          if (objKind === 'Pod' && managedPodNames.has(objName)) return true;
          // Events on owned ReplicaSets (name starts with deployment name)
          if (objKind === 'ReplicaSet' && objName.startsWith(`${name}-`)) return true;
          return false;
        })
      : rawEvents;
    return filtered.sort((a, b) => {
      const aTime = (a as unknown as Event).lastTimestamp || (a as unknown as Event).firstTimestamp || '';
      const bTime = (b as unknown as Event).lastTimestamp || (b as unknown as Event).firstTimestamp || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [rawEvents, name, isWorkload, managedPods]);

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
      const ownerPlural = kindToPlural(owner.kind);
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


  const handleDelete = async () => {
    if (!resource) return;
    setDeleting(true);
    try {
      await k8sDelete(apiPath);
      // Optimistically remove from all list caches
      queryClient.setQueriesData({ queryKey: ['k8s', 'list'] }, (old: unknown) => {
        if (!old || !Array.isArray(old)) return old;
        return old.filter((r: K8sResource) => r.metadata?.uid !== resource.metadata.uid);
      });
      setShowDeleteConfirm(false);
      // Show delete progress instead of navigating away
      setShowDeleteProgress(true);
    } catch (err) {
      showErrorToast(err, 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleViewYaml = () => {
    const ns = namespace || '_';
    go(`/yaml/${gvrUrl}/${ns}/${name}`, `${name} (YAML)`);
  };

  const handleViewLogs = () => {
    if (!namespace) return;
    if (isWorkload) {
      // For workloads, pass the label selector so LogsView can find all pods
      const selector = selectorLabels ? Object.entries(selectorLabels).map(([k, v]) => `${k}=${v}`).join(',') : `app=${name}`;
      go(`/logs/${namespace}/${name}?selector=${encodeURIComponent(selector)}&kind=${resource?.kind}`, `${name} (Logs)`);
    } else {
      go(`/logs/${namespace}/${name}`, `${name} (Logs)`);
    }
  };

  const handleViewMetrics = () => {
    const ns = namespace || '_';
    go(`/metrics/${gvrUrl}/${ns}/${name}`, `${name} (Metrics)`);
  };

  const handleDebug = async () => {
    if (!resource || actionLoading) return;
    setActionLoading('debug');
    try {
      if (resource.kind === 'Node') {
        // Create a debug pod on the node
        const debugName = `debug-${resource.metadata.name.slice(0, 20)}-${Date.now().toString(36).slice(-4)}`;
        const debugPod = {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: {
            name: debugName,
            namespace: 'default',
            labels: { 'openshiftpulse/debug': 'true', 'openshiftpulse/debug-node': resource.metadata.name },
          },
          spec: {
            nodeName: resource.metadata.name,
            hostPID: true,
            hostNetwork: true,
            restartPolicy: 'Never',
            containers: [{
              name: 'debug',
              image: 'registry.redhat.io/rhel9/support-tools:latest',
              command: ['sleep', '3600'],
              securityContext: { privileged: true },
              volumeMounts: [{ name: 'host', mountPath: '/host' }],
            }],
            volumes: [{ name: 'host', hostPath: { path: '/' } }],
          },
        };
        await k8sCreate('/api/v1/namespaces/default/pods', debugPod);
        addToast({ type: 'success', title: `Debug pod created: ${debugName}`, detail: 'Host filesystem at /host. Run: chroot /host. Pod auto-deletes in 1 hour.' });
        // Open terminal to the debug pod in the dock panel (stay on node detail)
        setTimeout(() => {
          useUIStore.getState().openTerminal({
            namespace: 'default',
            podName: debugName,
            containerName: 'debug',
            isNode: false,
          });
        }, 2000); // Wait for pod to start
      } else if (resource.kind === 'Pod' && namespace) {
        // Create ephemeral debug container
        const debugContainerName = `debug-${Date.now().toString(36).slice(-6)}`;
        const patch = {
          spec: {
            ephemeralContainers: [
              ...((resource.spec as Pod['spec'] & { ephemeralContainers?: unknown[] })?.ephemeralContainers || []),
              {
                name: debugContainerName,
                image: 'busybox:latest',
                command: ['sh'],
                stdin: true,
                tty: true,
                targetContainerName: (resource.spec as Pod['spec'])?.containers?.[0]?.name,
              },
            ],
          },
        };
        await k8sPatch(
          `/api/v1/namespaces/${namespace}/pods/${resource.metadata.name}/ephemeralcontainers`,
          patch,
          'application/strategic-merge-patch+json'
        );
        addToast({ type: 'success', title: `Debug container "${debugContainerName}" added`, detail: 'Shares process namespace with the target container. Connect via terminal.' });
        queryClient.invalidateQueries({ queryKey: ['detail', apiPath] });
      }
    } catch (err) {
      showErrorToast(err, 'Debug failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleScale = async (delta: number) => {
    if (!resource || actionLoading) return;
    const currentReplicas = (resource.spec as Deployment['spec'])?.replicas ?? 0;
    const newReplicas = Math.max(0, currentReplicas + delta);
    setActionLoading('scale');
    try {
      await k8sPatch(apiPath, { spec: { replicas: newReplicas } });
      addToast({ type: 'success', title: `Scaled to ${newReplicas} replicas` });
      queryClient.invalidateQueries({ queryKey: ['detail', apiPath] });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', listApiPath] });
    } catch (err) {
      showErrorToast(err, 'Scale failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestart = async () => {
    if (!resource || actionLoading) return;
    setActionLoading('restart');
    try {
      await k8sPatch(apiPath, {
        spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } },
      });
      addToast({ type: 'success', title: `Rollout restart triggered` });
      queryClient.invalidateQueries({ queryKey: ['detail', apiPath] });
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', listApiPath] });
    } catch (err) {
      showErrorToast(err, 'Restart failed');
    } finally {
      setActionLoading(null);
    }
  };

  const isScalable = resource?.kind === 'Deployment' || resource?.kind === 'StatefulSet' || resource?.kind === 'ReplicaSet';
  const isRestartable = resource?.kind === 'Deployment';
  const [detailTab, setDetailTab] = React.useState<'overview' | 'conditions' | 'events'>('overview');
  const currentPath = namespace ? `/r/${gvrUrl}/${namespace}/${name}` : `/r/${gvrUrl}/_/${name}`;
  const [starred, setStarred] = React.useState(() => isFavorite(currentPath));
  // Terminal state moved to dock panel (useUIStore.openTerminal)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showDeleteProgress, setShowDeleteProgress] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [showLabelDialog, setShowLabelDialog] = React.useState(false);
  const [labelKey, setLabelKey] = React.useState('');
  const [labelValue, setLabelValue] = React.useState('');

  const addLabelButton = (
    <button
      disabled={!!actionLoading}
      onClick={() => { setLabelKey(''); setLabelValue(''); setShowLabelDialog(true); }}
      className="mt-2 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
    >
      {actionLoading === 'label' ? 'Adding...' : '+ Add label'}
    </button>
  );

  if (error) {
    const isNotFound = (error as Error).message?.includes('not found') || (error as Error).message?.includes('404');
    const listPath = `/r/${gvrUrl}`;

    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-center max-w-md">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 text-sm font-medium">
            {isNotFound ? 'Resource not found' : 'Error loading resource'}
          </p>
          <p className="text-slate-500 text-xs mt-2">{(error as Error).message}</p>
          {isNotFound && (
            <p className="text-slate-400 text-xs mt-3">
              This resource may have been deleted or replaced. Pods managed by Deployments are ephemeral and get new names on restart.
            </p>
          )}
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={() => go(listPath, resourcePlural)}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
            >
              View all {resourcePlural}
            </button>
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !resource) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-800 rounded" />
            <div className="h-6 bg-slate-800 rounded w-48" />
            <div className="h-5 bg-slate-800 rounded w-20" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-800/50 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-slate-800/30 rounded-lg" />
        </div>
      </div>
    );
  }

  const status = (resource.status as Record<string, unknown>) || {};
  const spec = (resource.spec as Record<string, unknown>) || {};

  return (
    <>
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm mb-1" aria-label="Breadcrumb">
              <button
                onClick={() => navigate(-1)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                title="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => go(`/r/${gvrUrl}`, resourcePlural)}
                className="text-blue-400 hover:text-blue-300 capitalize"
                data-testid="breadcrumb-kind"
              >
                {resourcePlural}
              </button>
              {namespace && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  <button
                    onClick={() => go(`/r/${gvrUrl}?ns=${namespace}`, `${resourcePlural} (${namespace})`)}
                    className="text-blue-400 hover:text-blue-300"
                    data-testid="breadcrumb-namespace"
                  >
                    {namespace}
                  </button>
                </>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              <span className="text-slate-400" data-testid="breadcrumb-name">{name}</span>
            </nav>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-slate-100">{resource.metadata.name}</h1>
              <button
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(resource.metadata.name); addToast({ type: 'success', title: 'Name copied' }); }}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                title="Copy name"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const isNow = toggleFavorite({ path: currentPath, title: resource.metadata.name, kind: resource.kind, namespace: resource.metadata.namespace });
                  setStarred(isNow);
                  addToast({ type: 'success', title: isNow ? 'Added to favorites' : 'Removed from favorites' });
                }}
                className={cn('p-1 rounded transition-colors', starred ? 'text-yellow-400 hover:text-yellow-300' : 'text-slate-500 hover:text-yellow-400 hover:bg-slate-800')}
                title={starred ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={cn('w-3.5 h-3.5', starred && 'fill-current')} />
              </button>
              {resource.metadata.namespace && (
                <span className="px-2 py-1 text-xs bg-purple-900/50 text-purple-300 rounded border border-purple-700">
                  {resource.metadata.namespace}
                </span>
              )}
              <StatusBadge resource={resource} />
              <ArgoSyncBadge kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} showLabel />
            </div>
            <p className="text-sm text-slate-400">
              {resource.kind} · {resource.apiVersion}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Primary actions — consistent icon+label style */}
            {(resource.kind === 'Pod' || isWorkload) && namespace && (
              <button onClick={handleViewLogs} className="px-2.5 py-1.5 text-xs text-slate-400 rounded hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Logs
              </button>
            )}
            {(resource.kind === 'Pod' || resource.kind === 'Node') && (
              <>
                <button onClick={() => {
                  const containerName = resource.kind === 'Pod'
                    ? (spec.containers as Container[] | undefined)?.[0]?.name || ''
                    : '';
                  useUIStore.getState().openTerminal({
                    namespace: resource.kind === 'Node' ? 'default' : namespace || '',
                    podName: name,
                    containerName,
                    isNode: resource.kind === 'Node',
                  });
                }} className="px-2.5 py-1.5 text-xs text-slate-400 rounded hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
                  <Terminal className="w-3.5 h-3.5" /> Terminal
                </button>
                <button onClick={handleDebug} disabled={!!actionLoading} className="px-2.5 py-1.5 text-xs text-slate-400 rounded hover:bg-slate-800 hover:text-amber-400 flex items-center gap-1.5 transition-colors disabled:opacity-50">
                  <Bug className={cn('w-3.5 h-3.5', actionLoading === 'debug' && 'animate-pulse')} />
                  {actionLoading === 'debug' ? 'Creating...' : 'Debug'}
                </button>
              </>
            )}
            {isScalable && (
              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-800/50" title={canUpdate ? undefined : 'No update permission'}>
                <button onClick={() => handleScale(-1)} disabled={!canUpdate || !!actionLoading} className={cn('px-1.5 py-1 rounded transition-colors disabled:opacity-30', canUpdate ? 'text-slate-400 hover:bg-slate-700 hover:text-slate-200' : 'text-slate-700 cursor-not-allowed')}>
                  <Minus className="w-3 h-3" />
                </button>
                <span className={cn('px-2 py-0.5 text-xs font-mono text-slate-300', actionLoading === 'scale' && 'animate-pulse')}>
                  {(resource.spec as Deployment['spec'])?.replicas ?? 0}
                </span>
                <button onClick={() => handleScale(1)} disabled={!canUpdate || !!actionLoading} className={cn('px-1.5 py-1 rounded transition-colors disabled:opacity-30', canUpdate ? 'text-slate-400 hover:bg-slate-700 hover:text-slate-200' : 'text-slate-700 cursor-not-allowed')}>
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}
            {isRestartable && (
              <button
                onClick={handleRestart}
                disabled={!canUpdate || !!actionLoading}
                className={cn('px-2.5 py-1.5 text-xs rounded flex items-center gap-1.5 transition-colors disabled:opacity-50',
                  canUpdate ? 'text-slate-400 hover:bg-slate-800 hover:text-orange-400' : 'text-slate-700 cursor-not-allowed'
                )}
                title={canUpdate ? 'Restart rollout' : 'No update permission'}
              >
                <RotateCw className={cn('w-3.5 h-3.5', actionLoading === 'restart' && 'animate-spin')} /> {actionLoading === 'restart' ? 'Restarting...' : 'Restart'}
              </button>
            )}
            <button onClick={handleViewYaml} className="px-2.5 py-1.5 text-xs text-slate-400 rounded hover:bg-slate-800 hover:text-blue-400 flex items-center gap-1.5 transition-colors">
              <FileCode className="w-3.5 h-3.5" /> YAML
            </button>

            {/* More actions dropdown */}
            <ActionMenu
              items={[
                resource.kind === 'Node' ? { icon: <FileText className="w-3.5 h-3.5" />, label: 'Node Logs', onClick: () => go(`/node-logs/${name}`, `${name} (Logs)`) } : null,
                { icon: <Activity className="w-3.5 h-3.5" />, label: 'Metrics', onClick: handleViewMetrics },
                namespace ? { icon: <GitBranch className="w-3.5 h-3.5" />, label: 'Dependencies', onClick: () => go(`/deps/${gvrUrl}/${namespace}/${name}`, `${name} (Deps)`) } : null,
                'separator',
                { icon: <Trash2 className={cn('w-3.5 h-3.5', canDelete ? 'text-red-400' : 'text-slate-600')} />, label: canDelete ? 'Delete' : 'Delete (no permission)', onClick: () => setShowDeleteConfirm(true), danger: canDelete, disabled: !canDelete, title: canDelete ? undefined : 'No delete permission' },
              ]}
            />
          </div>
        </div>



        {/* Detail tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit">
          {(['overview', 'conditions', 'events'] as const).map((tab) => {
            const conditions = (status.conditions || []) as Condition[];
            return (
            <button key={tab} onClick={() => setDetailTab(tab)} className={cn('px-4 py-1.5 text-xs rounded-md transition-colors capitalize', detailTab === tab ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              {tab === 'events' ? `Events (${sortedEvents.length})` : tab === 'conditions' ? `Conditions (${conditions.length})` : tab}
            </button>
            );
          })}
        </div>

        {/* Conditions tab */}
        {detailTab === 'conditions' && (() => {
          const conditions = (status.conditions || []) as Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string; lastHeartbeatTime?: string }>;
          return (
            <Card>
              {conditions.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-500 text-sm">No conditions reported for this resource</div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 w-8"></th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Type</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Status</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Reason</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Last Transition</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {conditions.map((cond, idx) => {
                        const isGood = (cond.type === 'Ready' || cond.type === 'Available' || cond.type === 'Initialized' || cond.type === 'PodScheduled' || cond.type === 'ContainersReady') ? cond.status === 'True' : cond.type.includes('Pressure') || cond.type === 'Degraded' ? cond.status !== 'True' : cond.status === 'True';
                        return (
                          <tr key={idx} className="hover:bg-slate-800/30">
                            <td className="px-4 py-2.5">
                              {isGood ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                            </td>
                            <td className="px-4 py-2.5 text-slate-200 font-medium">{cond.type}</td>
                            <td className="px-4 py-2.5">
                              <span className={cn('text-xs px-2 py-0.5 rounded', isGood ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>
                                {cond.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-400">{cond.reason || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">
                              {cond.lastTransitionTime ? new Date(cond.lastTransitionTime).toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-400 max-w-xs truncate" title={cond.message}>
                              {cond.message || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })()}

        {/* Events tab */}
        {detailTab === 'events' && (
          <Card>
            <div className="px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Events ({sortedEvents.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {sortedEvents.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-500 text-xs">No events found</div>
              ) : (
                sortedEvents.map((event, idx) => {
                  const eventTyped = event as unknown as Event;
                  const timestamp = eventTyped.lastTimestamp || eventTyped.firstTimestamp || '';
                  const type = eventTyped.type || 'Normal';
                  return (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {type === 'Warning' ? <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />}
                        <div className="flex-1">
                          <div className="text-xs text-slate-500 mb-0.5">{timestamp ? new Date(timestamp).toLocaleString() : ''}</div>
                          <div className="text-xs font-medium text-slate-200">{eventTyped.reason}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{eventTyped.message}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        )}

        {/* Overview tab */}
        {detailTab === 'overview' && (
        <>
        {/* GitOps info (shown for ArgoCD-managed resources) */}
        <GitOpsInfoCard kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} />
        <ResourceHistoryPanel kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} />

        {/* Deployment-specific layout */}
        {resource.kind === 'Deployment' && namespace && (
          <div className="space-y-6">
            <DeploymentSummary resource={resource} managedPods={managedPods} go={go} />

            {/* Incident + Audit + Rollback in 2-column grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                {(resource.kind === 'Pod' || isWorkload) && (
                  <IncidentContext resource={resource} managedPods={managedPods} events={sortedEvents} namespace={namespace} go={go} />
                )}
                <RollbackPanel resource={resource} namespace={namespace} />
              </div>
              <div className="space-y-6">
                <WorkloadAudit resource={resource} go={go} />
                {/* Labels */}
                {resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0 && (
                  <DetailSection title="Labels">
                    <div className="space-y-1.5">
                      {Object.entries(resource.metadata.labels).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 group">
                          <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48 truncate" title={key}>{key}</span>
                          <span className="text-xs text-slate-200 font-mono flex-1">{value}</span>
                          <button onClick={() => { navigator.clipboard.writeText(`${key}=${value}`); addToast({ type: 'success', title: 'Label copied' }); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-opacity" title="Copy label">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {addLabelButton}
                  </DetailSection>
                )}
                {/* Annotations */}
                {resource.metadata.annotations && Object.keys(resource.metadata.annotations).length > 0 && (
                  <DetailSection title="Annotations" collapsible>
                    <div className="space-y-2">
                      {Object.entries(resource.metadata.annotations)
                        .filter(([key]) => !key.includes('last-applied-configuration') && !key.includes('managedFields'))
                        .map(([key, value]) => (
                          <div key={key} className="flex items-start gap-2 group">
                            <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48 truncate" title={key}>{key}</span>
                            <span className="text-xs text-slate-200 font-mono break-all flex-1">
                              {String(value).length > 200 ? String(value).slice(0, 200) + '...' : value}
                            </span>
                          </div>
                        ))}
                    </div>
                  </DetailSection>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Pod-specific layout */}
        {resource.kind === 'Pod' && namespace && (
          <div className="space-y-6">
            <PodSummary resource={resource} go={go} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <IncidentContext resource={resource} managedPods={[]} events={sortedEvents} namespace={namespace} go={go} />
              </div>
              <div className="space-y-6">
                {/* Labels */}
                {resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0 && (
                  <DetailSection title="Labels">
                    <div className="space-y-1.5">
                      {Object.entries(resource.metadata.labels).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 group">
                          <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48 truncate" title={key}>{key}</span>
                          <span className="text-xs text-slate-200 font-mono flex-1">{value}</span>
                          <button onClick={() => { navigator.clipboard.writeText(`${key}=${value}`); addToast({ type: 'success', title: 'Label copied' }); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-opacity" title="Copy label">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {addLabelButton}
                  </DetailSection>
                )}
                {/* Annotations */}
                {resource.metadata.annotations && Object.keys(resource.metadata.annotations).length > 0 && (
                  <DetailSection title="Annotations" collapsible>
                    <div className="space-y-2">
                      {Object.entries(resource.metadata.annotations)
                        .filter(([key]) => !key.includes('last-applied-configuration') && !key.includes('managedFields'))
                        .map(([key, value]) => (
                          <div key={key} className="flex items-start gap-2 group">
                            <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48 truncate" title={key}>{key}</span>
                            <span className="text-xs text-slate-200 font-mono break-all flex-1">
                              {String(value).length > 200 ? String(value).slice(0, 200) + '...' : value}
                            </span>
                          </div>
                        ))}
                    </div>
                  </DetailSection>
                )}
                {/* Owner */}
                {relatedResources.length > 0 && (
                  <DetailSection title="Owner">
                    <div className="space-y-1">
                      {relatedResources.map((related, idx) => (
                        <button key={idx} onClick={() => go(related.path, related.name)}
                          className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
                          <span className="text-xs text-slate-500">{related.type}</span>
                          {related.name}
                        </button>
                      ))}
                    </div>
                  </DetailSection>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Generic layout for other resources */}
        {(resource.kind !== 'Deployment' || !namespace) && (resource.kind !== 'Pod' || !namespace) && (
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
              <DetailSection title={`Containers (${(spec.containers as Container[]).length})`}>
                <div className="space-y-3">
                  {(spec.containers as Container[]).map((container: Container) => {
                    const containerStatus = (status.containerStatuses as ContainerStatus[] || []).find(
                      (cs: ContainerStatus) => cs.name === container.name
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
                              Ports: {(container.ports as ContainerPort[]).map((p: ContainerPort) => `${p.containerPort}/${p.protocol || 'TCP'}`).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </DetailSection>
            )}

            {/* Data Editor for ConfigMaps and Secrets */}
            {(resource.kind === 'ConfigMap' || resource.kind === 'Secret') && (
              <DataEditor
                resourcePath={apiPath}
                data={(resource.data || {}) as Record<string, string>}
                kind={resource.kind as 'ConfigMap' | 'Secret'}
              />
            )}

            {/* Labels */}
            {resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0 && (
              <DetailSection title="Labels">
                <div className="space-y-1.5">
                  {Object.entries(resource.metadata.labels).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 group">
                      <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48 truncate" title={key}>
                        {key}
                      </span>
                      <span className="text-xs text-slate-200 font-mono flex-1">{value}</span>
                      <button
                        onClick={() => copyToClipboard(`${key}=${value}`, 'Label copied')}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-opacity"
                        title="Copy label"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {addLabelButton}
              </DetailSection>
            )}

            {/* Annotations */}
            {resource.metadata.annotations &&
              Object.keys(resource.metadata.annotations).length > 0 && (
                <DetailSection title="Annotations" collapsible>
                  <div className="space-y-2">
                    {Object.entries(resource.metadata.annotations)
                      .filter(([key]) => !key.includes('last-applied-configuration') && !key.includes('managedFields'))
                      .map(([key, value]) => (
                        <div key={key} className="flex items-start gap-2 group">
                          <span className="text-xs text-slate-400 font-mono flex-shrink-0 w-48 truncate" title={key}>
                            {key}
                          </span>
                          <span className="text-xs text-slate-200 font-mono break-all flex-1">
                            {String(value).length > 200 ? String(value).slice(0, 200) + '...' : value}
                          </span>
                          <button
                            onClick={() => { navigator.clipboard.writeText(`${key}: ${value}`); addToast({ type: 'success', title: 'Annotation copied' }); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-opacity flex-shrink-0"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                </DetailSection>
              )}

            {/* Spec (simplified) */}
            {spec && Object.keys(spec).length > 0 && (
              <DetailSection title="Spec" collapsible>
                <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded overflow-auto max-h-96">
                  {jsonToYaml(spec)}
                </pre>
              </DetailSection>
            )}

            {/* Status (simplified) */}
            {status && Object.keys(status).length > 0 && (
              <DetailSection title="Status" collapsible>
                <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded overflow-auto max-h-96">
                  {jsonToYaml(status)}
                </pre>
              </DetailSection>
            )}
          </div>

          {/* Right column - Timeline & Related */}
          <div className="space-y-6">
            {/* Related Resources */}
            {relatedResources.length > 0 && (
              <Card>
                <div className="px-4 py-3 border-b border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-100">Related Resources</h2>
                </div>
                <div className="divide-y divide-slate-800">
                  {relatedResources.map((related, idx) => (
                    <button
                      key={idx}
                      onClick={() => go(related.path, related.name)}
                      className="w-full px-4 py-2 text-left hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="text-xs text-slate-400">{related.type}</div>
                      <div className="text-sm text-blue-400 font-medium">{related.name}</div>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {/* Managed Pods (workloads only) */}
            {isWorkload && managedPods.length > 0 && (
              <Card>
                <div className="px-4 py-3 border-b border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Box className="w-4 h-4 text-blue-400" />
                    Pods ({managedPods.length})
                  </h2>
                </div>
                <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
                  {managedPods.map((pod) => {
                    const podStatus = pod.status as Pod['status'];
                    const podPhase = podStatus?.phase || 'Pending';
                    const podContainerStatuses = podStatus?.containerStatuses || [];
                    const ready = podContainerStatuses.filter((c) => c.ready).length;
                    const total = podContainerStatuses.length || 1;
                    const waiting = podContainerStatuses.find((c) => c.state?.waiting)?.state?.waiting;
                    const restarts = podContainerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

                    return (
                      <button
                        key={pod.metadata.uid}
                        onClick={() => go(`/r/v1~pods/${pod.metadata.namespace}/${pod.metadata.name}`, pod.metadata.name)}
                        className="w-full px-4 py-2 text-left hover:bg-slate-800/50 transition-colors flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn('w-2 h-2 rounded-full shrink-0',
                            podPhase === 'Running' && ready === total ? 'bg-green-500' :
                            podPhase === 'Failed' ? 'bg-red-500' : 'bg-yellow-500'
                          )} />
                          <span className="text-sm text-slate-200 truncate">{pod.metadata.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {waiting && <span className="text-xs text-yellow-400">{waiting.reason}</span>}
                          {restarts > 0 && <span className="text-xs text-slate-500">{restarts} restarts</span>}
                          <span className={cn('text-xs font-mono', ready === total ? 'text-green-400' : 'text-yellow-400')}>{ready}/{total}</span>
                          <span className={cn('text-xs px-1.5 py-0.5 rounded',
                            podPhase === 'Running' ? 'bg-green-900/50 text-green-300' :
                            podPhase === 'Failed' ? 'bg-red-900/50 text-red-300' :
                            'bg-yellow-900/50 text-yellow-300'
                          )}>{podPhase}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Incident Context — events, logs, metrics for pods/workloads */}
            {(resource.kind === 'Pod' || isWorkload) && namespace && (
              <IncidentContext resource={resource} managedPods={managedPods} events={sortedEvents} namespace={namespace} go={go} />
            )}

            {/* Deployment Rollback History */}
            {resource.kind === 'Deployment' && namespace && (
              <RollbackPanel resource={resource} namespace={namespace} />
            )}

            {/* Workload Health Audit (Deployment/StatefulSet/DaemonSet) */}
            {isWorkload && resource && <WorkloadAudit resource={resource} go={go} />}

            {/* AI Insight + Inline Agent for pods and workloads */}
            {(resource.kind === 'Pod' || isWorkload) && namespace && (
              <>
                <ErrorBoundary fallbackTitle="AI insight unavailable">
                  <Suspense fallback={
                    <div className="animate-pulse space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
                      <div className="h-4 w-32 bg-slate-800 rounded" />
                      <div className="h-3 w-full bg-slate-800 rounded" />
                      <div className="h-3 w-3/4 bg-slate-800 rounded" />
                    </div>
                  }>
                    <AmbientInsight
                      context={{ kind: resource.kind, name: resource.metadata.name, namespace }}
                      prompt={`Analyze this ${resource.kind} "${resource.metadata.name}" in namespace "${namespace}". If unhealthy, explain the root cause and give a specific fix command. If healthy, say so in one sentence. Do not list the resource name or namespace back to me.`}
                      trigger="manual"
                    />
                  </Suspense>
                </ErrorBoundary>
                <ErrorBoundary fallbackTitle="Inline agent unavailable">
                  <Suspense fallback={
                    <div className="animate-pulse space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
                      <div className="h-4 w-24 bg-slate-800 rounded" />
                      <div className="h-8 w-full bg-slate-800 rounded" />
                      <div className="flex gap-2">
                        <div className="h-6 w-28 bg-slate-800 rounded-full" />
                        <div className="h-6 w-28 bg-slate-800 rounded-full" />
                        <div className="h-6 w-28 bg-slate-800 rounded-full" />
                      </div>
                    </div>
                  }>
                    <InlineAgent
                      context={{ kind: resource.kind, name: resource.metadata.name, namespace, gvr: gvrKey }}
                      quickPrompts={[
                        `Why is this ${resource.kind} unhealthy?`,
                        `What changed recently?`,
                        `How can I optimize this?`,
                      ]}
                    />
                  </Suspense>
                </ErrorBoundary>
              </>
            )}

            {/* Quick event count for non-pod/workload resources */}
            {resource.kind !== 'Pod' && !isWorkload && sortedEvents.length > 0 && (
              <button
                onClick={() => setDetailTab('events')}
                className="w-full bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-200 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    {sortedEvents.length} Event{sortedEvents.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-blue-400">View →</span>
                </div>
              </button>
            )}
          </div>
        </div>
        )}
        </>
        )}
      </div>
    </div>

    {/* Delete Progress */}
    {showDeleteProgress && resource && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
        <div className="w-full max-w-2xl">
          <DeployProgress
            type={resource.kind === 'Job' ? 'job' : 'deployment'}
            name={resource.metadata.name}
            namespace={namespace || 'default'}
            mode="delete"
            onClose={() => {
              setShowDeleteProgress(false);
              go(`/r/${gvrUrl}`, resourcePlural);
            }}
          />
        </div>
      </div>
    )}

    {/* Add Label Dialog */}
    {showLabelDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-label="Add label">
        <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-md p-6">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Add Label</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const k = labelKey.trim();
              const v = labelValue.trim();
              if (!k) return;
              setActionLoading('label');
              try {
                await k8sPatch(apiPath, { metadata: { labels: { [k]: v } } });
                addToast({ type: 'success', title: `Label ${k}=${v} added` });
                queryClient.invalidateQueries({ queryKey: ['detail', apiPath] });
                setShowLabelDialog(false);
              } catch (err) {
                showErrorToast(err, 'Failed to add label');
              } finally {
                setActionLoading(null);
              }
            }}
          >
            <div className="space-y-3">
              <div>
                <label htmlFor="label-key" className="block text-xs text-slate-400 mb-1">Key</label>
                <input
                  id="label-key"
                  type="text"
                  value={labelKey}
                  onChange={(e) => setLabelKey(e.target.value)}
                  placeholder="e.g. app.kubernetes.io/name"
                  className="w-full px-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label htmlFor="label-value" className="block text-xs text-slate-400 mb-1">Value</label>
                <input
                  id="label-value"
                  type="text"
                  value={labelValue}
                  onChange={(e) => setLabelValue(e.target.value)}
                  placeholder="e.g. my-app"
                  className="w-full px-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowLabelDialog(false)}
                disabled={actionLoading === 'label'}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading === 'label' || !labelKey.trim()}
                className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading === 'label' ? 'Adding...' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    {/* Delete Confirmation */}
    {showDeleteConfirm && resource && (
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete ${resource.kind}`}
        description={`Are you sure you want to delete "${resource.metadata.name}"${resource.metadata.namespace ? ` from ${resource.metadata.namespace}` : ''}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />
    )}

    {/* Terminal — now opens in dock panel */}
    </>
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
    <Card>
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
    </Card>
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
