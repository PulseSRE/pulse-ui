import React from 'react';
import type { K8sResource } from '../../engine/renderers';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import DeployProgress from '../../components/DeployProgress';

interface DeleteConfirmProps {
  open: boolean;
  resource: K8sResource;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConfirmModal({ open, resource, deleting, onConfirm, onClose }: DeleteConfirmProps) {
  return (
    <ConfirmDialog
      open={open}
      title={`Delete ${resource.kind}`}
      description={`Are you sure you want to delete "${resource.metadata.name}"${resource.metadata.namespace ? ` from ${resource.metadata.namespace}` : ''}? This action cannot be undone.`}
      confirmLabel="Delete"
      variant="danger"
      loading={deleting}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

interface DeleteProgressProps {
  resource: K8sResource;
  namespace?: string;
  onClose: () => void;
}

export function DeleteProgressModal({ resource, namespace, onClose }: DeleteProgressProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-2xl">
        <DeployProgress
          type={resource.kind === 'Job' ? 'job' : 'deployment'}
          name={resource.metadata.name}
          namespace={namespace || 'default'}
          mode="delete"
          onClose={onClose}
        />
      </div>
    </div>
  );
}

interface AddLabelDialogProps {
  open: boolean;
  labelKey: string;
  labelValue: string;
  actionLoading: string | null;
  onLabelKeyChange: (value: string) => void;
  onLabelValueChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function AddLabelDialog({
  open,
  labelKey,
  labelValue,
  actionLoading,
  onLabelKeyChange,
  onLabelValueChange,
  onSubmit,
  onClose,
}: AddLabelDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-label="Add label">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Add Label</h3>
        <form onSubmit={onSubmit}>
          <div className="space-y-3">
            <div>
              <label htmlFor="label-key" className="block text-xs text-slate-400 mb-1">Key</label>
              <input
                id="label-key"
                type="text"
                value={labelKey}
                onChange={(e) => onLabelKeyChange(e.target.value)}
                placeholder="e.g. app.kubernetes.io/name"
                className="w-full px-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
                autoFocus
                required
              />
            </div>
            <div>
              <label htmlFor="label-value" className="block text-xs text-slate-400 mb-1">Value</label>
              <input
                id="label-value"
                type="text"
                value={labelValue}
                onChange={(e) => onLabelValueChange(e.target.value)}
                placeholder="e.g. my-app"
                className="w-full px-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={actionLoading === 'label'}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading === 'label' || !labelKey.trim()}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-sm transition-colors disabled:opacity-50"
            >
              {actionLoading === 'label' ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
