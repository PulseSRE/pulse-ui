import { useActiveClusterId } from '../hooks/useClusterBase';
import { k8sFetch, k8sGet } from '../engine/query';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FileX } from 'lucide-react';
import LogStream from '../components/logs/LogStream';
import MultiContainerLogs from '../components/logs/MultiContainerLogs';
import MultiPodLogs from '../components/logs/MultiPodLogs';
import { EmptyState } from '../components/primitives/EmptyState';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useFleetStore } from '../store/fleetStore';
import { LoadError } from '../components/primitives/LoadError';
import { SubpageHeader } from '../components/primitives/SubpageHeader';
import { ReadFailure, onCluster } from '../components/primitives/NotFound';
import { isNotFoundError } from '../engine/readError';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { gvrUrlForKind } from '../engine/gvr';
import { detailPath, kindInSentence, listPath } from '../engine/subpageLinks';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/primitives/Tabs';
import { TONE_CLASSES } from '../engine/statusColors';

/** Tab value for the merged view of every pod (DNS-1123 pod names cannot contain `_`). */
const ALL_PODS = '__all__';

interface LogsViewProps {
  namespace: string;
  podName: string;
}

interface ContainerInfo {
  name: string;
  type: 'container' | 'init' | 'ephemeral';
  state: 'running' | 'waiting' | 'terminated';
}

export default function LogsView({ namespace, podName }: LogsViewProps) {
  const [searchParams] = useSearchParams();
  const selector = searchParams.get('selector');
  const kind = searchParams.get('kind');

  // Build logs use the Build API, not pod logs
  if (kind === 'Build') {
    return <BuildLogsView namespace={namespace} buildName={podName} />;
  }

  // If we have a label selector, this is a deployment/workload-level log view
  if (selector && kind) {
    return <WorkloadLogsView namespace={namespace} name={podName} selector={selector} kind={kind} />;
  }

  return <PodLogsView namespace={namespace} podName={podName} />;
}

