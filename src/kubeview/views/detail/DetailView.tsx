import { useFleetStore } from '../../store/fleetStore';
import { isTopologyKind, topologyFocusPath } from '../../engine/topologyLinks';
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { k8sGet, k8sDelete, k8sPatch, k8sCreate, k8sList } from '../../engine/query';
import { terminalTargets, defaultTerminalTarget } from '../../engine/terminalTargets';
import { pickDefaultContainer } from '../../components/logs/pickDefaultContainer';
import { useActionDialog } from '../../components/ActionDialog';
import {
  NODE_DEBUG_NAMESPACE, NODE_DEBUG_IMAGE, NODE_DEBUG_DEADLINE_SECONDS, NODE_DEBUG_NODE_LABEL, POD_DEBUG_IMAGE,
  nodeDebugPodName, buildNodeDebugPod, buildEphemeralDebugPatch, validateImageRef,
} from '../../engine/debugPods';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { getActiveClusterId, LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import type { K8sResource } from '../../engine/renderers';
import type { Deployment, Pod, Event, Condition } from '../../engine/types';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
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
import { DetailViewTabBar, ConditionsTable, EventsList, DETAIL_TABS, type DetailTab } from './DetailViewTabs';
import { Tabs, TabsContent, useTabParam } from '../../components/primitives/Tabs';
import { DeploymentDetailLayout } from './DeploymentDetailLayout';
import { PodDetailLayout } from './PodDetailLayout';
import { GenericDetailLayout } from './GenericDetailLayout';
import { DeleteConfirmModal, DeleteProgressModal } from './DetailViewModals';
import { isWorkloadKind } from './workloadKinds';
import { DeleteRelatedDialog } from '../../components/workloads/DeleteRelatedDialog';
import { DELETE_WITH_RELATED_KINDS } from '../../components/workloads/WorkloadActionMenu';
import { ownerLink } from '../../engine/ownerRef';
import type { MetadataTarget } from './MetadataSections';

interface DetailViewProps {
  gvrKey: string;
  namespace?: string;
  name: string;
}

export default function DetailView({ gvrKey, namespace, name }: DetailViewProps) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const navigate = useNavigate();
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const setDockContext = useUIStore((s) => s.setDockContext);

  // Build GVR URL segment for navigation
  const gvrUrl = gvrKey.replace(/\//g, '~');
  const gvrParts = gvrKey.split('/');
  const resourcePlural = gvrParts[gvrParts.length - 1];
  const resourceGroup = gvrParts.length === 3 ? gvrParts[0] : '';

  // RBAC permission checks
  const { allowed: canDelete } = useCanI('delete', resourceGroup, resourcePlural, namespace);
  // Debug on a node creates a pod in NODE_DEBUG_NAMESPACE; on a pod it patches
  // the pod's ephemeralcontainers subresource. Offer it only when allowed.
  const isNodeRoute = resourceGroup === '' && resourcePlural === 'nodes';
  const isPodRoute = resourceGroup === '' && resourcePlural === 'pods';
  const { allowed: canCreateNodeDebug } = useCanI('create', '', 'pods', NODE_DEBUG_NAMESPACE, undefined, { enabled: isNodeRoute });
  const { allowed: canPodDebug } = useCanI('patch', '', 'pods', namespace, 'ephemeralcontainers', { enabled: isPodRoute && !!namespace });
  const debugDenied = isNodeRoute
    ? (canCreateNodeDebug ? undefined : `You do not have permission to create pods in ${NODE_DEBUG_NAMESPACE}`)
    : isPodRoute
      ? (canPodDebug ? undefined : 'You do not have permission to add debug containers to this pod')
      : undefined;

  // Build API path for this specific resource
  const apiPath = React.useMemo(
    () => buildApiPath(gvrKey, namespace, name),
    [gvrKey, namespace, name]
  );
  const metaTarget: MetadataTarget = React.useMemo(
    () => ({ apiPath, group: resourceGroup, plural: resourcePlural }),
    [apiPath, resourceGroup, resourcePlural],
  );


  // Fetch the resource
  const { data: resource, isLoading, error } = useQuery<K8sResource>({
    queryKey: ['detail', apiPath, clusterId],
    queryFn: () => k8sGet<K8sResource>(apiPath, clusterId),
    refetchInterval: 30000,
  });

  // Fetch managed pods for workloads. Jobs and CronJobs are workloads too, so
  // their pods, logs and events show here like a Deployment's.
  const isWorkload = isWorkloadKind(resource?.kind);
  const isCronJob = resource?.kind === 'CronJob';
  const selectorLabels = (resource?.spec as Deployment['spec'])?.selector?.matchLabels as Record<string, string> | undefined;
  // A CronJob has no selector: its pods are those of the Jobs it created.
  const { data: namespaceJobs } = useK8sListWatch<K8sResource>({
    apiPath: '/apis/batch/v1/jobs',
    namespace,
    enabled: !!resource && isCronJob && !!namespace,
  });
  const ownedJobNames = React.useMemo(() => {
    if (!isCronJob || !namespaceJobs || !resource) return [] as string[];
    return namespaceJobs
      .filter((j) => j.metadata.ownerReferences?.some((o) => o.kind === 'CronJob' && (resource.metadata.uid ? o.uid === resource.metadata.uid : o.name === name)))
      .map((j) => j.metadata.name)
      .sort();
  }, [isCronJob, namespaceJobs, resource, name]);
  const ownedJobKey = ownedJobNames.join(',');
  const podsApiPath = React.useMemo(() => {
    if (!namespace) return '';
    let labelSelector = '';
    if (isCronJob) {
      if (!ownedJobKey) return '';
      labelSelector = `job-name in (${ownedJobKey})`;
    } else {
      if (!selectorLabels) return '';
      labelSelector = Object.entries(selectorLabels).map(([k, v]) => `${k}=${v}`).join(',');
    }
    return `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(labelSelector)}`;
  }, [selectorLabels, namespace, isCronJob, ownedJobKey]);

  const { data: managedPods = [] } = useK8sListWatch<K8sResource>({
    apiPath: podsApiPath,
    enabled: !!resource && isWorkload && !!namespace && !!podsApiPath,
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
    const jobNames = new Set(ownedJobNames);
    const filtered = isWorkload
      ? rawEvents.filter((ev) => {
          const objName = ev.involvedObject?.name || '';
          const objKind = ev.involvedObject?.kind || '';
          if (objName === name) return true;
          if (objKind === 'Pod' && managedPodNames.has(objName)) return true;
          if (objKind === 'ReplicaSet' && objName.startsWith(`${name}-`)) return true;
          if (objKind === 'Job' && jobNames.has(objName)) return true;
          return false;
        })
      : rawEvents;
    return filtered.sort((a, b) => {
      const aTime = a.lastTimestamp || a.firstTimestamp || '';
      const bTime = b.lastTimestamp || b.firstTimestamp || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [rawEvents, name, isWorkload, managedPods, ownedJobNames]);

  // Find related resources
  const resourceRegistry = useClusterStore((s) => s.resourceRegistry);
  const relatedResources = React.useMemo(() => {
    if (!resource) return [];
    const related: Array<{ type: string; name: string; path: string }> = [];
    const ownerRefs = resource.metadata.ownerReferences || [];
    for (const owner of ownerRefs) {
      const link = ownerLink(owner, namespace || '');
      related.push({ type: owner.kind, name: owner.name, path: link.path });
    }
    return related;
  }, [resource, namespace, resourceRegistry]);

  // ── Action handlers ──────────────────────────────────

  const handleDelete = async () => {
    if (!resource) return;
    setDeleting(true);
    try {
      const pinned = deleteClusterId ?? clusterId;
      assertActiveCluster(pinned, `Deleting ${resource.kind} "${resource.metadata.name}"`);
      await k8sDelete(apiPath, pinned, { uid: resource?.metadata.uid, resourceVersion: resource?.metadata.resourceVersion });
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
    if (isCronJob) {
      // No selector of its own: open the newest run's pod.
      const newest = [...managedPods].sort((a, b) => new Date(b.metadata.creationTimestamp || 0).getTime() - new Date(a.metadata.creationTimestamp || 0).getTime())[0];
      if (!newest) {
        addToast({ type: 'warning', title: 'No pods to show logs for', detail: 'This CronJob has no runs with pods left. Pods are removed with their Job.' });
        return;
      }
      go(`/logs/${namespace}/${newest.metadata.name}`, `${newest.metadata.name} (Logs)`);
    } else if (isWorkload) {
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

  // Debug writes to the cluster (a privileged pod, or a container added to a
  // running pod), so it asks first and says exactly what it will create.
  const { open: openAction, dialog: actionDialog } = useActionDialog();
  const handleDebug = () => {
    if (!resource || debugDenied) return;
    if (resource.kind === 'Node') {
      const node = resource.metadata.name;
      const debugName = nodeDebugPodName(node);
      openAction({
        title: `Start a privileged debug pod on node "${node}"?`,
        description: `This creates pod "${debugName}" in namespace "${NODE_DEBUG_NAMESPACE}", scheduled onto ${node}.`,
        confirmLabel: 'Create debug pod',
        variant: 'danger',
        what: 'The debug pod',
        body: (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-300">
            <li>Image <span className="font-mono">{NODE_DEBUG_IMAGE}</span></li>
            <li>Privileged container, sharing the node&apos;s process IDs (hostPID) and network (hostNetwork)</li>
            <li>The node&apos;s whole filesystem mounted read-write at <span className="font-mono">/host</span></li>
            <li>Stopped by Kubernetes after {NODE_DEBUG_DEADLINE_SECONDS / 60} minutes (activeDeadlineSeconds). &quot;End session&quot; in the terminal deletes it sooner.</li>
          </ul>
        ),
        run: (cid) => k8sCreate(`/api/v1/namespaces/${NODE_DEBUG_NAMESPACE}/pods`, buildNodeDebugPod(node, debugName), cid),
        success: `Debug pod created: ${debugName}`,
        successDetail: `Host filesystem at /host (chroot /host). It stops after ${NODE_DEBUG_DEADLINE_SECONDS / 60} minutes; End session in the terminal deletes it.`,
        onDone: () => useUIStore.getState().openTerminal({
          clusterId,
          namespace: NODE_DEBUG_NAMESPACE,
          podName: debugName,
          containerName: 'debug',
          isNode: true,
        }),
      });
    } else if (resource.kind === 'Pod' && namespace) {
      const podName = resource.metadata.name;
      const debugContainerName = `debug-${Date.now().toString(36).slice(-6)}`;
      // Share the app container's process namespace, not a sidecar's.
      const target = pickDefaultContainer(((resource.spec as Pod['spec'])?.containers ?? []).map((c) => c.name));
      openAction({
        title: `Add a debug container to pod "${podName}"?`,
        description: `This adds ephemeral container "${debugContainerName}" to ${namespace}/${podName}${target ? `, sharing the process namespace of "${target}"` : ''}. Ephemeral containers cannot be removed; the container stays in the pod spec until the pod is deleted.`,
        confirmLabel: 'Add debug container',
        what: 'The debug container',
        inputs: [{ id: 'image', label: 'Image (the node must be able to pull it)', initial: POD_DEBUG_IMAGE, validate: validateImageRef }],
        run: (cid, values) => k8sPatch(
          `/api/v1/namespaces/${namespace}/pods/${podName}/ephemeralcontainers`,
          buildEphemeralDebugPatch(resource as Pod, debugContainerName, values.image.trim(), target),
          'application/strategic-merge-patch+json',
          cid,
        ),
        success: `Debug container "${debugContainerName}" added`,
        successDetail: 'Shares process namespace with the target container. Connect via terminal.',
        // Refetch this pod (key ['detail', apiPath, clusterId]) so the new
        // ephemeral container shows up and the terminal can pick it.
        onDone: () => { void queryClient.invalidateQueries({ queryKey: ['detail', apiPath] }); },
      });
    }
  };

  const handleOpenTerminal = async () => {
    if (!resource) return;
    if (resource.kind === 'Node') {
      // A node has no shell of its own. The terminal used to exec into a pod
      // named after the node in "default", which does not exist. Attach to the
      // node's running debug pod instead, if Debug has created one.
      try {
        const pods = await k8sList<Pod>(
          `/api/v1/namespaces/${NODE_DEBUG_NAMESPACE}/pods?labelSelector=${encodeURIComponent(`${NODE_DEBUG_NODE_LABEL}=${resource.metadata.name}`)}`,
          undefined,
          clusterId,
        );
        const live = pods.find((p) => p.status?.phase === 'Running');
        if (!live) {
          addToast({
            type: 'warning',
            title: 'No debug pod on this node',
            detail: 'Use Debug to start a privileged debug pod on the node, then open the terminal.',
          });
          return;
        }
        useUIStore.getState().openTerminal({
          clusterId,
          namespace: NODE_DEBUG_NAMESPACE,
          podName: live.metadata.name,
          containerName: 'debug',
          isNode: true,
        });
      } catch (err) {
        showErrorToast(err, 'Could not look for a debug pod');
      }
      return;
    }
    const targets = terminalTargets(resource as Pod);
    useUIStore.getState().openTerminal({
      clusterId,
      namespace: namespace || '',
      podName: name,
      containerName: defaultTerminalTarget(targets),
      containers: targets,
    });
  };

  // ── UI state ─────────────────────────────────────────

  const [detailTab, setDetailTab] = useTabParam(DETAIL_TABS, 'overview');
  const currentPath = namespace ? `/r/${gvrUrl}/${namespace}/${name}` : `/r/${gvrUrl}/_/${name}`;
  const [starred, setStarred] = React.useState(() => isFavorite(currentPath));
  // The cluster is pinned when the delete confirmation opens.
  const [deleteClusterId, setDeleteClusterId] = React.useState<string | null>(null);
  const showDeleteConfirm = deleteClusterId !== null;
  const setShowDeleteConfirm = (show: boolean) => setDeleteClusterId(show ? getActiveClusterId() : null);
  const [showDeleteProgress, setShowDeleteProgress] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
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
          actionLoading={null}
          debugDisabledReason={debugDenied}
          isWorkload={isWorkload}
          canDelete={canDelete}
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
          onViewYaml={handleViewYaml}
          onViewMetrics={handleViewMetrics}
          depsUnavailable={clusterId !== LOCAL_CLUSTER_ID
            ? 'The dependency graph comes from the Pulse agent, which watches the local cluster only.'
            : undefined}
          onViewDeps={() => (isTopologyKind(resource.kind)
            ? go(topologyFocusPath(resource.kind, namespace, name), 'Topology')
            : addToast({ type: 'warning', title: `The dependency graph does not track ${resource.kind}`, detail: 'Topology covers workloads, pods, services, routes, ingresses, volumes, config and RBAC service accounts.' }))}
          onViewNodeLogs={resource.kind === 'Node' ? () => go(`/node-logs/${name}`, `${name} (Logs)`) : undefined}
          onOpenProject={() => go(`/project/${encodeURIComponent(name)}`, `Project ${name}`)}
          onDeleteRequest={() => setShowDeleteConfirm(true)}
        />

        <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as DetailTab)} className="space-y-6">
        <DetailViewTabBar
          conditions={conditions}
          eventCount={sortedEvents.length}
        />

        <TabsContent value="conditions"><ConditionsTable conditions={conditions} /></TabsContent>
        <TabsContent value="events"><EventsList events={sortedEvents} /></TabsContent>

        <TabsContent value="overview" className="space-y-6">
          <>
            <GitOpsInfoCard kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} />
            <ResourceHistoryPanel kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} />

            {resource.kind === 'Deployment' && namespace && (
              <DeploymentDetailLayout
                resource={resource}
                namespace={namespace}
                managedPods={managedPods}
                events={sortedEvents}
                metaTarget={metaTarget}
                go={go}
              />
            )}

            {resource.kind === 'Pod' && namespace && (
              <PodDetailLayout
                resource={resource}
                namespace={namespace}
                events={sortedEvents}
                relatedResources={relatedResources}
                metaTarget={metaTarget}
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
                metaTarget={metaTarget}
                onSwitchToEvents={() => setDetailTab('events')}
                go={go}
              />
            )) as React.ReactNode}
          </>
        </TabsContent>
        </Tabs>
      </div>
    </div>

    {showDeleteProgress && resource && (
      <DeleteProgressModal
        resource={resource}
        namespace={namespace}
        apiPath={apiPath}
        onClose={() => {
          setShowDeleteProgress(false);
          go(`/r/${gvrUrl}`, resourcePlural);
        }}
      />
    )}

    {actionDialog}

    {showDeleteConfirm && resource && DELETE_WITH_RELATED_KINDS.has(resource.kind) && namespace && (
      <DeleteRelatedDialog
        workload={resource}
        workloadRbac={{ group: resourceGroup, plural: resourcePlural }}
        onClose={() => setShowDeleteConfirm(false)}
        onDeleted={() => go(`/r/${gvrUrl}`, resourcePlural)}
      />
    )}

    {showDeleteConfirm && resource && !(DELETE_WITH_RELATED_KINDS.has(resource.kind) && namespace) && (
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
