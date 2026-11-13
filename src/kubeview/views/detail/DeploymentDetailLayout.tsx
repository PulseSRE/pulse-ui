import React from 'react';
import type { K8sResource } from '../../engine/renderers';
import type { Event } from '../../engine/types';
import { DeploymentSummary } from './DeploymentSummary';
import { IncidentContext } from './IncidentContext';
import { RolloutHistory } from './RolloutHistory';
import { WorkloadAudit } from './WorkloadAudit';
import { LabelsSection, AnnotationsSection } from './MetadataSections';
import type { MetadataTarget } from './MetadataSections';
import { AskPulseCard, usePageChatContext } from './AskPulseCard';
import { CauseCard, useCauseContext, type CauseMatch } from './CauseCard';
import { FixCard } from './FixCard';
import { ChangesCard } from './ChangesCard';
import { usePodUsage } from './usePodUsage';
import type { Pod } from '../../engine/types';

/** The pod most worth fixing: crash-looping or failing to pull first, then the most restarts. */
export function worstPod(pods: K8sResource[]): K8sResource | null {
  let best: { pod: K8sResource; score: number } | null = null;
  for (const p of pods) {
    const cs = (p.status as Pod['status'] | undefined)?.containerStatuses ?? [];
    const waiting = cs.map((c) => c.state?.waiting?.reason).find(Boolean);
    const restarts = cs.reduce((n, c) => n + (c.restartCount || 0), 0);
    const score = waiting === 'CrashLoopBackOff' ? 1000 + restarts
      : waiting === 'ImagePullBackOff' || waiting === 'ErrImagePull' ? 900
        : restarts > 0 ? restarts
          : cs.some((c) => !c.ready) ? 0.5 : 0;
    if (score > 0 && (!best || score > best.score)) best = { pod: p, score };
  }
  return best?.pod ?? null;
}

interface DeploymentDetailLayoutProps {
  resource: K8sResource;
  namespace: string;
  managedPods: K8sResource[];
  events: Event[];
  metaTarget: MetadataTarget;
  go: (path: string, title: string) => void;
}

export function DeploymentDetailLayout({
  resource,
  namespace,
  managedPods,
  events,
  metaTarget,
  go,
}: DeploymentDetailLayoutProps) {
  const failing = React.useMemo(() => worstPod(managedPods), [managedPods]);
  const podNames = React.useMemo(() => managedPods.map((p) => p.metadata.name), [managedPods]);
  const causeMatch: CauseMatch = { kind: 'Deployment', name: resource.metadata.name, namespace, podNames };
  // With the open finding's ids when the Cause card shows one.
  const context = useCauseContext({ kind: 'Deployment', name: resource.metadata.name, namespace, gvr: 'apps/v1/deployments' }, causeMatch);
  usePageChatContext(context);
  const { usage, isLoading: usageLoading } = usePodUsage(namespace, failing ? [failing.metadata.name] : []);
  React.useEffect(() => {
    if (window.location.hash === '#rollback') {
      document.getElementById('rollback')?.scrollIntoView?.({ block: 'start' });
    }
  }, []);
  return (
    <div className="space-y-6">
      <DeploymentSummary resource={resource} managedPods={managedPods} go={go} />

      {/* Incident + Audit + Rollback in 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <CauseCard match={causeMatch} noun="Deployment" />
          {failing ? (
            <FixCard pod={failing} ownerObject={resource} usage={usage} usageLoading={usageLoading} events={events} go={go} />
          ) : null}
          <IncidentContext resource={resource} managedPods={managedPods} events={events} namespace={namespace} go={go} />
          {/* "Roll back…" in the actions menu links here. */}
          <div id="rollback" className="scroll-mt-4">
            <RolloutHistory resource={resource} namespace={namespace} />
          </div>
        </div>
        <div className="space-y-6">
          <ChangesCard namespace={namespace} kind="Deployment" name={resource.metadata.name} />
          <AskPulseCard context={context} placeholder="Why is this Deployment not available?" />
          <WorkloadAudit resource={resource} go={go} />
          <LabelsSection resource={resource} target={metaTarget} />
          <AnnotationsSection resource={resource} target={metaTarget} />
        </div>
      </div>
    </div>
  );
}
