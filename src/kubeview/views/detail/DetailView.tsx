import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { k8sGet, k8sDelete, k8sPatch, k8sCreate } from '../../engine/query';
import type { K8sResource } from '../../engine/renderers';
import type { Deployment, Pod, Event, Container, Condition } from '../../engine/types';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { kindToPlural } from '../../engine/renderers/index';
import { buildApiPath } from '../../hooks/useResourceUrl';
import { useUIStore } from '../../store/uiStore';
import { useClusterStore } from '../../store/clusterStore';
import { toggleFavorite, isFavorite } from '../../engine/favorites';
import { showErrorToast } from '../../engine/errorToast';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { useCanI } from '../../hooks/useCanI';
import { GitOpsInfoCard } from '../../components/GitOpsInfoCard';
import { ResourceHistoryPanel } from '../argocd/ResourceHistoryPanel';

import { DetailViewHeader } from './DetailViewHeader';
import { DetailViewTabBar, ConditionsTable, EventsList } from './DetailViewTabs';
import { DeploymentDetailLayout } from './DeploymentDetailLayout';
import { PodDetailLayout } from './PodDetailLayout';
import { GenericDetailLayout } from './GenericDetailLayout';
import { DeleteConfirmModal, DeleteProgressModal, AddLabelDialog } from './DetailViewModals';

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

  // Build list API path for cache invalidation
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

  // Fetch managed pods for workloads
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

  // Set dock context for logs tab
  React.useEffect(() => {
    if (resource?.kind === 'Pod' && namespace) {
      setDockContext({ namespace, podName: name });
    } else if (isWorkload && managedPods.length > 0 && namespace) {
      setDockContext({ namespace, podName: managedPods[0].metadata.name });
    }
    return () => setDockContext(null);
  }, [resource?.kind, namespace, name, isWorkload, managedPods.length > 0 ? managedPods[0]?.metadata?.name : null]);

  // Fetch related events
  const eventsApiPath = React.useMemo(() => {
    if (!resource) return '';
    if (isWorkload && namespace) {
      return `/api/v1/namespaces/${namespace}/events`;
    }
    const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${resource.kind}`;
    return namespace
      ? `/api/v1/namespaces/${namespace}/events?fieldSelector=${encodeURIComponent(fieldSelector)}`
      : `/api/v1/events?fieldSelector=${encodeURIComponent(fieldSelector)}`;
  }, [resource, name, namespace, isWorkload]);

  const { data: rawEvents = [] } = useK8sListWatch<Event>({
    apiPath: eventsApiPath,
    enabled: !!resource && !!eventsApiPath,
  });

  // Filter and sort events
  const sortedEvents = React.useMemo(() => {
    const managedPodNames = new Set(managedPods.map(p => p.metadata.name));
    const filtered = isWorkload
      ? rawEvents.filter((ev) => {
          const objName = ev.involvedObject?.name || '';
          const objKind = ev.involvedObject?.kind || '';
          if (objName === name) return true;
          if (objKind === 'Pod' && managedPodNames.has(objName)) return true;
          if (objKind === 'ReplicaSet' && objName.startsWith(`${name}-`)) return true;
          return false;
        })
      : rawEvents;
    return filtered.sort((a, b) => {
      const aTime = a.lastTimestamp || a.firstTimestamp || '';
      const bTime = b.lastTimestamp || b.firstTimestamp || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [rawEvents, name, isWorkload, managedPods]);

  // Find related resources
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const relatedResources = React.useMemo(() => {
    if (!resource) return [];
    const related: Array<{ type: string; name: string; path: string }> = [];
    const ownerRefs = resource.metadata.ownerReferences || [];
    for (const owner of ownerRefs) {
      const [ownerGroup, ownerVersion] = owner.apiVersion.includes('/')
        ? owner.apiVersion.split('/')
        : ['', owner.apiVersion];
      const ownerPlural = kindToPlural(owner.kind);
      const ownerGvr = ownerGroup
        ? `${ownerGroup}~${ownerVersion}~${ownerPlural}`
        : `${ownerVersion}~${ownerPlural}`;
      const ownerGvrKey = ownerGroup
        ? `${ownerGroup}/${ownerVersion}/${ownerPlural}`
        : `${ownerVersion}/${ownerPlural}`;
      const ownerType = resourceRegistry?.get(ownerGvrKey)
        ?? (ownerGvrKey.split('/').length === 2 ? resourceRegistry?.get(`core/${ownerGvrKey}`) : undefined);
      const ownerNamespaced = ownerType?.namespaced ?? true;
      const ns = ownerNamespaced ? (namespace || '_') : '_';
      related.push({
        type: owner.kind,
        name: owner.name,
        path: `/r/${ownerGvr}/${ns}/${owner.name}`,
      });
    }
    return related;
  }, [resource, namespace, resourceRegistry]);

  // ── Action handlers ──────────────────────────────────

  const handleDelete = async () => {
    if (!resource) return;
    setDeleting(true);
    try {
      await k8sDelete(apiPath);
      queryClient.setQueriesData({ queryKey: ['k8s', 'list'] }, (old: unknown) => {
        if (!old || !Array.isArray(old)) return old;
        return old.filter((r: K8sResource) => r.metadata?.uid !== resource.metadata.uid);
      });
      setShowDeleteConfirm(false);
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
        useUIStore.getState().openTerminal({
          namespace: 'default',
          podName: debugName,
          containerName: 'debug',
          isNode: false,
        });
      } else if (resource.kind === 'Pod' && namespace) {
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

  const handleOpenTerminal = () => {
    if (!resource) return;
    const spec = (resource.spec as Record<string, unknown>) || {};
    const containerName = resource.kind === 'Pod'
      ? (spec.containers as Container[] | undefined)?.[0]?.name || ''
      : '';
    useUIStore.getState().openTerminal({
      namespace: resource.kind === 'Node' ? 'default' : namespace || '',
      podName: name,
      containerName,
      isNode: resource.kind === 'Node',
    });
  };

  // ── UI state ─────────────────────────────────────────

  const isScalable = resource?.kind === 'Deployment' || resource?.kind === 'StatefulSet' || resource?.kind === 'ReplicaSet';
  const isRestartable = resource?.kind === 'Deployment';
  const [detailTab, setDetailTab] = React.useState<'overview' | 'conditions' | 'events'>('overview');
  const currentPath = namespace ? `/r/${gvrUrl}/${namespace}/${name}` : `/r/${gvrUrl}/_/${name}`;
  const [starred, setStarred] = React.useState(() => isFavorite(currentPath));
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showDeleteProgress, setShowDeleteProgress] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [showLabelDialog, setShowLabelDialog] = React.useState(false);
  const [labelKey, setLabelKey] = React.useState('');
  const [labelValue, setLabelValue] = React.useState('');

  const handleOpenLabelDialog = React.useCallback(() => {
    setLabelKey('');
    setLabelValue('');
    setShowLabelDialog(true);
  }, []);

  const handleAddLabelSubmit = async (e: React.FormEvent) => {
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
  };

  // ── Error state ──────────────────────────────────────

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

  // ── Loading state ────────────────────────────────────

  if (isLoading || !resource) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-800 rounded-sm" />
            <div className="h-6 bg-slate-800 rounded-sm w-48" />
            <div className="h-5 bg-slate-800 rounded-sm w-20" />
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

  // ── Derived values for rendering ─────────────────────

  const status = (resource.status as Record<string, unknown>) || {};
  const conditions = (status.conditions || []) as Condition[];

  // ── Render ───────────────────────────────────────────

  return (
    <>
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <DetailViewHeader
          resource={resource}
          namespace={namespace}
          name={name}
          gvrUrl={gvrUrl}
          resourcePlural={resourcePlural}
          starred={starred}
          currentPath={currentPath}
          actionLoading={actionLoading}
          isWorkload={isWorkload}
          isScalable={isScalable}
          isRestartable={isRestartable}
          canDelete={canDelete}
          canUpdate={canUpdate}
          onNavigateBack={() => navigate(-1)}
          onGoToList={() => go(`/r/${gvrUrl}`, resourcePlural)}
          onGoToListFiltered={() => go(`/r/${gvrUrl}?ns=${namespace}`, `${resourcePlural} (${namespace})`)}
          onCopyName={() => { navigator.clipboard.writeText(resource.metadata.name); addToast({ type: 'success', title: 'Name copied' }); }}
          onToggleFavorite={() => {
            const isNow = toggleFavorite({ path: currentPath, title: resource.metadata.name, kind: resource.kind, namespace: resource.metadata.namespace });
            setStarred(isNow);
            addToast({ type: 'success', title: isNow ? 'Added to favorites' : 'Removed from favorites' });
          }}
          onViewLogs={handleViewLogs}
          onOpenTerminal={handleOpenTerminal}
          onDebug={handleDebug}
          onScale={handleScale}
          onRestart={handleRestart}
          onViewYaml={handleViewYaml}
          onViewMetrics={handleViewMetrics}
          onViewDeps={() => go(`/deps/${gvrUrl}/${namespace}/${name}`, `${name} (Deps)`)}
          onViewNodeLogs={resource.kind === 'Node' ? () => go(`/node-logs/${name}`, `${name} (Logs)`) : undefined}
          onDeleteRequest={() => setShowDeleteConfirm(true)}
        />

        <DetailViewTabBar
          activeTab={detailTab}
          onTabChange={setDetailTab}
          conditions={conditions}
          eventCount={sortedEvents.length}
        />

        {detailTab === 'conditions' && <ConditionsTable conditions={conditions} />}
        {detailTab === 'events' && <EventsList events={sortedEvents} />}

        {detailTab === 'overview' && (
          <>
            <GitOpsInfoCard kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} />
            <ResourceHistoryPanel kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} />

            {resource.kind === 'Deployment' && namespace && (
              <DeploymentDetailLayout
                resource={resource}
                namespace={namespace}
                managedPods={managedPods}
                events={sortedEvents}
                actionLoading={actionLoading}
                onAddLabel={handleOpenLabelDialog}
                go={go}
              />
            )}

            {resource.kind === 'Pod' && namespace && (
              <PodDetailLayout
                resource={resource}
                namespace={namespace}
                events={sortedEvents}
                actionLoading={actionLoading}
                relatedResources={relatedResources}
                onAddLabel={handleOpenLabelDialog}
                go={go}
              />
            )}

            {((resource.kind !== 'Deployment' || !namespace) && (resource.kind !== 'Pod' || !namespace) && (
              <GenericDetailLayout
                resource={resource}
                namespace={namespace}
                gvrKey={gvrKey}
                apiPath={apiPath}
                events={sortedEvents}
                managedPods={managedPods}
                relatedResources={relatedResources}
                isWorkload={isWorkload}
                actionLoading={actionLoading}
                onAddLabel={handleOpenLabelDialog}
                onSwitchToEvents={() => setDetailTab('events')}
                go={go}
              />
            )) as React.ReactNode}
          </>
        )}
      </div>
    </div>

    {showDeleteProgress && resource && (
      <DeleteProgressModal
        resource={resource}
        namespace={namespace}
        onClose={() => {
          setShowDeleteProgress(false);
          go(`/r/${gvrUrl}`, resourcePlural);
        }}
      />
    )}

    <AddLabelDialog
      open={showLabelDialog}
      labelKey={labelKey}
      labelValue={labelValue}
      actionLoading={actionLoading}
      onLabelKeyChange={setLabelKey}
      onLabelValueChange={setLabelValue}
      onSubmit={handleAddLabelSubmit}
      onClose={() => setShowLabelDialog(false)}
    />

    {showDeleteConfirm && resource && (
      <DeleteConfirmModal
        open={showDeleteConfirm}
        resource={resource}
        deleting={deleting}
        onConfirm={handleDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />
    )}
    </>
  );
}
