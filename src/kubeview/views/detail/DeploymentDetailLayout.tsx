import React from 'react';
import type { K8sResource } from '../../engine/renderers';
import type { Event } from '../../engine/types';
import { DeploymentSummary } from './DeploymentSummary';
import { IncidentContext } from './IncidentContext';
import { RolloutHistory } from './RolloutHistory';
import { WorkloadAudit } from './WorkloadAudit';
import { LabelsSection, AnnotationsSection } from './MetadataSections';

interface DeploymentDetailLayoutProps {
  resource: K8sResource;
  namespace: string;
  managedPods: K8sResource[];
  events: Event[];
  actionLoading: string | null;
  onAddLabel: () => void;
  go: (path: string, title: string) => void;
}

export function DeploymentDetailLayout({
  resource,
  namespace,
  managedPods,
  events,
  actionLoading,
  onAddLabel,
  go,
}: DeploymentDetailLayoutProps) {
  return (
    <div className="space-y-6">
      <DeploymentSummary resource={resource} managedPods={managedPods} go={go} />

      {/* Incident + Audit + Rollback in 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <IncidentContext resource={resource} managedPods={managedPods} events={events} namespace={namespace} go={go} />
          <RolloutHistory resource={resource} namespace={namespace} />
        </div>
        <div className="space-y-6">
          <WorkloadAudit resource={resource} go={go} />
          <LabelsSection resource={resource} onAddLabel={onAddLabel} actionLoading={actionLoading} />
          <AnnotationsSection resource={resource} />
        </div>
      </div>
    </div>
  );
}
