import { useClusterBase } from '../hooks/useClusterBase';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FileX } from 'lucide-react';
import LogStream from '../components/logs/LogStream';
import MultiContainerLogs from '../components/logs/MultiContainerLogs';
import MultiPodLogs from '../components/logs/MultiPodLogs';
import { EmptyState } from '../components/primitives/EmptyState';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useFleetStore } from '../store/fleetStore';
import { k8sGet } from '../engine/query';
import { LoadError } from '../components/primitives/LoadError';

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
  const clusterBase = useClusterBase();
  const { data: logText, isLoading, error } = useQuery({
    queryKey: ['build-log', namespace, buildName],
    queryFn: async () => {
      const res = await fetch(`${clusterBase}/apis/build.openshift.io/v1/namespaces/${namespace}/builds/${buildName}/log`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    },
    refetchInterval: 5000, // poll every 5s for running builds
  });

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-2">
        <span className="text-sm text-slate-400">Build Logs</span>
        <span className="text-sm font-medium">{buildName}</span>
        <span className="text-xs px-2 py-0.5 bg-orange-900/50 text-orange-300 rounded-sm">Build</span>
        <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-sm text-slate-300">{namespace}</span>
      </div>
      <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs text-slate-300">
        {isLoading && <div className="text-slate-500">Loading build logs...</div>}
        {error && <div className="text-red-400">Failed to load build logs: {error instanceof Error ? error.message : String(error)}</div>}
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
  const navigate = useNavigate();
  const [selectedPod, setSelectedPod] = useState<string | null>(null);

  // Watch pods by label selector
  const { data: pods = [], isLoading } = useK8sListWatch({
    apiPath: `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(selector)}`,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="kv-skeleton w-12 h-12 rounded-full" /></div>;
  }

  const podNames = pods.map((p: any) => p.metadata.name);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-2 flex-wrap">
        <span className="text-sm text-slate-400">Logs</span>
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded-sm">{kind}</span>
        <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-sm text-slate-300">{namespace}</span>
        <span className="text-xs text-slate-500 ml-auto">{podNames.length} pod{podNames.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Pod selector tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-800 overflow-x-auto bg-slate-900/50" role="tablist" aria-label="Pod selector">
        <button
          role="tab"
          aria-selected={!selectedPod}
          onClick={() => setSelectedPod(null)}
          className={cn('px-3 py-1 text-xs rounded-sm whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500', !selectedPod ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}
        >
          All Pods
        </button>
        {podNames.map((pn: string) => {
          const pod = pods.find((p: any) => p.metadata.name === pn);
          const phase = (pod?.status as { phase?: string } | undefined)?.phase || 'Unknown';
          const isRunning = phase === 'Running';
          return (
            <button
              key={pn}
              role="tab"
              aria-selected={selectedPod === pn}
              onClick={() => setSelectedPod(pn)}
              className={cn('px-3 py-1 text-xs rounded-sm whitespace-nowrap flex items-center gap-1.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500',
                selectedPod === pn ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <div className={cn('w-1.5 h-1.5 rounded-full', isRunning ? 'bg-green-500' : 'bg-yellow-500')} />
              {pn.replace(`${name}-`, '').slice(0, 12)}
            </button>
          );
        })}
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-hidden">
        {selectedPod ? (
          <LogStream key={selectedPod} namespace={namespace} podName={selectedPod} />
        ) : podNames.length > 0 ? (
          <MultiPodLogs namespace={namespace} podNames={podNames} />
        ) : (
          <EmptyState
            icon={<FileX className="w-8 h-8" />}
            title="No pods found"
            description="No pods match the label selector for this workload. The workload may be scaled to zero, or the label selector may not match any running pods. Check the replica count and selector labels."
            action={{ label: 'Back to workload', onClick: () => navigate(-1) }}
            className="h-full"
          />
        )}
      </div>
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
  const [previous, setPrevious] = useState(false);
  const { data: pod, isLoading, error, refetch } = useQuery({
    queryKey: ['pod', clusterId, namespace, podName],
    queryFn: () => k8sGet<Record<string, any>>(`/api/v1/namespaces/${namespace}/pods/${podName}`, clusterId),
  });

  const containers = podLogContainers(pod);
  const restarts = ((pod?.status?.containerStatuses || []) as Array<{ restartCount?: number }>).reduce((n, c) => n + (c.restartCount || 0), 0);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="kv-skeleton w-12 h-12 rounded-full" /></div>;
  }

  if (error) {
    return <div className="p-6"><LoadError title={`Could not load pod ${podName}`} error={error} onRetry={() => refetch()} /></div>;
  }

  const previousToggle = (
    <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer" title="Logs from the container instance before its last restart">
      <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} className="rounded-sm border-slate-600" />
      Previous instance{restarts > 0 ? ` (${restarts} restart${restarts === 1 ? '' : 's'})` : ''}
    </label>
  );

  if (containers.length <= 1) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-2">
          <span className="text-sm text-slate-400">Logs</span>
          <span className="text-sm font-medium">{podName}</span>
          <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-sm text-slate-300">{namespace}</span>
          {previousToggle}
        </div>
        <div className="flex-1 overflow-hidden">
          <LogStream key={String(previous)} namespace={namespace} podName={podName} containerName={containers[0]?.name} previous={previous} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-1.5 border-b border-slate-700 flex items-center">{previousToggle}</div>
      <div className="flex-1 overflow-hidden">
        <MultiContainerLogs namespace={namespace} podName={podName} containers={containers} previous={previous} />
      </div>
    </div>
  );
}
