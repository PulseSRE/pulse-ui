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
  const { data: logText, isLoading, error } = useQuery({
    queryKey: ['build-log', namespace, buildName],
    queryFn: async () => {
      const res = await fetch(`/api/kubernetes/apis/build.openshift.io/v1/namespaces/${namespace}/builds/${buildName}/log`);
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
          <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-sm text-slate-300">{namespace}</span>
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
