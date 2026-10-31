/**
 * OpenShift Group management: create, delete, add and remove members.
 *
 * Membership edits send the whole `users` list with the resourceVersion the
 * screen read, so an edit made elsewhere in the meantime is refused (409)
 * rather than silently overwritten.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { k8sCreate, k8sDelete, k8sPatch } from '../../engine/query';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { useUIStore } from '../../store/uiStore';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';

const GROUPS = '/apis/user.openshift.io/v1/groups';

export interface GroupLike {
  metadata: { name: string; uid?: string; resourceVersion?: string };
  users?: string[] | null;
}

type GroupChange =
  | { kind: 'create'; name: string }
  | { kind: 'delete'; group: GroupLike }
  | { kind: 'add'; group: GroupLike; user: string }
  | { kind: 'remove'; group: GroupLike; user: string };

function useGroupAction() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const action = usePinnedAction<GroupChange>();
  const confirm = () => action.run('Changing groups', async (c, clusterId) => {
    if (c.kind === 'create') {
      await k8sCreate(GROUPS, { apiVersion: 'user.openshift.io/v1', kind: 'Group', metadata: { name: c.name }, users: [] }, clusterId);
      addToast({ type: 'success', title: `Group ${c.name} created` });
    } else if (c.kind === 'delete') {
      await k8sDelete(`${GROUPS}/${encodeURIComponent(c.group.metadata.name)}`, clusterId, c.group.metadata.uid ? { uid: c.group.metadata.uid } : undefined);
      addToast({ type: 'success', title: `Group ${c.group.metadata.name} deleted` });
    } else {
      const current = c.group.users ?? [];
      const users = c.kind === 'add' ? [...current, c.user] : current.filter((u) => u !== c.user);
      await k8sPatch(`${GROUPS}/${encodeURIComponent(c.group.metadata.name)}`,
        { metadata: { resourceVersion: c.group.metadata.resourceVersion }, users },
        'application/merge-patch+json', clusterId);
      addToast({ type: 'success', title: c.kind === 'add' ? `${c.user} added to ${c.group.metadata.name}` : `${c.user} removed from ${c.group.metadata.name}` });
    }
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
  });
  return { action, confirm };
}

function describe(c: GroupChange): { title: string; description: string; label: string; danger: boolean } {
  switch (c.kind) {
    case 'create': return { title: `Create group ${c.name}?`, description: `Creates an empty OpenShift Group named ${c.name}. Bind roles to it, then add members.`, label: 'Create', danger: false };
    case 'delete': return { title: `Delete group ${c.group.metadata.name}?`, description: `Deletes the Group. Its ${(c.group.users ?? []).length} member(s) lose every role bound to this group; RoleBindings that name it stay but match no one.`, label: 'Delete group', danger: true };
    case 'add': return { title: `Add ${c.user} to ${c.group.metadata.name}?`, description: `${c.user} gains every role bound to ${c.group.metadata.name}.`, label: 'Add member', danger: false };
    case 'remove': return { title: `Remove ${c.user} from ${c.group.metadata.name}?`, description: `${c.user} loses every role they have only through ${c.group.metadata.name}.`, label: 'Remove member', danger: true };
  }
}

function GroupDialog({ action, confirm }: ReturnType<typeof useGroupAction>) {
  const c = action.pending?.target;
  const d = c ? describe(c) : null;
  return (
    <ConfirmDialog open={!!c} onClose={action.close} onConfirm={confirm} title={d?.title ?? ''} description={d?.description ?? ''}
      confirmLabel={d?.label} variant={d?.danger ? 'danger' : 'warning'} loading={action.running}>
      {action.error && <LoadError className="mt-3" title="Nothing was changed" error={action.error} />}
    </ConfirmDialog>
  );
}

export function CreateGroupButton() {
  const { allowed } = useCanI('create', 'user.openshift.io', 'groups');
  const g = useGroupAction();
  const [name, setName] = React.useState('');
  const valid = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(name);
  return (
    <div className="flex items-center gap-1.5">
      <input aria-label="New group name" placeholder="new-group" value={name} onChange={(e) => setName(e.target.value.trim())}
        className="w-32 px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200" />
      <Button size="sm" disabled={!allowed || !valid} title={allowed ? undefined : 'You do not have permission to create groups'}
        onClick={() => g.action.open({ kind: 'create', name })}>
        <Plus className="w-3.5 h-3.5" /> Create group
      </Button>
      <GroupDialog {...g} />
    </div>
  );
}

export function GroupMemberControls({ group }: { group: GroupLike }) {
  const { allowed: canUpdate } = useCanI('patch', 'user.openshift.io', 'groups');
  const { allowed: canDelete } = useCanI('delete', 'user.openshift.io', 'groups');
  const g = useGroupAction();
  const [user, setUser] = React.useState('');
  const members = group.users ?? [];
  return (
    <div className="mt-2 ml-6 space-y-2">
      {members.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {members.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded-sm">
              {m}
              <button aria-label={`Remove ${m} from ${group.metadata.name}`} disabled={!canUpdate}
                onClick={() => g.action.open({ kind: 'remove', group, user: m })} className="text-slate-500 hover:text-red-400 disabled:opacity-40">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input aria-label={`User to add to ${group.metadata.name}`} placeholder="username" value={user} onChange={(e) => setUser(e.target.value.trim())}
          className="w-36 px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200" />
        <Button size="sm" variant="secondary" disabled={!canUpdate || !user || members.includes(user)}
          title={canUpdate ? undefined : 'You do not have permission to edit groups'}
          onClick={() => { g.action.open({ kind: 'add', group, user }); setUser(''); }}>
          Add member
        </Button>
        <Button size="sm" variant="ghost" disabled={!canDelete} aria-label={`Delete group ${group.metadata.name}`}
          title={canDelete ? undefined : 'You do not have permission to delete groups'}
          onClick={() => g.action.open({ kind: 'delete', group })}>
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </Button>
      </div>
      <GroupDialog {...g} />
    </div>
  );
}
