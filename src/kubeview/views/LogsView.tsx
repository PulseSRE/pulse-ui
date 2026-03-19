import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import LogStream from '../components/logs/LogStream';
import MultiContainerLogs from '../components/logs/MultiContainerLogs';
import MultiPodLogs from '../components/logs/MultiPodLogs';
import { useK8sListWatch } from '../hooks/useK8sListWatch';

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

  // If we have a label selector, this is a deployment/workload-level log view
  if (selector && kind) {
    return <WorkloadLogsView namespace={namespace} name={podName} selector={selector} kind={kind} />;
  }

  return <PodLogsView namespace={namespace} podName={podName} />;
}

// --- Workload (Deployment/StatefulSet) logs ---
function WorkloadLogsView({ namespace, name, selector, kind }: {
  namespace: string; name: string; selector: string; kind: string;
}) {
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
        <span className="text-xs px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded">{kind}</span>
        <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-300">{namespace}</span>
        <span className="text-xs text-slate-500 ml-auto">{podNames.length} pod{podNames.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Pod selector tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-800 overflow-x-auto bg-slate-900/50">
        <button
          onClick={() => setSelectedPod(null)}
          className={cn('px-3 py-1 text-xs rounded whitespace-nowrap', !selectedPod ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}
        >
          All Pods
        </button>
        {podNames.map((pn: string) => {
          const pod = pods.find((p: any) => p.metadata.name === pn);
          const phase = pod?.status?.phase || 'Unknown';
          const isRunning = phase === 'Running';
          return (
            <button
              key={pn}
              onClick={() => setSelectedPod(pn)}
              className={cn('px-3 py-1 text-xs rounded whitespace-nowrap flex items-center gap-1.5',
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
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">No pods found</div>
        )}
      </div>
    </div>
  );
}

// --- Single pod logs ---
function PodLogsView({ namespace, podName }: { namespace: string; podName: string }) {
  const { data: pod, isLoading, error } = useQuery({
    queryKey: ['pod', namespace, podName],
    queryFn: async () => {
      const res = await fetch(`/api/kubernetes/api/v1/namespaces/${namespace}/pods/${podName}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
  });

  const containers: ContainerInfo[] = [];

  if (pod) {
    const specs = (pod.spec?.containers || []) as Array<{ name: string }>;
    const statuses = (pod.status?.containerStatuses || []) as Array<{
      name: string;
      state?: { running?: unknown; waiting?: unknown; terminated?: unknown };
    }>;

    for (const spec of specs) {
      const status = statuses.find((s) => s.name === spec.name);
      let state: 'running' | 'waiting' | 'terminated' = 'waiting';
      if (status?.state?.running) state = 'running';
      else if (status?.state?.terminated) state = 'terminated';
      containers.push({ name: spec.name, type: 'container', state });
    }

    const initSpecs = (pod.spec?.initContainers || []) as Array<{ name: string }>;
    const initStatuses = (pod.status?.initContainerStatuses || []) as Array<{
      name: string;
      state?: { running?: unknown; waiting?: unknown; terminated?: unknown };
    }>;

    for (const spec of initSpecs) {
      const status = initStatuses.find((s) => s.name === spec.name);
      let state: 'running' | 'waiting' | 'terminated' = 'waiting';
      if (status?.state?.running) state = 'running';
      else if (status?.state?.terminated) state = 'terminated';
      containers.push({ name: spec.name, type: 'init', state });
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="kv-skeleton w-12 h-12 rounded-full" /></div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-400">Failed to load pod: {error instanceof Error ? error.message : String(error)}</div>;
  }

  if (containers.length <= 1) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-2">
          <span className="text-sm text-slate-400">Logs</span>
          <span className="text-sm font-medium">{podName}</span>
          <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-300">{namespace}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <LogStream namespace={namespace} podName={podName} containerName={containers[0]?.name} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <MultiContainerLogs namespace={namespace} podName={podName} containers={containers} />
    </div>
  );
}
