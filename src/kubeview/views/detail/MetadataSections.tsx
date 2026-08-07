import React from 'react';
import { Copy } from 'lucide-react';
import type { K8sResource } from '../../engine/renderers';
import { copyToClipboard } from '../../engine/clipboard';
import { Card } from '../../components/primitives/Card';

export function DetailSection({
  title,
  children,
  collapsible = false,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(true);

  return (
    <Card>
      <div
        className={`px-4 py-3 border-b border-slate-800${collapsible ? ' cursor-pointer hover:bg-slate-800/50' : ''}`}
        onClick={() => collapsible && setIsOpen(!isOpen)}
      >
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      {isOpen && <div className="px-4 py-3">{children}</div>}
    </Card>
  );
}

interface LabelsSectionProps {
  resource: K8sResource;
  onAddLabel: () => void;
  actionLoading: string | null;
}

export function LabelsSection({ resource, onAddLabel, actionLoading }: LabelsSectionProps) {
  const labels = resource.metadata.labels;
  if (!labels || Object.keys(labels).length === 0) return null;

  return (
    <DetailSection title="Labels">
      <div className="space-y-1.5">
        {Object.entries(labels).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 group">
            <span className="text-xs text-slate-400 font-mono shrink-0 w-48 truncate" title={key}>{key}</span>
            <span className="text-xs text-slate-200 font-mono flex-1">{value}</span>
            <button
              onClick={() => copyToClipboard(`${key}=${value}`, 'Label copied')}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded-sm text-slate-500 hover:text-slate-300 transition-opacity"
              title="Copy label"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <button
        disabled={!!actionLoading}
        onClick={onAddLabel}
        className="mt-2 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
      >
        {actionLoading === 'label' ? 'Adding...' : '+ Add label'}
      </button>
    </DetailSection>
  );
}

interface AnnotationsSectionProps {
  resource: K8sResource;
}

export function AnnotationsSection({ resource }: AnnotationsSectionProps) {
  const annotations = resource.metadata.annotations;
  if (!annotations || Object.keys(annotations).length === 0) return null;

  const filtered = Object.entries(annotations).filter(
    ([key]) => !key.includes('last-applied-configuration') && !key.includes('managedFields'),
  );

  if (filtered.length === 0) return null;

  return (
    <DetailSection title="Annotations" collapsible>
      <div className="space-y-2">
        {filtered.map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 group">
            <span className="text-xs text-slate-400 font-mono shrink-0 w-48 truncate" title={key}>{key}</span>
            <span className="text-xs text-slate-200 font-mono break-all flex-1">
              {String(value).length > 200 ? String(value).slice(0, 200) + '...' : value}
            </span>
            <button
              onClick={() => copyToClipboard(`${key}: ${value}`, 'Annotation copied')}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded-sm text-slate-500 hover:text-slate-300 transition-opacity shrink-0"
              title="Copy annotation"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}
