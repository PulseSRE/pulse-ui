import React from 'react';
import type { K8sResource } from '../../engine/renderers';
import type { Event } from '../../engine/types';
import { PodSummary } from './PodSummary';
import { PodHeader } from './PodHeader';
import { ContainerFacts } from './ContainerFacts';
import { IncidentContext } from './IncidentContext';
import { AskPulseCard, usePageChatContext } from './AskPulseCard';
import { usePodOwner } from './usePodOwner';
import { usePodUsage } from './usePodUsage';
import { LabelsSection, AnnotationsSection } from './MetadataSections';
import type { MetadataTarget } from './MetadataSections';
import type { RelatedResource } from './types';

interface PodDetailLayoutProps {
  resource: K8sResource;
  namespace: string;
  events: Event[];
  relatedResources: RelatedResource[];
  metaTarget: MetadataTarget;
  go: (path: string, title: string) => void;
}

/**
 * The pod page, laid out to fix it where you find it: state and the numbers
 * that explain a crash at the top, then each container's facts; the right
 * column holds what to ask Pulse and the pod's metadata.
 */
export function PodDetailLayout({
  resource,
  namespace,
  events,
  metaTarget,
  go,
}: PodDetailLayoutProps) {
  const { owner } = usePodOwner(resource);
  const podNames = React.useMemo(() => [resource.metadata.name], [resource.metadata.name]);
  const { usage, isLoading: usageLoading } = usePodUsage(namespace, podNames);
  const context = { kind: 'Pod', name: resource.metadata.name, namespace, gvr: 'v1/pods' };
  usePageChatContext(context);

  return (
    <div className="space-y-5">
      <PodHeader pod={resource} owner={owner} usage={usage} usageLoading={usageLoading} go={go} />

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <ContainerFacts pod={resource} go={go} />
          <PodSummary resource={resource} go={go} />
          <IncidentContext resource={resource} managedPods={[]} events={events} namespace={namespace} go={go} />
        </div>
        <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-5">
          <AskPulseCard context={context} placeholder="Why does this pod keep restarting?" />
          <LabelsSection resource={resource} target={metaTarget} />
          <AnnotationsSection resource={resource} target={metaTarget} />
        </aside>
      </div>
    </div>
  );
}
