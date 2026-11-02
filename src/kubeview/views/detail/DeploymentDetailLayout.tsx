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
  const context = { kind: 'Deployment', name: resource.metadata.name, namespace, gvr: 'apps/v1/deployments' };
  usePageChatContext(context);
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
          <IncidentContext resource={resource} managedPods={managedPods} events={events} namespace={namespace} go={go} />
          {/* "Roll back…" in the actions menu links here. */}
          <div id="rollback" className="scroll-mt-4">
            <RolloutHistory resource={resource} namespace={namespace} />
          </div>
        </div>
        <div className="space-y-6">
          <AskPulseCard context={context} placeholder="Why is this Deployment not available?" />
          <WorkloadAudit resource={resource} go={go} />
          <LabelsSection resource={resource} target={metaTarget} />
          <AnnotationsSection resource={resource} target={metaTarget} />
        </div>
      </div>
    </div>
  );
}
