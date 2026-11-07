import React from 'react';
import { Copy, Pencil, X } from 'lucide-react';
import type { K8sResource } from '../../engine/renderers';
import { copyToClipboard } from '../../engine/clipboard';
import { Card } from '../../components/primitives/Card';
import { useCanI } from '../../hooks/useCanI';
import { useActionDialog, type ActionInput } from '../../components/ActionDialog';
import {
  metadataPatch, sendWrite, validateLabelValue, validateMetadataKey, type MetadataField,
} from '../../engine/workloadActions';

export function DetailSection({
  title,
  children,
  collapsible = false,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  actions?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = React.useState(true);

  return (
    <Card>
      <div
        className={`px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2${collapsible ? ' cursor-pointer hover:bg-slate-800/50' : ''}`}
        onClick={() => collapsible && setIsOpen(!isOpen)}
      >
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
      {isOpen && <div className="px-4 py-3">{children}</div>}
    </Card>
  );
}

/** Where metadata edits go: the object's API path and the RBAC resource for it. */
export interface MetadataTarget {
  apiPath: string;
  group: string;
  plural: string;
}

/** Annotations Kubernetes or kubectl maintain; shown read-only, never offered for editing. */
const SYSTEM_ANNOTATION = /last-applied-configuration|managedFields/;

function useMetadataEditor(resource: K8sResource, target: MetadataTarget, field: MetadataField) {
  const { allowed: canPatch } = useCanI('patch', target.group, target.plural, resource.metadata.namespace);
  const { open, dialog } = useActionDialog();
  const noun = field === 'labels' ? 'label' : 'annotation';
  const where = `${resource.kind} "${resource.metadata.name}"`;
  const current = (resource.metadata[field] as Record<string, string> | undefined) ?? {};

  const valueInput = (initial: string): ActionInput => ({
    id: 'value',
    label: 'Value',
    initial,
    validate: field === 'labels' ? (v) => validateLabelValue(v) : undefined,
  });

  const add = () => open({
    title: `Add ${noun}`,
    description: `Add a ${noun} to ${where}. Applies only if the object has not changed since this page loaded it.`,
    confirmLabel: 'Add',
    inputs: [
      {
        id: 'key', label: 'Key', initial: '', placeholder: 'e.g. app.kubernetes.io/name',
        validate: (k) => validateMetadataKey(k.trim()) ?? (k.trim() in current ? `"${k.trim()}" already exists; edit it instead` : null),
      },
      valueInput(''),
    ],
    run: (cid, v) => sendWrite(metadataPatch(resource, field, v.key.trim(), v.value, target.apiPath), cid),
    success: (v) => `${noun[0].toUpperCase()}${noun.slice(1)} ${v.key.trim()} added`,
  });

  const edit = (key: string) => open({
    title: `Edit ${noun} ${key}`,
    description: `Change the value of ${noun} "${key}" on ${where}. Applies only if the object has not changed since this page loaded it.`,
    confirmLabel: 'Save',
    inputs: [{ id: 'key', label: 'Key', initial: key, readOnly: true }, valueInput(current[key] ?? '')],
    run: (cid, v) => sendWrite(metadataPatch(resource, field, key, v.value, target.apiPath), cid),
    success: `${noun[0].toUpperCase()}${noun.slice(1)} ${key} updated`,
  });

  const remove = (key: string) => open({
    title: `Remove ${noun} ${key}?`,
    description: `Remove ${noun} "${key}" from ${where}.${field === 'labels' ? ' Selectors that match on it (Services, NetworkPolicies, controllers) stop matching this object.' : ''}`,
    confirmLabel: 'Remove',
    variant: 'danger',
    run: (cid) => sendWrite(metadataPatch(resource, field, key, null, target.apiPath), cid),
    success: `${noun[0].toUpperCase()}${noun.slice(1)} ${key} removed`,
  });

  return { canPatch, add, edit, remove, dialog, noun };
}

function RowActions({ k, canPatch, noun, onEdit, onRemove, copyText }: {
  k: string; canPatch: boolean; noun: string; onEdit: () => void; onRemove: () => void; copyText: string;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={() => copyToClipboard(copyText, `${noun[0].toUpperCase()}${noun.slice(1)} copied`)}
        className="p-0.5 rounded-sm text-faint hover:text-slate-300"
        title={`Copy ${noun}`}
        aria-label={`Copy ${noun} ${k}`}
      >
        <Copy className="w-3 h-3" />
      </button>
      {canPatch && (
        <>
          <button onClick={onEdit} className="p-0.5 rounded-sm text-faint hover:text-blue-300" title={`Edit ${noun}`} aria-label={`Edit ${noun} ${k}`}>
            <Pencil className="w-3 h-3" />
          </button>
          <button onClick={onRemove} className="p-0.5 rounded-sm text-faint hover:text-red-400" title={`Remove ${noun}`} aria-label={`Remove ${noun} ${k}`}>
            <X className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
}

function AddButton({ canPatch, noun, onClick }: { canPatch: boolean; noun: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!canPatch}
      title={canPatch ? undefined : `You do not have permission to change this object's ${noun}s`}
      className="mt-2 text-xs text-blue-400 hover:text-blue-300 disabled:text-slate-500 disabled:cursor-not-allowed"
    >
      + Add {noun}
    </button>
  );
}

interface SectionProps {
  resource: K8sResource;
  target: MetadataTarget;
}

/** Labels: always shown (so a label can be added when there are none), editable when RBAC allows. */
export function LabelsSection({ resource, target }: SectionProps) {
  const labels = resource.metadata.labels ?? {};
  const ed = useMetadataEditor(resource, target, 'labels');
  const entries = Object.entries(labels);

  return (
    <DetailSection title={`Labels (${entries.length})`}>
      {entries.length === 0 ? (
        <p className="text-xs text-faint">No labels.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono shrink-0 w-48 truncate" title={key}>{key}</span>
              <span className="text-xs text-slate-200 font-mono flex-1 break-all">{value}</span>
              <RowActions k={key} canPatch={ed.canPatch} noun="label" copyText={`${key}=${value}`} onEdit={() => ed.edit(key)} onRemove={() => ed.remove(key)} />
            </div>
          ))}
        </div>
      )}
      <AddButton canPatch={ed.canPatch} noun="label" onClick={ed.add} />
      {ed.dialog}
    </DetailSection>
  );
}

/** Annotations: always shown, editable when RBAC allows; system-maintained ones are read-only. */
export function AnnotationsSection({ resource, target }: SectionProps) {
  const annotations = resource.metadata.annotations ?? {};
  const ed = useMetadataEditor(resource, target, 'annotations');
  const entries = Object.entries(annotations).filter(([key]) => !SYSTEM_ANNOTATION.test(key));

  return (
    <DetailSection title={`Annotations (${entries.length})`} collapsible>
      {entries.length === 0 ? (
        <p className="text-xs text-faint">No annotations.</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-start gap-2">
              <span className="text-xs text-slate-400 font-mono shrink-0 w-48 truncate" title={key}>{key}</span>
              <span className="text-xs text-slate-200 font-mono break-all flex-1">
                {String(value).length > 200 ? String(value).slice(0, 200) + '...' : value}
              </span>
              <RowActions k={key} canPatch={ed.canPatch} noun="annotation" copyText={`${key}: ${value}`} onEdit={() => ed.edit(key)} onRemove={() => ed.remove(key)} />
            </div>
          ))}
        </div>
      )}
      <AddButton canPatch={ed.canPatch} noun="annotation" onClick={ed.add} />
      {ed.dialog}
    </DetailSection>
  );
}
