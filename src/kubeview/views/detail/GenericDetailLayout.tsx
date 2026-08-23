import React, { Suspense, lazy } from 'react';
import { Box, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import type { Event, Container, ContainerPort, ContainerStatus, Pod } from '../../engine/types';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { askPulse } from '../../engine/askPulse';
import { Card } from '../../components/primitives/Card';
import { LabelsSection, AnnotationsSection, DetailSection } from './MetadataSections';
import { IncidentContext } from './IncidentContext';
import { RollbackPanel } from './RollbackPanel';
import { WorkloadAudit } from './WorkloadAudit';
import DataEditor from '../../components/DataEditor';
import { jsonToYaml } from '../../engine/yamlUtils';
import type { RelatedResource } from './types';

const AmbientInsight = lazy(() => import('../../components/agent/AmbientInsight').then(m => ({ default: m.AmbientInsight })));

interface GenericDetailLayoutProps {
  resource: K8sResource;
  namespace?: string;
  gvrKey: string;
  apiPath: string;
  events: Event[];
  managedPods: K8sResource[];
  relatedResources: RelatedResource[];
  isWorkload: boolean;
  actionLoading: string | null;
  onAddLabel: () => void;
  onSwitchToEvents: () => void;
  go: (path: string, title: string) => void;
}

export function GenericDetailLayout({
  resource,
  namespace,
  gvrKey,
  apiPath,
  events,
  managedPods,
  relatedResources,
  isWorkload,
  actionLoading,
  onAddLabel,
  onSwitchToEvents,
  go,
}: GenericDetailLayoutProps) {
  const status = (resource.status as Record<string, unknown>) || {};
  const spec = (resource.spec as Record<string, unknown>) || {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column - Details */}
      <div className="lg:col-span-2 space-y-6">
        {/* Metadata */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-100">Metadata</h2>
          </div>
          <pre className="px-4 py-3 text-xs text-slate-300 font-mono overflow-auto max-h-64">
            {JSON.stringify(resource.metadata ?? {}, null, 2)}
          </pre>
        </Card>

        {/* Containers (Pods only) */}
        {resource.kind === 'Pod' && Array.isArray(spec.containers) && (
          <ContainersSection containers={spec.containers as Container[]} status={status} />
        )}

        {/* Data Editor for ConfigMaps and Secrets */}
        {(resource.kind === 'ConfigMap' || resource.kind === 'Secret') && (
          <DataEditor
            resourcePath={apiPath}
            data={(resource.data || {}) as Record<string, string>}
            kind={resource.kind as 'ConfigMap' | 'Secret'}
          />
        )}

        <LabelsSection resource={resource} onAddLabel={onAddLabel} actionLoading={actionLoading} />
        <AnnotationsSection resource={resource} />

        {/* Spec (simplified) */}
        {spec && Object.keys(spec).length > 0 && (
          <DetailSection title="Spec" collapsible>
            <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded-sm overflow-auto max-h-96">
              {jsonToYaml(spec)}
            </pre>
          </DetailSection>
        )}

        {/* Status (simplified) */}
        {status && Object.keys(status).length > 0 && (
          <DetailSection title="Status" collapsible>
            <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded-sm overflow-auto max-h-96">
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
          <ManagedPodsCard pods={managedPods} go={go} />
        )}

        {/* Incident Context */}
        {(resource.kind === 'Pod' || isWorkload) && namespace && (
          <IncidentContext resource={resource} managedPods={managedPods} events={events} namespace={namespace} go={go} />
        )}

        {/* Deployment Rollback History */}
        {resource.kind === 'Deployment' && namespace && (
          <RollbackPanel resource={resource} namespace={namespace} />
        )}

        {/* Workload Health Audit */}
        {isWorkload && resource && <WorkloadAudit resource={resource} go={go} />}

        {/* AI Insight + Inline Agent for pods and workloads */}
        {(resource.kind === 'Pod' || isWorkload) && namespace && (
          <>
            <ErrorBoundary fallbackTitle="AI insight unavailable">
              <Suspense fallback={
                <div className="animate-pulse space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <div className="h-4 w-32 bg-slate-800 rounded-sm" />
                  <div className="h-3 w-full bg-slate-800 rounded-sm" />
                  <div className="h-3 w-3/4 bg-slate-800 rounded-sm" />
                </div>
              }>
                <AmbientInsight
                  context={{ kind: resource.kind, name: resource.metadata.name, namespace }}
                  prompt={`Analyze this ${resource.kind} "${resource.metadata.name}" in namespace "${namespace}". If unhealthy, explain the root cause and give a specific fix command. If healthy, say so in one sentence. Do not list the resource name or namespace back to me.`}
                  trigger="manual"
                />
              </Suspense>
            </ErrorBoundary>
            {/* Suggested questions, not a second chat.
                This embedded an InlineAgent, so a detail page showed its own
                message box while the Pulse AI sidebar sat open beside it with
                another — two conversations about the same resource, each with
                its own connection state. The suggestions were the useful part;
                the second input was not. */}
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
              <div className="mb-2 text-xs font-medium text-slate-400">Ask Pulse AI about this {resource.kind}</div>
              <div className="flex flex-wrap gap-2">
                {[
                  `Why is this ${resource.kind} unhealthy?`,
                  'What changed recently?',
                  'How can I optimize this?',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() =>
                      askPulse(prompt, {
                        kind: resource.kind,
                        name: resource.metadata.name,
                        namespace,
                        gvr: gvrKey,
                      })
                    }
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-200"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Quick event count for non-pod/workload resources */}
        {resource.kind !== 'Pod' && !isWorkload && events.length > 0 && (
          <button
            onClick={onSwitchToEvents}
            className="w-full bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:bg-slate-800/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-200 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                {events.length} Event{events.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-blue-400">View &rarr;</span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Internal sub-components ────────────────────────────── */

function ContainersSection({ containers, status }: { containers: Container[]; status: Record<string, unknown> }) {
  return (
    <DetailSection title={`Containers (${containers.length})`}>
      <div className="space-y-3">
        {containers.map((container: Container) => {
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
                  <span className={`text-xs px-1.5 py-0.5 rounded-sm ${isReady ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
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
  );
}

function ManagedPodsCard({ pods, go }: { pods: K8sResource[]; go: (path: string, title: string) => void }) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Box className="w-4 h-4 text-blue-400" />
          Pods ({pods.length})
        </h2>
      </div>
      <div className="divide-y divide-slate-800 max-h-64 overflow-auto">
        {pods.map((pod) => {
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
                <span className={cn('text-xs px-1.5 py-0.5 rounded-sm',
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
  );
}
