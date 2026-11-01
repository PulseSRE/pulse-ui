import type { K8sResource } from '../../engine/renderers';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import DeployProgress from '../../components/DeployProgress';
import { describePodRestart } from '../../engine/writeGuards';

interface DeleteConfirmProps {
  open: boolean;
  resource: K8sResource;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConfirmModal({ open, resource, deleting, onConfirm, onClose }: DeleteConfirmProps) {
  // A pod's controller decides whether deleting it is a restart or gone for good: say which.
  const pod = resource.kind === 'Pod' ? describePodRestart(resource) : null;
  const plain = `Are you sure you want to delete "${resource.metadata.name}"${resource.metadata.namespace ? ` from ${resource.metadata.namespace}` : ''}? This action cannot be undone.`;
  return (
    <ConfirmDialog
      open={open}
      title={`Delete ${resource.kind}`}
      description={pod ? (pod.replaced ? pod.description : `Are you sure you want to delete "${resource.metadata.name}"? It has no controller, so nothing will recreate it.`) : plain}
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
  /** API path of the deleted resource: the progress polls this, not a guessed Deployment path. */
  apiPath: string;
  onClose: () => void;
}

export function DeleteProgressModal({ resource, namespace, apiPath, onClose }: DeleteProgressProps) {
  const selector = (resource.spec as { selector?: { matchLabels?: Record<string, string> } } | undefined)?.selector?.matchLabels;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-2xl">
        <DeployProgress
          type={resource.kind === 'Job' ? 'job' : 'deployment'}
          name={resource.metadata.name}
          namespace={namespace || undefined}
          resourcePath={apiPath}
          kind={resource.kind}
          podSelector={selector}
          mode="delete"
          onClose={onClose}
        />
      </div>
    </div>
  );
}
