/**
 * "Remove all access for <subject>": every RoleBinding and ClusterRoleBinding
 * that names the subject, every Group it is a member of, and (for a User) the
 * sign-in objects, listed before anything is sent.
 *
 * Per binding the user picks: remove only this subject (a JSON patch that
 * `test`s the exact subject at its index first, so a concurrent edit is
 * refused rather than removing someone else), delete the whole binding, or
 * leave it. Every change is permission-checked as the viewer, dry-run first
 * (dryRun=All), sent to the cluster the dialog was opened on, and reported
 * per object. Taking away the viewer's own last cluster-admin path needs an
 * extra typed confirmation.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Dialog } from '../../components/primitives/Dialog';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { useCanI } from '../../hooks/useCanI';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { getActiveClusterId } from '../../engine/clusterConnection';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { k8sDelete, k8sFetch, k8sList, k8sPatch } from '../../engine/query';
import { JSON_PATCH } from '../../engine/workloadActions';
import { describeWriteError } from '../../components/ActionDialog';
import { PulseError } from '../../engine/errors';
import { useUIStore } from '../../store/uiStore';
import {
  bindingApiPath, bindingKey, clusterAdminPaths, removeGroupMemberPatch, removeSubjectsPatch,
  usernameOf,
  type AccessChain, type Membership, type RemovalPlan, type SubjectRef,
} from '../../engine/subjectAccess';
import type { SubjectData } from './SubjectAccessView';

export const SELF_LOCKOUT_PHRASE = 'remove my cluster-admin';

type BindingChoice = 'remove-subject' | 'delete-binding' | 'keep';

export interface Change {
  id: string;
  label: string;
  /** What the request is, in words, for the result list. */
  detail: string;
  method: 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  preconditions?: { uid?: string; resourceVersion?: string };
  /** Saved so the result can be undone by hand. */
  before?: unknown;
}

type Outcome = { state: 'ok' } | { state: 'failed'; message: string } | { state: 'skipped'; message: string };

interface UserObject { metadata: { name: string; uid?: string; resourceVersion?: string }; identities?: string[] }
interface TokenObject { metadata: { name: string; uid?: string }; userName?: string }

function is404(e: unknown) { return e instanceof PulseError && e.statusCode === 404; }

function withDryRun(path: string) { return `${path}${path.includes('?') ? '&' : '?'}dryRun=All`; }

async function send(c: Change, clusterId: string, dryRun: boolean): Promise<void> {
  const path = dryRun ? withDryRun(c.path) : c.path;
  if (c.method === 'PATCH') { await k8sPatch(path, c.body, JSON_PATCH, clusterId); return; }
  await k8sDelete(path, clusterId, c.preconditions);
}

/** One permission-checked row; reports whether the viewer may make its change. */
function usePermission(verb: string, group: string, resource: string, namespace?: string) {
  const { allowed, isLoading } = useCanI(verb, group, resource, namespace);
  return { allowed: allowed === true, checking: isLoading };
}