// --- Build logs (OpenShift Build API) ---
function BuildLogsView({ namespace, buildName }: { namespace: string; buildName: string }) {
  const clusterId = useActiveClusterId();
  const go = useNavigateTab();
  const { data: logText, isLoading, error, refetch } = useQuery({
    queryKey: ['build-log', namespace, buildName, clusterId],
    queryFn: async () => {
      const res = await k8sFetch(clusterId, `/apis/build.openshift.io/v1/namespaces/${namespace}/builds/${buildName}/log`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    },
    refetchInterval: 5000, // poll every 5s for running builds
  });

  return (
    <div className="h-full flex flex-col">
      <SubpageHeader
        subpage="Logs"
        resource={{ gvrUrl: 'build.openshift.io~v1~builds', kind: 'Build', namespace, name: buildName }}
        go={go}
        clusterId={clusterId}
        title={`Build logs: ${buildName}`}
      />
      <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs text-slate-300">
        {isLoading && <div className="text-slate-500">Loading build logs...</div>}
        {error && <LoadError title={`Could not load logs for build ${buildName}`} error={error} onRetry={() => { void refetch(); }} className="font-sans" />}
        {logText && <pre className="whitespace-pre-wrap">{logText}</pre>}
        {!isLoading && !error && !logText && <div className="text-slate-500">No logs available yet.</div>}
      </div>
    </div>
  );
}

// --- Workload (Deployment/StatefulSet) logs ---
function WorkloadLogsView({ namespace, name, selector, kind }: {
  namespace: string; name: string; selector: string; kind: string;
}) {
  const go = useNavigateTab();
  const clusterId = useActiveClusterId();
  const gvrUrl = gvrUrlForKind(kind);
  const parentPath = detailPath(gvrUrl, namespace, name);
  const [selectedPod, setSelectedPod] = useState<string | null>(null);

  // Watch pods by label selector
  const { data, isLoading, isError, error, refetch } = useK8sListWatch({
    apiPath: `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(selector)}`,
    clusterId,
  });
  const pods = data ?? [];

  const header = (meta?: React.ReactNode) => (
    <SubpageHeader subpage="Logs" resource={{ gvrUrl, kind, namespace, name }} go={go} clusterId={clusterId} meta={meta} />
  );

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {header()}
        <div className="flex-1 flex items-center justify-center" role="status" aria-label="Loading pods"><div className="kv-skeleton w-12 h-12 rounded-full" /></div>
      </div>
    );
  }

  // A failed or forbidden pod list is not "No pods found". Only when there is
  // no list at all does the error replace the view; a failed refresh of a list
  // already shown keeps the logs on screen with the error above them.
  if (isError && !data) {
    return (
      <div className="h-full flex flex-col">
        {header()}
        <div className="p-6">
          <LoadError title={`Could not list the pods of ${kind} ${name}`} error={error} onRetry={() => { void refetch(); }} />
        </div>
      </div>
    );
  }

  const podNames = pods.map((p: any) => p.metadata.name);

  return (
    <div className="h-full flex flex-col">
      {header(<span className="text-slate-400">{podNames.length} pod{podNames.length !== 1 ? 's' : ''}</span>)}

      {isError && (
        <LoadError
          className="m-2"
          title={`Could not refresh the pods of ${kind} ${name}; showing the last list`}
          error={error}
          onRetry={() => { void refetch(); }}
        />
      )}

      {/* Pod selector tabs */}
      <Tabs
        value={selectedPod ?? ALL_PODS}
        onValueChange={(v) => setSelectedPod(v === ALL_PODS ? null : v)}
        // Each pod tab opens a log stream; arrow keys move focus and Enter
        // selects, so walking the list does not open a stream per pod.
        activationMode="manual"
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList aria-label="Pod selector" className="flex rounded-none border-0 border-b border-slate-800 bg-slate-900/50 px-4 py-2 overflow-x-auto">
          <TabsTrigger value={ALL_PODS} className="py-1 rounded-sm font-normal">All Pods</TabsTrigger>
          {podNames.map((pn: string) => {
            const pod = pods.find((p: any) => p.metadata.name === pn);
            const phase = (pod?.status as { phase?: string } | undefined)?.phase || 'Unknown';
            const isRunning = phase === 'Running';
            return (
              <TabsTrigger key={pn} value={pn} className="py-1 rounded-sm font-normal" title={`${pn} (${phase})`}>
                <div className={cn('w-1.5 h-1.5 rounded-full', TONE_CLASSES[isRunning ? 'success' : 'warning'].solid)} />
                {pn.replace(`${name}-`, '').slice(0, 12)}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Log content */}
        <TabsContent value={selectedPod ?? ALL_PODS} className="flex-1 overflow-hidden">
          {selectedPod ? (
            <LogStream key={selectedPod} namespace={namespace} podName={selectedPod} clusterId={clusterId} />
          ) : podNames.length > 0 ? (
            <MultiPodLogs namespace={namespace} podNames={podNames} clusterId={clusterId} />
          ) : (
            <EmptyState
              icon={<FileX className="w-8 h-8" />}
              title="No pods found"
              description="No pods match the label selector for this workload. The workload may be scaled to zero, or the label selector may not match any running pods. Check the replica count and selector labels."
              action={{ label: `Back to ${kindInSentence(kind)} ${name}`, onClick: () => go(parentPath, name) }}
              className="h-full"
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Single pod logs ---
type ContainerStateLike = { name: string; state?: { running?: unknown; waiting?: unknown; terminated?: unknown } };

function stateOf(statuses: ContainerStateLike[], name: string): ContainerInfo['state'] {
  const status = statuses.find((s) => s.name === name);
  if (status?.state?.running) return 'running';
  if (status?.state?.terminated) return 'terminated';
  return 'waiting';
}

/** Every container a pod can have logs for: app, init and ephemeral (debug) containers. */
export function podLogContainers(pod: Record<string, any> | undefined): ContainerInfo[] {
  if (!pod) return [];
  const out: ContainerInfo[] = [];
  const groups: Array<[ContainerInfo['type'], Array<{ name: string }> | undefined, ContainerStateLike[] | undefined]> = [
    ['container', pod.spec?.containers, pod.status?.containerStatuses],
    ['init', pod.spec?.initContainers, pod.status?.initContainerStatuses],
    ['ephemeral', pod.spec?.ephemeralContainers, pod.status?.ephemeralContainerStatuses],
  ];
  for (const [type, specs, statuses] of groups) {
    for (const spec of specs || []) out.push({ name: spec.name, type, state: stateOf(statuses || [], spec.name) });
  }
  return out;
}

function PodLogsView({ namespace, podName }: { namespace: string; podName: string }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const go = useNavigateTab();
  const [previous, setPrevious] = useState(false);
  const { data: pod, isLoading, error, refetch } = useQuery({
    queryKey: ['pod', clusterId, namespace, podName],
    queryFn: () => k8sGet<Record<string, any>>(`/api/v1/namespaces/${namespace}/pods/${podName}`, clusterId),
  });

  const containers = podLogContainers(pod);
  const restarts = ((pod?.status?.containerStatuses || []) as Array<{ restartCount?: number }>).reduce((n, c) => n + (c.restartCount || 0), 0);

  const header = (actions?: React.ReactNode, missing = false) => (
    <SubpageHeader subpage="Logs" resource={{ gvrUrl: 'v1~pods', kind: 'Pod', namespace, name: podName }} go={go} clusterId={clusterId} actions={actions} missing={missing} />
  );

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {header()}
        <div className="flex-1 flex items-center justify-center" role="status" aria-label={`Loading pod ${podName}`}><div className="kv-skeleton w-12 h-12 rounded-full" /></div>
      </div>
    );
  }

  if (error) {
    const pods = listPath('v1~pods', namespace);
    return (
      <div className="h-full flex flex-col">
        {header(undefined, isNotFoundError(error))}
        <div className="p-6">
          <ReadFailure
            error={error}
            title={`Could not load pod ${podName}`}
            onRetry={() => { void refetch(); }}
            notFound={{
              what: `Pod ${podName}`,
              where: `${onCluster(clusterId)} in namespace ${namespace}`,
              reason: 'It may have been deleted, or replaced by a pod with a new name.',
              variant: 'inline',
              actions: [{ label: `Go to pods in ${namespace}`, href: pods, onClick: () => go(pods, `Pods (${namespace})`) }],
            }}
          />
        </div>
      </div>
    );
  }

  const previousToggle = (
    <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer" title="Logs from the container instance before its last restart">
      <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} className="rounded-sm border-slate-600" />
      Previous instance{restarts > 0 ? ` (${restarts} restart${restarts === 1 ? '' : 's'})` : ''}
    </label>
  );

  if (containers.length <= 1) {
    return (
      <div className="h-full flex flex-col">
        {header(previousToggle)}
        <div className="flex-1 overflow-hidden">
          <LogStream key={String(previous)} namespace={namespace} podName={podName} containerName={containers[0]?.name} previous={previous} clusterId={clusterId} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {header(previousToggle)}
      <div className="flex-1 overflow-hidden">
        <MultiContainerLogs namespace={namespace} podName={podName} containers={containers} previous={previous} clusterId={clusterId} />
      </div>
    </div>
  );
}
