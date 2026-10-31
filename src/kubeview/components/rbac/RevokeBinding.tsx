/**
 * Revoke access by deleting a RoleBinding or ClusterRoleBinding.
 *
 * A binding can name several subjects; deleting it removes the role from all
 * of them, so the confirmation lists every subject it covers.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { k8sDelete } from '../../engine/query';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { useUIStore } from '../../store/uiStore';
import { Button } from '../primitives/Button';
import { LoadError } from '../primitives/LoadError';
import { ConfirmDialog } from '../feedback/ConfirmDialog';

export interface BindingRef {
  kind: 'ClusterRoleBinding' | 'RoleBinding';
  name: string;
  namespace?: string;
  uid?: string;
  roleRef: { kind?: string; name: string };
  subjects: Array<{ kind: string; name: string; namespace?: string }>;
}

export function bindingPath(b: Pick<BindingRef, 'kind' | 'name' | 'namespace'>): string {
  return b.kind === 'ClusterRoleBinding'
    ? `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${encodeURIComponent(b.name)}`
    : `/apis/rbac.authorization.k8s.io/v1/namespaces/${b.namespace}/rolebindings/${encodeURIComponent(b.name)}`;
}

export function subjectLabel(s: { kind: string; name: string; namespace?: string }): string {
  return s.kind === 'ServiceAccount' ? `ServiceAccount ${s.namespace}/${s.name}` : `${s.kind} ${s.name}`;
}

export function RevokeBindingButton({ binding, label = 'Revoke' }: { binding: BindingRef; label?: string }) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const resource = binding.kind === 'ClusterRoleBinding' ? 'clusterrolebindings' : 'rolebindings';
  const { allowed } = useCanI('delete', 'rbac.authorization.k8s.io', resource, binding.namespace);
  const action = usePinnedAction<BindingRef>();

  const confirm = () => action.run(`Deleting ${binding.kind} ${binding.name}`, async (b, clusterId) => {
    await k8sDelete(bindingPath(b), clusterId, b.uid ? { uid: b.uid } : undefined);
    addToast({ type: 'success', title: `${b.kind} ${b.name} deleted`, detail: `${b.roleRef.name} revoked from ${b.subjects.length} subject${b.subjects.length === 1 ? '' : 's'}` });
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
  });

  const where = binding.kind === 'ClusterRoleBinding' ? 'cluster-wide' : `in ${binding.namespace}`;
  return (
    <>
      <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => action.open(binding)}
        aria-label={`${label} ${binding.kind} ${binding.name}`}
        title={allowed ? `Delete ${binding.kind} ${binding.name}` : `You do not have permission to delete ${resource}`}>
        <Trash2 className="w-3.5 h-3.5" /> {label}
      </Button>
      <ConfirmDialog
        open={!!action.pending}
        onClose={action.close}
        onConfirm={confirm}
        title={`Delete ${binding.kind} ${binding.name}?`}
        description={`Deletes the binding that grants ${binding.roleRef.kind ?? 'role'} ${binding.roleRef.name} ${where}. Every subject below loses that access immediately; access they have through other bindings is unaffected.`}
        confirmLabel="Delete binding"
        variant="danger"
        loading={action.running}
      >
        <ul className="mt-3 space-y-1 text-xs font-mono text-slate-300" aria-label="Subjects losing access">
          {binding.subjects.length === 0 ? <li>(no subjects)</li> : binding.subjects.map((s) => <li key={subjectLabel(s)}>{subjectLabel(s)}</li>)}
        </ul>
        {action.error && <LoadError className="mt-3" title="The binding was not deleted" error={action.error} />}
      </ConfirmDialog>
    </>
  );
}