function BindingRow({ chain, subject, choice, onChoice, onPermission }: {
  chain: AccessChain; subject: SubjectRef; choice: BindingChoice; onChoice: (c: BindingChoice) => void;
  onPermission: (id: string, ok: boolean) => void;
}) {
  const b = chain.binding;
  const resource = b.kind === 'ClusterRoleBinding' ? 'clusterrolebindings' : 'rolebindings';
  const patch = usePermission('patch', 'rbac.authorization.k8s.io', resource, b.namespace);
  const del = usePermission('delete', 'rbac.authorization.k8s.io', resource, b.namespace);
  const id = bindingKey(b);
  const allowedNow = choice === 'keep' || (choice === 'remove-subject' ? patch.allowed : del.allowed);
  React.useEffect(() => { onPermission(id, patch.checking || del.checking ? false : allowedNow); }, [id, allowedNow, patch.checking, del.checking, onPermission]);
  const others = chain.others.map((s) => s.name);
  const where = b.kind === 'ClusterRoleBinding' ? `ClusterRoleBinding ${b.name}` : `RoleBinding ${b.namespace}/${b.name}`;
  const name = `binding-${id}`;
  return (
    <li className="py-2" data-testid={`row-${id}`}>
      <div className="text-xs text-slate-200"><span className="font-mono">{where}</span> → {b.roleRef.name} · {others.length === 0 ? `${subject.name} is the only subject` : `also ${others.join(', ')}`}</div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-300" role="radiogroup" aria-label={`What to do with ${where}`}>
        <label className="flex items-center gap-1"><input type="radio" name={name} checked={choice === 'remove-subject'} disabled={!patch.allowed} onChange={() => onChoice('remove-subject')} />
          Remove {subject.name} only ({others.length === 0 ? 'leaves an empty binding' : 'patches subjects'})</label>
        <label className="flex items-center gap-1"><input type="radio" name={name} checked={choice === 'delete-binding'} disabled={!del.allowed} onChange={() => onChoice('delete-binding')} />
          Delete binding{others.length ? ` (${others.join(', ')} lose ${b.roleRef.name} too)` : ''}</label>
        <label className="flex items-center gap-1"><input type="radio" name={name} checked={choice === 'keep'} onChange={() => onChoice('keep')} /> Leave unchanged</label>
      </div>
      {!patch.checking && !del.checking && (!patch.allowed || !del.allowed) && (
        <p className="mt-0.5 text-xs text-amber-300">
          {!patch.allowed && !del.allowed ? `You can't change ${resource}${b.namespace ? ` in ${b.namespace}` : ''}; this one is left unchanged.`
            : !patch.allowed ? `You can't patch ${resource}${b.namespace ? ` in ${b.namespace}` : ''}; only deleting is possible.`
              : `You can't delete ${resource}${b.namespace ? ` in ${b.namespace}` : ''}; only removing the subject is possible.`}
        </p>
      )}
    </li>
  );
}

