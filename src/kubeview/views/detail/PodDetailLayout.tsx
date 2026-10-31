import React from 'react';
import type { K8sResource } from '../../engine/renderers';
import type { Event } from '../../engine/types';
import { PodSummary } from './PodSummary';
import { IncidentContext } from './IncidentContext';
import { LabelsSection, AnnotationsSection, DetailSection } from './MetadataSections';
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

export function PodDetailLayout({
  resource,
  namespace,
  events,
  relatedResources,
  metaTarget,
  go,
}: PodDetailLayoutProps) {
  return (
    <div className="space-y-6">
      <PodSummary resource={resource} go={go} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <IncidentContext resource={resource} managedPods={[]} events={events} namespace={namespace} go={go} />
        </div>
        <div className="space-y-6">
          <LabelsSection resource={resource} target={metaTarget} />
          <AnnotationsSection resource={resource} target={metaTarget} />
          {/* Owner */}
          {relatedResources.length > 0 && (
            <DetailSection title="Owner">
              <div className="space-y-1">
                {relatedResources.map((related, idx) => (
                  <button key={idx} onClick={() => go(related.path, related.name)}
                    className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
                    <span className="text-xs text-slate-500">{related.type}</span>
                    {related.name}
                  </button>
                ))}
              </div>
            </DetailSection>
          )}
        </div>
      </div>
    </div>
  );
}
