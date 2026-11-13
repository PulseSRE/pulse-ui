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
import { CauseCard, useCauseContext, type CauseMatch } from './CauseCard';
import { FixCard } from './FixCard';
import { ChangesCard } from './ChangesCard';
import { MemoryCard, CrashLogCard } from './PodEvidenceCards';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
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
  const causeMatch: CauseMatch = { kind: 'Pod', name: resource.metadata.name, namespace, owner: owner ? { kind: owner.kind, name: owner.name } : undefined };
  // With the open finding's ids when the Cause card shows one.
  const context = useCauseContext({ kind: 'Pod', name: resource.metadata.name, namespace, gvr: 'v1/pods' }, causeMatch);
  usePageChatContext(context);
  const isTemplateOwner = !!owner && ['Deployment', 'StatefulSet', 'DaemonSet'].includes(owner.kind);
  // Revisions of the owning Deployment, to mark them on the memory chart.
  const rsList = useK8sListWatch<K8sResource>({ apiPath: '/apis/apps/v1/replicasets', namespace, enabled: owner?.kind === 'Deployment' });
  const revisions = React.useMemo(() => (owner?.kind === 'Deployment' && rsList.data
    ? rsList.data
      .filter((rs) => rs.metadata.ownerReferences?.some((o) => o.kind === 'Deployment' && o.name === owner.name))
      .map((rs) => ({ revision: rs.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? '?', at: rs.metadata.creationTimestamp }))
    : undefined), [owner?.kind, owner?.name, rsList.data]);

  return (
    <div className="space-y-5">
      <PodHeader pod={resource} owner={owner} usage={usage} usageLoading={usageLoading} go={go} />

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <CauseCard match={causeMatch} noun="pod" />
          <FixCard
            pod={resource}
            ownerApiPath={isTemplateOwner ? owner!.apiPath : undefined}
            usage={usage}
            usageLoading={usageLoading}
            events={events}
            ownerPage={owner ? { path: owner.path, label: `${owner.kind} ${owner.name}` } : undefined}
            go={go}
          />
          <ContainerFacts pod={resource} go={go} />
          <PodSummary resource={resource} go={go} />
          <IncidentContext resource={resource} managedPods={[]} events={events} namespace={namespace} go={go} />
        </div>
        <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-5">
          {/* kind=Pod: the agent walks the owner chain itself. */}
          <ChangesCard namespace={namespace} kind="Pod" name={resource.metadata.name} />
          <MemoryCard pod={resource} revisions={revisions} />
          <CrashLogCard pod={resource} go={go} />
          <AskPulseCard context={context} placeholder="Why does this pod keep restarting?" />
          <LabelsSection resource={resource} target={metaTarget} />
          <AnnotationsSection resource={resource} target={metaTarget} />
        </aside>
      </div>
    </div>
  );
}
