import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle, XCircle, Loader2, Clock, Box, AlertTriangle,
  FileText, ArrowRight, ChevronDown, ChevronRight, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet } from '../engine/query';
import { K8S_BASE as BASE } from '../engine/gvr';
import { useNavigateTab } from '../hooks/useNavigateTab';

interface DeployProgressProps {
  type: 'deployment' | 'job';
  name: string;
  namespace: string;
  /** 'deploy' (default) or 'delete' */
  mode?: 'deploy' | 'delete';
  onClose: () => void;
}

export default function DeployProgress({ type, name, namespace, mode = 'deploy', onClose }: DeployProgressProps) {
  const go = useNavigateTab();
  const [showLogs, setShowLogs] = useState(false);
  const [showEvents, setShowEvents] = useState(true);

  const isDelete = mode === 'delete';

  // Poll the resource (null = gone)
  const { data: resource, dataUpdatedAt } = useQuery({
    queryKey: ['deploy-progress', type, namespace, name],
    queryFn: () => {
      const path = type === 'deployment'
        ? `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`
        : `/apis/batch/v1/namespaces/${namespace}/jobs/${name}`;
      return k8sGet<any>(path).catch(() => null);
    },
    refetchInterval: 2000,
  });

  // Poll pods
  const { data: pods = [] } = useQuery({
    queryKey: ['deploy-progress-pods', namespace, name],
    queryFn: async () => {
      const allPods = await k8sList<any>(`/api/v1/namespaces/${namespace}/pods`);
      return allPods.filter((p: any) => {
        const labels = p.metadata.labels || {};
        return labels.app === name || p.metadata.name?.startsWith(name);
      });
    },
    refetchInterval: 2000,
  });

  // Poll events
  const { data: events = [] } = useQuery({
    queryKey: ['deploy-progress-events', namespace, name],
    queryFn: async () => {
      const allEvents = await k8sList<any>(`/api/v1/namespaces/${namespace}/events`);
      return allEvents
        .filter((e: any) => {
          const ref = e.involvedObject;
          return ref?.name === name || pods.some((p: any) => ref?.name === p.metadata.name);
        })
        .sort((a: any, b: any) => {
          const at = a.lastTimestamp || a.firstTimestamp || '';
          const bt = b.lastTimestamp || b.firstTimestamp || '';
          return new Date(bt).getTime() - new Date(at).getTime();
        })
        .slice(0, 20);
    },
    refetchInterval: 3000,
    enabled: showEvents,
  });

  // === DEPLOY phase logic ===
  const deployPhase = React.useMemo(() => {
    if (!resource) return 'creating';
    if (type === 'job') {
      const status = resource.status || {};
      if (status.succeeded > 0) return 'succeeded';
      if (status.failed > 0) return 'failed';
      if (status.active > 0) return 'running';
      return 'creating';
    }
    const status = resource.status || {};
    const desired = resource.spec?.replicas || 1;
    const available = status.availableReplicas || 0;
    const ready = status.readyReplicas || 0;
    if (available >= desired && ready >= desired) return 'running';
    for (const pod of pods) {
      const cs = pod.status?.containerStatuses || [];
      for (const c of cs) {
        if (c.state?.waiting?.reason === 'ImagePullBackOff' || c.state?.waiting?.reason === 'ErrImagePull') return 'failed';
        if (c.state?.waiting?.reason === 'CrashLoopBackOff') return 'failed';
        if (c.state?.waiting?.reason === 'ContainerCreating') return 'pulling';
      }
      if (pod.status?.phase === 'Pending') return 'pulling';
    }
    if (pods.length === 0) return 'creating';
    return 'starting';
  }, [resource, pods, type]);

  // === DELETE phase logic ===
  // We already sent the delete — so if the resource still exists, it's
  // being torn down (even if deletionTimestamp hasn't propagated yet).
  const deletePhase = React.useMemo(() => {
    if (!resource && pods.length === 0) return 'gone';
    if (!resource && pods.length > 0) return 'cleaning-pods';
    // Resource still exists — it's being deleted (GC working)
    if (pods.length > 0) return 'terminating';
    return 'cleaning';
  }, [resource, pods]);

  const phase = isDelete ? deletePhase : deployPhase;
  const isTerminal = isDelete
    ? phase === 'gone'
    : (phase === 'running' || phase === 'failed' || phase === 'succeeded');
  const isFailed = !isDelete && phase === 'failed';

  // Failure reason from pods
  const failureReason = React.useMemo(() => {
    for (const pod of pods) {
      for (const cs of [...(pod.status?.containerStatuses || []), ...(pod.status?.initContainerStatuses || [])]) {
        const waiting = cs.state?.waiting;
        if (waiting?.reason && waiting.reason !== 'ContainerCreating') {
          return `${cs.name}: ${waiting.reason}${waiting.message ? ' — ' + waiting.message : ''}`;
        }
      }
    }
    return null;
  }, [pods]);

  // Steps
  const steps = isDelete
    ? [
        { id: 'deleting', label: 'Delete Sent', done: true },
        { id: 'terminating', label: 'Terminating Pods', done: phase === 'cleaning' || phase === 'gone' || (phase === 'cleaning-pods') },
        { id: 'cleaning', label: 'Cleanup', done: phase === 'gone' },
      ]
    : type === 'deployment'
    ? [
        { id: 'creating', label: 'Create Deployment', done: phase !== 'creating' },
        { id: 'pulling', label: 'Pull Image', done: !['creating', 'pulling'].includes(phase) },
        { id: 'starting', label: 'Start Containers', done: isTerminal },
        { id: 'running', label: 'Ready', done: phase === 'running' },
      ]
    : [
        { id: 'creating', label: 'Create Job', done: phase !== 'creating' },
        { id: 'running', label: 'Running', done: isTerminal },
        { id: 'succeeded', label: 'Complete', done: phase === 'succeeded' },
      ];

  const phaseLabel = isDelete
    ? { deleting: 'Deleting...', terminating: 'Terminating pods...', 'cleaning-pods': 'Cleaning up pods...', cleaning: 'Waiting for cleanup...', gone: 'Deleted' }[phase] || phase
    : { creating: 'Creating...', pulling: 'Pulling image...', starting: 'Starting...', running: 'Running', failed: 'Failed', succeeded: 'Completed' }[phase] || phase;

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
      {/* Header */}
      <div className={cn('px-4 py-3 border-b flex items-center justify-between',
        isFailed ? 'border-red-800 bg-red-950/30' :
        isTerminal ? (isDelete ? 'border-slate-700 bg-slate-800/50' : 'border-green-800 bg-green-950/20') :
        'border-slate-800'
      )}>
        <div className="flex items-center gap-3">
          {isFailed ? <XCircle className="w-5 h-5 text-red-400" /> :
           isTerminal ? (isDelete ? <Trash2 className="w-5 h-5 text-slate-400" /> : <CheckCircle className="w-5 h-5 text-green-400" />) :
           <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
          <div>
            <div className="text-sm font-medium text-slate-200">{name}</div>
            <div className="text-xs text-slate-500">{phaseLabel} · {namespace}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isTerminal && !isDelete && (
            <button onClick={() => go(`/r/apps~v1~deployments/${namespace}/${name}`, name)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded">
              View Resource <ArrowRight className="w-3 h-3" />
            </button>
          )}
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">
            {isTerminal ? 'Close' : 'Hide'}
          </button>
        </div>
      </div>

      {/* Progress steps */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-1">
          {steps.map((step, i) => (
            <React.Fragment key={step.id}>
              <div className="flex items-center gap-1.5">
                {step.done ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : step.id === phase ? (
                  isFailed ? <XCircle className="w-4 h-4 text-red-400" /> : <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                ) : (
                  <Clock className="w-4 h-4 text-slate-600" />
                )}
                <span className={cn('text-xs', step.done ? 'text-green-400' : step.id === phase ? (isFailed ? 'text-red-400' : 'text-blue-400') : 'text-slate-600')}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && <div className={cn('flex-1 h-px mx-2', step.done ? 'bg-green-700' : 'bg-slate-700')} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Failure detail */}
      {isFailed && failureReason && (
        <div className="px-4 py-2 bg-red-950/30 border-b border-red-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-300">{failureReason}</div>
        </div>
      )}

      {/* Pods */}
      {pods.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-800">
          <div className="text-xs text-slate-500 mb-2">Pods ({pods.length})</div>
          <div className="space-y-1">
            {pods.map((pod: any) => {
              const podPhase = pod.status?.phase || 'Pending';
              const containers = pod.status?.containerStatuses || [];
              const ready = containers.filter((c: any) => c.ready).length;
              const total = containers.length || (pod.spec?.containers?.length || 1);
              const waiting = containers.find((c: any) => c.state?.waiting)?.state?.waiting;
              const isTerminating = !!pod.metadata?.deletionTimestamp;

              return (
                <div key={pod.metadata.uid} className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/50">
                  <div className="flex items-center gap-2">
                    <Box className={cn('w-3.5 h-3.5',
                      isTerminating ? 'text-orange-400' :
                      podPhase === 'Running' ? 'text-green-400' :
                      podPhase === 'Failed' ? 'text-red-400' : 'text-yellow-400'
                    )} />
                    <span className="text-xs text-slate-300 font-mono">{pod.metadata.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {waiting && <span className="text-xs text-yellow-400">{waiting.reason}</span>}
                    <span className={cn('text-xs font-mono', ready === total && total > 0 ? 'text-green-400' : 'text-slate-500')}>{ready}/{total}</span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded',
                      isTerminating ? 'bg-orange-900/50 text-orange-300' :
                      podPhase === 'Running' ? 'bg-green-900/50 text-green-300' :
                      podPhase === 'Failed' ? 'bg-red-900/50 text-red-300' :
                      podPhase === 'Succeeded' ? 'bg-blue-900/50 text-blue-300' :
                      'bg-yellow-900/50 text-yellow-300'
                    )}>{isTerminating ? 'Terminating' : podPhase}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Events */}
      <div className="border-b border-slate-800">
        <button onClick={() => setShowEvents(!showEvents)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800/30">
          <span className="text-xs text-slate-400">Events ({events.length})</span>
          {showEvents ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
        </button>
        {showEvents && events.length > 0 && (
          <div className="px-4 pb-3 space-y-1 max-h-40 overflow-auto">
            {events.map((e: any, i: number) => (
              <div key={i} className="flex items-start gap-2 py-1">
                {e.type === 'Warning' ? <AlertTriangle className="w-3 h-3 text-yellow-500 mt-0.5 shrink-0" /> : <CheckCircle className="w-3 h-3 text-slate-600 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <span className={cn('text-xs', e.type === 'Warning' ? 'text-yellow-400' : 'text-slate-500')}>{e.reason} </span>
                  <span className="text-xs text-slate-400">{e.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Logs (only for deploy mode) */}
      {!isDelete && (
        <div>
          <button onClick={() => setShowLogs(!showLogs)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800/30">
            <span className="text-xs text-slate-400 flex items-center gap-1.5"><FileText className="w-3 h-3" /> Logs</span>
            {showLogs ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
          </button>
          {showLogs && pods.length > 0 && (
            <PodLogs namespace={namespace} podName={pods[0].metadata.name} />
          )}
          {showLogs && pods.length === 0 && (
            <div className="px-4 pb-3 text-xs text-slate-500">Waiting for pods...</div>
          )}
        </div>
      )}
    </div>
  );
}

function PodLogs({ namespace, podName }: { namespace: string; podName: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/namespaces/${namespace}/pods/${podName}/log?tailLines=100&timestamps=true`);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) setLogs(text.split('\n').filter(Boolean));
        }
      } catch {}
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [namespace, podName]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div ref={logRef} className="px-4 pb-3 max-h-48 overflow-auto font-mono text-[11px] text-slate-400 space-y-0.5">
      {logs.length === 0 ? (
        <div className="text-slate-600 py-2">No logs yet...</div>
      ) : (
        logs.map((line, i) => {
          const isErr = /error|fatal|panic|exception/i.test(line);
          const isWarn = /warn|warning/i.test(line);
          return (
            <div key={i} className={cn(isErr ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-slate-400')}>
              {line}
            </div>
          );
        })
      )}
    </div>
  );
}