function CheckRow({ id, checked, onChange, label, note, perm, onPermission }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string; note?: string;
  perm: [verb: string, group: string, resource: string]; onPermission: (id: string, ok: boolean) => void;
}) {
  const p = usePermission(...perm);
  const ok = !checked || p.allowed;
  React.useEffect(() => { onPermission(id, p.checking ? false : ok); }, [id, ok, p.checking, onPermission]);
  return (
    <li className="py-1.5 text-xs" data-testid={`row-${id}`}>
      <label className="flex items-center gap-2 text-slate-200">
        <input type="checkbox" checked={checked && p.allowed} disabled={!p.allowed} onChange={(e) => onChange(e.target.checked)} />
        {label}{note && <span className="text-slate-500">{note}</span>}
      </label>
      {!p.checking && !p.allowed && <p className="ml-5 text-amber-300">You can't {perm[0]} {perm[2]}; left unchanged.</p>}
    </li>
  );
}

export function RemoveAccessDialog({ subject, data, chains, memberships, userObject, userObjectError, onClose }: {
  subject: SubjectRef; data: SubjectData; chains: AccessChain[]; memberships: Membership[];
  userObject: UserObject | null; userObjectError?: unknown; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const activeClusterId = useActiveClusterId();
  // Pinned when the dialog opened: switching clusters must not retarget it.
  const [clusterId] = React.useState(() => getActiveClusterId());
  const username = usernameOf(subject);

  const [choices, setChoices] = React.useState<Record<string, BindingChoice>>(() => Object.fromEntries(
    chains.map((c) => [bindingKey(c.binding), c.others.length === 0 ? 'delete-binding' : 'remove-subject']),
  ));
  const removableGroups = React.useMemo(() => memberships.filter((m) => m.removable), [memberships]);
  const [leaveGroups, setLeaveGroups] = React.useState<Record<string, boolean>>(() => Object.fromEntries(removableGroups.map((m) => [m.group, true])));
  const [deleteUser, setDeleteUser] = React.useState(true);
  const [deleteIdentities, setDeleteIdentities] = React.useState(true);
  const [deleteTokens, setDeleteTokens] = React.useState(true);
  const [permOk, setPermOk] = React.useState<Record<string, boolean>>({});
  const onPermission = React.useCallback((id: string, ok: boolean) => setPermOk((p) => (p[id] === ok ? p : { ...p, [id]: ok })), []);
  const [typed, setTyped] = React.useState('');
  const [selfTyped, setSelfTyped] = React.useState('');
  const [phase, setPhase] = React.useState<'review' | 'dry-run' | 'applying' | 'done'>('review');
  const [dryResults, setDryResults] = React.useState<Record<string, Outcome>>({});
  const [results, setResults] = React.useState<Record<string, Outcome>>({});
  const [error, setError] = React.useState<string | null>(null);

  // Sign-in objects (User subjects): OAuth access tokens for this user.
  const tokensQ = useQuery({
    queryKey: ['subject-access', 'tokens', clusterId, subject.name],
    enabled: subject.kind === 'User',
    queryFn: async () => {
      try {
        const all = await k8sList<TokenObject>('/apis/oauth.openshift.io/v1/oauthaccesstokens', undefined, clusterId);
        return all.filter((t) => t.userName === subject.name);
      } catch (e) { if (is404(e)) return []; throw e; }
    },
  });
  // Who is running this, for the self-lockout check.
  const meQ = useQuery({
    queryKey: ['subject-access', 'me', clusterId],
    queryFn: async () => {
      const res = await k8sFetch(clusterId, '/apis/user.openshift.io/v1/users/~');
      if (!res.ok) throw new Error(`Could not read your own user (${res.status})`);
      return (await res.json()) as { metadata: { name: string }; groups?: string[] };
    },
  });

  const identities = React.useMemo(() => userObject?.identities ?? [], [userObject]);
  const tokens = React.useMemo(() => tokensQ.data ?? [], [tokensQ.data]);

  const changes: Change[] = React.useMemo(() => {
    const out: Change[] = [];
    for (const c of chains) {
      const id = bindingKey(c.binding);
      const choice = choices[id];
      const b = c.binding;
      const where = b.kind === 'ClusterRoleBinding' ? `ClusterRoleBinding ${b.name}` : `RoleBinding ${b.namespace}/${b.name}`;
      if (choice === 'remove-subject') {
        out.push({ id, label: `Remove ${subject.name} from ${where}`, detail: 'JSON patch: test then remove the subject at its index', method: 'PATCH', path: bindingApiPath(b), body: removeSubjectsPatch(b.subjects, c.indexes), before: b });
      } else if (choice === 'delete-binding') {
        out.push({ id, label: `Delete ${where}`, detail: 'Delete, only if unchanged since read', method: 'DELETE', path: bindingApiPath(b), preconditions: { uid: b.uid, resourceVersion: b.resourceVersion }, before: b });
      }
    }
    for (const m of removableGroups) {
      if (!leaveGroups[m.group] || m.index === undefined) continue;
      out.push({ id: `group/${m.group}`, label: `Remove ${username} from Group ${m.group}`, detail: 'JSON patch: test then remove the member at its index', method: 'PATCH', path: `/apis/user.openshift.io/v1/groups/${encodeURIComponent(m.group)}`, body: removeGroupMemberPatch(username, m.index), before: { group: m.group, users: m.members } });
    }
    if (subject.kind === 'User' && userObject && deleteUser) {
      out.push({ id: 'user', label: `Delete User ${subject.name}`, detail: 'Delete the User object', method: 'DELETE', path: `/apis/user.openshift.io/v1/users/${encodeURIComponent(subject.name)}`, preconditions: userObject.metadata.uid ? { uid: userObject.metadata.uid } : undefined, before: userObject });
    }
    if (subject.kind === 'User' && deleteIdentities) {
      for (const i of identities) out.push({ id: `identity/${i}`, label: `Delete Identity ${i}`, detail: 'Delete the Identity object', method: 'DELETE', path: `/apis/user.openshift.io/v1/identities/${encodeURIComponent(i)}` });
    }
    if (subject.kind === 'User' && deleteTokens) {
      for (const t of tokens) out.push({ id: `token/${t.metadata.name}`, label: `Delete OAuth access token ${t.metadata.name.slice(0, 12)}…`, detail: 'Signs this session out', method: 'DELETE', path: `/apis/oauth.openshift.io/v1/oauthaccesstokens/${encodeURIComponent(t.metadata.name)}`, preconditions: t.metadata.uid ? { uid: t.metadata.uid } : undefined });
    }
    return out;
  }, [chains, choices, removableGroups, leaveGroups, subject, username, userObject, deleteUser, deleteIdentities, deleteTokens, identities, tokens]);

  // Rows report their permission; a change whose row is not (yet) known to be allowed is not sent.
  const rowIdOf = (c: Change) => (c.id.startsWith('identity/') ? 'identities' : c.id.startsWith('token/') ? 'tokens' : c.id);
  const blocked = changes.filter((c) => permOk[rowIdOf(c)] !== true);
  const sendable = changes.filter((c) => permOk[rowIdOf(c)] === true);

  // Self-lockout: does this take away the viewer's last cluster-admin path?
  const plan: RemovalPlan = React.useMemo(() => ({
    subject,
    deletedBindings: new Set(sendable.filter((c) => c.method === 'DELETE' && c.path.includes('/clusterrolebindings/')).map((c) => c.id)),
    removedSubjects: new Map(chains.filter((c) => choices[bindingKey(c.binding)] === 'remove-subject' && sendable.some((s) => s.id === bindingKey(c.binding))).map((c) => [bindingKey(c.binding), c.indexes])),
    leftGroups: new Set(removableGroups.filter((m) => leaveGroups[m.group] && sendable.some((s) => s.id === `group/${m.group}`)).map((m) => m.group)),
  }), [subject, sendable, chains, choices, removableGroups, leaveGroups]);
  const me = meQ.data;
  const touchesClusterAdmin = chains.some((c) => c.binding.kind === 'ClusterRoleBinding' && c.binding.roleRef.name === 'cluster-admin' && choices[bindingKey(c.binding)] !== 'keep');
  const selfBefore = me ? clusterAdminPaths(me.metadata.name, me.groups ?? [], data.crbs) : null;
  const selfAfter = me ? clusterAdminPaths(me.metadata.name, me.groups ?? [], data.crbs, plan) : null;
  const selfLockout = me ? (selfBefore ?? 0) > 0 && selfAfter === 0 : touchesClusterAdmin;

  const confirmName = subject.name;
  const ready = sendable.length > 0 && typed === confirmName && (!selfLockout || selfTyped === SELF_LOCKOUT_PHRASE) && phase === 'review';

  const run = async () => {
    setError(null);
    try {
      assertActiveCluster(clusterId, `Removing access for ${subject.name}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    setPhase('dry-run');
    const dry: Record<string, Outcome> = {};
    for (const c of sendable) {
      try { await send(c, clusterId, true); dry[c.id] = { state: 'ok' }; } catch (e) { dry[c.id] = { state: 'failed', message: describeWriteError(e) }; }
    }
    setDryResults(dry);
    const refused = Object.values(dry).filter((o) => o.state === 'failed').length;
    if (refused > 0) {
      setError(`The dry run refused ${refused} of ${sendable.length} changes, so nothing was changed. Fix or leave out those objects and try again.`);
      setPhase('review');
      return;
    }
    setPhase('applying');
    const out: Record<string, Outcome> = {};
    for (const c of sendable) {
      try {
        assertActiveCluster(clusterId, `Removing access for ${subject.name}`);
        await send(c, clusterId, false);
        out[c.id] = { state: 'ok' };
      } catch (e) { out[c.id] = { state: 'failed', message: describeWriteError(e) }; }
      setResults({ ...out });
    }
    setPhase('done');
    queryClient.invalidateQueries({ queryKey: ['subject-access'] });
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
    const failed = Object.values(out).filter((o) => o.state === 'failed').length;
    addToast(failed
      ? { type: 'error', title: `${sendable.length - failed} of ${sendable.length} changes made`, detail: `${failed} failed; see the dialog` }
      : { type: 'success', title: `Access removed for ${subject.name}`, detail: `${sendable.length} changes` });
  };

  const downloadBefore = () => {
    const blob = new Blob([JSON.stringify(sendable.filter((c) => c.before).map((c) => ({ change: c.label, before: c.before })), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `previous-${subject.name}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const busy = phase === 'dry-run' || phase === 'applying';
  const clusterChanged = activeClusterId !== clusterId;
  const outcomeOf = (c: Change) => results[c.id] ?? (phase === 'done' ? undefined : dryResults[c.id]);

  return (
    <Dialog
      open
      size="2xl"
      onClose={onClose}
      dismissible={!busy}
      title={`Remove all access for ${subject.name}?`}
      description={`${changes.length} change${changes.length === 1 ? '' : 's'} · cluster ${clusterId} · found by scanning every RoleBinding, ClusterRoleBinding and Group you can read${me ? ` · you are acting as ${me.metadata.name}` : ''}`}
      footer={phase === 'done' ? (
        <>
          <Button variant="secondary" onClick={downloadBefore}>Download previous versions</Button>
          <Button onClick={onClose}>Close</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void run()} disabled={!ready || clusterChanged} loading={busy}>
            Remove access ({sendable.length} change{sendable.length === 1 ? '' : 's'})
          </Button>
        </>
      )}
    >
      <div className="space-y-4 text-xs">
        {clusterChanged && <p role="alert" className="text-amber-300">The active cluster changed since this dialog opened; nothing will be sent to {activeClusterId}.</p>}
        <section>
          <h3 className="font-semibold text-slate-300">Bindings that name {subject.name}</h3>
          {chains.length === 0 ? <p className="text-slate-500 mt-1">None.</p> : (
            <ul className="divide-y divide-slate-800">
              {chains.map((c) => (
                <BindingRow key={bindingKey(c.binding)} chain={c} subject={subject} choice={choices[bindingKey(c.binding)]}
                  onChoice={(v) => setChoices((x) => ({ ...x, [bindingKey(c.binding)]: v }))} onPermission={onPermission} />
              ))}
            </ul>
          )}
        </section>

        {subject.kind !== 'Group' && (
          <section>
            <h3 className="font-semibold text-slate-300">Group memberships</h3>
            {removableGroups.length === 0 ? <p className="text-slate-500 mt-1">No Group object lists {username}.</p> : (
              <ul>
                {removableGroups.map((m) => (
                  <CheckRow key={m.group} id={`group/${m.group}`} checked={!!leaveGroups[m.group]} onChange={(v) => setLeaveGroups((x) => ({ ...x, [m.group]: v }))}
                    label={`Remove ${subject.name} from ${m.group}`} note={` · ${(m.members?.length ?? 1) - 1} other member${(m.members?.length ?? 1) - 1 === 1 ? '' : 's'} keep it`}
                    perm={['patch', 'user.openshift.io', 'groups']} onPermission={onPermission} />
                ))}
              </ul>
            )}
          </section>
        )}

        {subject.kind === 'User' && (
          <section>
            <h3 className="font-semibold text-slate-300">Sign-in objects to delete</h3>
            <ul>
              {userObjectError ? <li className="text-red-300">The User object could not be read: {userObjectError instanceof Error ? userObjectError.message : String(userObjectError)}</li>
                : userObject ? <CheckRow id="user" checked={deleteUser} onChange={setDeleteUser} label={`Delete User ${subject.name}`} perm={['delete', 'user.openshift.io', 'users']} onPermission={onPermission} />
                  : <li className="text-slate-500">No User object.</li>}
              {identities.length > 0 && <CheckRow id="identities" checked={deleteIdentities} onChange={setDeleteIdentities} label={`Delete Identity ${identities.join(', ')}`} perm={['delete', 'user.openshift.io', 'identities']} onPermission={onPermission} />}
              {tokensQ.isError ? <li className="text-red-300">OAuth access tokens could not be listed, so sessions are not ended: {tokensQ.error instanceof Error ? tokensQ.error.message : String(tokensQ.error)}</li>
                : tokensQ.isLoading ? <li className="text-slate-500">Checking sessions…</li>
                  : tokens.length > 0 && <CheckRow id="tokens" checked={deleteTokens} onChange={setDeleteTokens} label={`Delete ${tokens.length} OAuth access token${tokens.length === 1 ? '' : 's'}`} note=" · signs them out everywhere now" perm={['delete', 'oauth.openshift.io', 'oauthaccesstokens']} onPermission={onPermission} />}
            </ul>
          </section>
        )}

        <section aria-label="What this does not cover" className="rounded border border-slate-800 bg-slate-950/50 p-3 space-y-1 text-slate-400">
          <h3 className="font-semibold text-slate-300">What this does not cover</h3>
          {data.failed.map((f) => <p key={f.what} className="text-amber-300">Could not check {f.what}: {f.error instanceof Error ? f.error.message : String(f.error)}. Bindings there are not listed or changed.</p>)}
          {memberships.filter((m) => !m.removable).length > 0 && (
            <p>Access every {subject.kind === 'ServiceAccount' ? 'service account' : 'signed-in user'} has ({memberships.filter((m) => !m.removable).map((m) => m.group).join(', ')}) stays; those groups are added by the API server.</p>
          )}
          {subject.kind === 'User' && identities.length > 0 && (
            <p>{subject.name} can still sign in through {identities.map((i) => i.split(':')[0]).join(', ')} and gets a new User with only the defaults. Disable the account in the identity provider to stop that.</p>
          )}
          {subject.kind === 'ServiceAccount' && <p>The ServiceAccount is not deleted; pods running as it keep running with whatever access remains.</p>}
          {meQ.isError && touchesClusterAdmin && <p className="text-amber-300">Could not read your own user, so Pulse cannot tell whether this removes your own cluster-admin access.</p>}
        </section>

        {blocked.length > 0 && phase === 'review' && (
          <p className="text-slate-400">{blocked.length} change{blocked.length === 1 ? ' is' : 's are'} not sent: permission still checking or denied.</p>
        )}

        <section>
          <h3 className="font-semibold text-slate-300">Dry run and undo</h3>
          <p className="text-slate-400 mt-1">Every change is sent with dryRun=All first; if the server refuses any, nothing is changed. Each binding and group is kept as it was before the change: download it after the run to restore by hand. Users, Identities and tokens can't be restored (a new User is created at the next sign-in).</p>
        </section>

        {(phase !== 'review' || Object.keys(dryResults).length > 0) && (
          <section aria-label="Results">
            <h3 className="font-semibold text-slate-300">{phase === 'done' ? 'Results' : phase === 'applying' ? 'Applying…' : phase === 'dry-run' ? 'Dry run…' : 'Dry run'}</h3>
            <ul className="mt-1 space-y-0.5">
              {sendable.map((c) => {
                const o = outcomeOf(c);
                return (
                  <li key={c.id} className="flex items-start gap-1.5" data-testid={`result-${c.id}`}>
                    {!o ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" aria-hidden />
                      : o.state === 'ok' ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
                        : <XCircle className="w-3.5 h-3.5 text-red-400" aria-hidden />}
                    <span className="text-slate-300">{c.label}</span>
                    {o && o.state !== 'ok' && <span className="text-red-300">— {o.message}</span>}
                    {o?.state === 'ok' && phase !== 'done' && !results[c.id] && <span className="text-slate-500">— admitted</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {phase === 'review' && (
          <section className="space-y-2">
            {selfLockout && (
              <div role="alert" className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-red-200">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="w-3.5 h-3.5" /> {me ? 'This removes your own last cluster-admin access.' : 'This changes a cluster-admin binding and Pulse could not check whether it is your own last one.'}</p>
                <p className="mt-0.5">You would no longer be able to undo it yourself. Type <code className="font-mono">{SELF_LOCKOUT_PHRASE}</code> to go ahead.</p>
                <input aria-label="Type the phrase to remove your own cluster-admin" value={selfTyped} onChange={(e) => setSelfTyped(e.target.value)} className="mt-1 w-full px-2 py-1 bg-slate-900 border border-red-800 rounded-sm text-slate-200" />
              </div>
            )}
            <label className="block text-slate-400">Type <span className="font-mono text-slate-200">{confirmName}</span> to confirm
              <input aria-label={`Type ${confirmName} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded-sm text-slate-200" />
            </label>
          </section>
        )}
        {error && <LoadError title={error} />}
      </div>
    </Dialog>
  );
}
