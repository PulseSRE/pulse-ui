/**
 * Access review › RBAC changes: edits, creations and deletions of Roles,
 * ClusterRoles, bindings, SCCs and admission webhooks, each with a diff
 * against the version before it and "Restore previous".
 *
 * The history is the agent's own observation (engine/rbacHistory); the page
 * says so and says what it cannot know (who made a change outside Pulse,
 * edits between two observations, anything before the first one). An agent
 * without the endpoint gets the old creation-time list, labelled as such.
 *
 * Restore runs as the signed-in user: it reads the live object, shows the
 * exact change (live → restored), dry-runs it, then writes it conditional on
 * the live resourceVersion so a change made in between is refused. The user
 * needs update (or create) permission on the object, and the API server's
 * escalation check still applies: restoring a Role that grants more than the
 * user holds is refused.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, History, RotateCcw, AlertTriangle } from 'lucide-react';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useCanI } from '../../hooks/useCanI';
import { useFleetStore } from '../../store/fleetStore';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { useActionDialog } from '../../components/ActionDialog';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { k8sFetch } from '../../engine/query';
import { parseK8sErrorResponse, PulseError } from '../../engine/errors';
import { formatRelative, formatTimestamp } from '../../engine/format';
import { cn } from '@/lib/utils';
import {
  RBAC_KINDS, compactDiff, comparable, escalationOnRestore, fetchRbacHistory, lineDiff, objectPath, recordLedger, restoreRequest,
  type RbacChange,
} from '../../engine/rbacHistory';

async function sendJson(clusterId: string, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await k8sFetch(clusterId, path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw await parseK8sErrorResponse(res, { operation: method === 'GET' ? 'get' : method === 'PUT' ? 'update' : 'create', apiPath: path });
  return res.json();
}

function Diff({ before, after, label }: { before: unknown; after: unknown; label: string }) {
  const lines = lineDiff(before, after);
  if (!lines) return <p className="text-xs text-slate-500">Too large to diff here.</p>;
  const shown = compactDiff(lines);
  if (!lines.some((l) => l.op !== ' ')) return <p className="text-xs text-slate-500">No difference.</p>;
  return (
    <pre aria-label={label} className="mt-1 max-h-72 overflow-auto rounded bg-slate-950 p-2 text-[11px] leading-4 font-mono">
      {shown.map((l, i) => (
        <div key={i} className={cn(l.op === '+' ? 'text-emerald-300 bg-emerald-950/30' : l.op === '-' ? 'text-red-300 bg-red-950/30' : l.op === '…' ? 'text-slate-600 italic' : 'text-slate-400')}>
          {l.op === '…' ? `  … ${l.text}` : `${l.op} ${l.text}`}
        </div>
      ))}
    </pre>
  );
}

function who(c: RbacChange): string {
  // The agent credits a Pulse write only when its resourceVersion is this version's.
  if (c.actor) return `by ${c.actor.name} via Pulse${c.actor.source === 'agent' ? ' (agent)' : ''}${c.actor.verified === false ? ' (identity from the login proxy, not verified)' : ''}`;
  return c.manager ? `by client ${c.manager} (person unknown)` : 'by an unknown client';
}

function ChangeRow({ change, onRestored }: { change: RbacChange; onRestored: () => void }) {
  const clusterId = useActiveClusterId();
  const [open, setOpen] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const [readError, setReadError] = React.useState<unknown>(null);
  const k = RBAC_KINDS[change.kind];
  const ns = k?.namespaced ? change.namespace : undefined;
  const { allowed: canUpdate, isLoading: l1 } = useCanI('update', k?.group ?? '', k?.plural ?? '', ns);
  const { allowed: canCreate, isLoading: l2 } = useCanI('create', k?.group ?? '', k?.plural ?? '', ns);
  const { open: openDialog, dialog } = useActionDialog();
  const where = `${change.kind} ${change.namespace ? `${change.namespace}/` : ''}${change.name}`;
  const restorable = !!k && change.change !== 'created' && !!change.before;

  const review = async () => {
    setReadError(null); setReading(true);
    try {
      let live: Record<string, unknown> | null = null;
      try { live = await sendJson(clusterId, 'GET', objectPath(change.kind, change.namespace, change.name)); } catch (e) { if (!(e instanceof PulseError && e.statusCode === 404)) throw e; }
      const req = restoreRequest(change, live);
      let adminRoles = new Set<string>();
      if (change.kind === 'RoleBinding' || change.kind === 'ClusterRoleBinding') {
        // Custom all-powerful roles (*/*/*) count as cluster-admin; unreadable roles: only the built-in names.
        try {
          const roles = await sendJson(clusterId, 'GET', '/apis/rbac.authorization.k8s.io/v1/clusterroles');
          for (const r of (roles.items ?? []) as Array<{ metadata: { name: string }; rules?: Array<{ verbs?: string[]; apiGroups?: string[]; resources?: string[] }> }>) {
            if ((r.rules ?? []).some((x) => (x.verbs ?? []).includes('*') && (x.apiGroups ?? []).includes('*') && (x.resources ?? []).includes('*'))) adminRoles.add(r.metadata.name);
          }
        } catch { adminRoles = new Set(); }
      }
      const adds = escalationOnRestore(change.kind, live, req.body, adminRoles);
      if (req.method === 'PUT' ? !canUpdate : !canCreate) {
        setReadError(`You do not have permission to ${req.method === 'PUT' ? 'update' : 'create'} ${k.plural}${ns ? ` in ${ns}` : ''}.`);
        return;
      }
      openDialog({
        title: `Restore ${where} to the version before ${formatTimestamp(change.observed_at)}?`,
        description: live
          ? `Replaces the current ${change.kind} with the version Pulse observed before this change. Anything changed since is replaced too; the diff below is the exact change.`
          : `${where} no longer exists. Re-creates it from the version Pulse observed before it was deleted (without ownerReferences, which may name an owner that is gone).`,
        confirmLabel: 'Restore',
        variant: 'danger',
        what: `Restoring ${where}`,
        inputs: [
          { id: 'reason', label: 'Reason (saved in the Pulse write ledger)', initial: '', validate: (v) => (v.trim() ? null : 'A reason is required') },
          ...(adds.length ? [{ id: 'confirm', label: `Type ${change.name} to grant this`, initial: '', validate: (v: string) => (v === change.name ? null : `Type ${change.name} exactly`) }] : []),
        ],
        body: (
          <>
            {adds.length > 0 && (
              <div role="alert" data-testid="restore-escalation" className="mt-3 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                <p className="font-medium">This restore grants or weakens more than the current version:</p>
                <ul className="mt-1 list-disc ml-4">{adds.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            )}
            <Diff before={comparable(live)} after={comparable(req.body)} label="Change on restore" />
            <p className="mt-2 text-xs text-slate-400">
              {req.method === 'PUT' ? 'PUT, conditional on the current resourceVersion (refused if it changes before you confirm)' : 'POST'} as you, dry run first.
              Your own permissions apply, including the API server&apos;s check that you hold every permission a Role grants.
              Undo: restore again from this list, or re-apply the current version shown in red above.
            </p>
          </>
        ),
        run: async (cid, values) => {
          await sendJson(cid, req.method, `${req.path}?dryRun=All`, req.body);
          const out = await sendJson(cid, req.method, req.path, req.body);
          const rv = String((out.metadata as { resourceVersion?: string } | undefined)?.resourceVersion ?? '');
          const recorded = await recordLedger({ verb: req.method === 'PUT' ? 'update' : 'create', kind: change.kind, namespace: change.namespace, name: change.name, resource_version: rv, reason: values.reason.trim(), before: comparable(live), after: comparable(req.body) });
          if (recorded !== 'recorded') setReadError(recorded === 'absent' ? 'Restored. This Pulse agent has no write ledger, so the restore was not recorded there.' : 'Restored, but recording it in the Pulse write ledger failed.');
          return out;
        },
        success: `${where} restored`,
        onDone: onRestored,
      });
    } catch (e) {
      setReadError(e);
    } finally {
      setReading(false);
    }
  };

  return (
    <li className="px-4 py-3 text-xs" data-testid={`rbac-change-${change.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500 w-20 shrink-0" title={change.observed_at}>{formatRelative(change.observed_at)}</span>
          <span className="font-mono text-slate-200">{where}</span>
          <span className={cn('px-1.5 py-0.5 rounded-sm', change.change === 'deleted' ? 'bg-red-900/50 text-red-300' : change.change === 'created' ? 'bg-blue-900/50 text-blue-300' : 'bg-amber-900/50 text-amber-300')}>{change.change}</span>
          <span className="text-slate-400">{who(change)}</span>
          {change.actor?.reason && <span className="text-slate-500">· “{change.actor.reason}”</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide diff' : 'Diff'}</Button>
          {restorable && (
            <Button size="sm" variant="secondary" loading={reading} disabled={l1 || l2 || (!canUpdate && !canCreate)}
              title={!l1 && !l2 && !canUpdate && !canCreate ? `You do not have permission to change ${k.plural}` : undefined}
              onClick={() => void review()}>
              <RotateCcw className="w-3.5 h-3.5" /> Restore previous…
            </Button>
          )}
        </div>
      </div>
      {open && <Diff before={change.before} after={change.after} label={`Diff of ${where}`} />}
      {readError ? <LoadError className="mt-2" title={typeof readError === 'string' ? readError : `Could not prepare the restore of ${where}`} error={typeof readError === 'string' ? undefined : readError} /> : null}
      {dialog}
    </li>
  );
}

export function RbacChangeHistory({ fallback }: { fallback: React.ReactNode }) {
  const clusterId = useActiveClusterId();
  const remote = useFleetStore((s) => s.activeClusterId) !== LOCAL_CLUSTER_ID;
  const queryClient = useQueryClient();
  const [includeSystem, setIncludeSystem] = React.useState(false);
  // The agent's history is about the cluster it runs on, the local one.
  const q = useQuery({
    queryKey: ['rbac-history', clusterId, includeSystem],
    enabled: !remote,
    queryFn: () => fetchRbacHistory({ includeSystem }),
    staleTime: 30000,
  });

  if (remote) {
    return <>{fallback}<p className="text-xs text-slate-500" data-testid="rbac-history-local-only">RBAC change history is kept by the Pulse agent for the local cluster only.</p></>;
  }
  if (q.isLoading) return <Card className="p-4"><p className="text-xs text-slate-500">Loading RBAC change history…</p></Card>;
  if (q.isError) return <LoadError title="RBAC change history could not be loaded" error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data || q.data.state === 'absent') {
    return (
      <>
        <p className="text-xs text-amber-300 flex items-center gap-1.5" data-testid="rbac-history-absent">
          <AlertTriangle className="w-3.5 h-3.5" /> This Pulse agent does not keep RBAC change history, so only new bindings are listed below (by creation time). Edits, SCC and webhook changes are not shown and cannot be restored.
        </p>
        {fallback}
      </>
    );
  }
  const data = q.data.data;
  const h = data.history;
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><History className="w-4 h-4 text-slate-400" /> RBAC changes
          <span className="text-xs font-normal text-slate-500">last 7 days · roles, bindings, SCCs, webhooks</span>
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-slate-400"><input type="checkbox" checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)} /> Include platform objects{!includeSystem && data.system_hidden > 0 ? ` (${data.system_hidden} hidden)` : ''}</label>
      </div>
      {data.changes.length === 0 ? (
        <p className="p-4 text-xs text-slate-400" data-testid="rbac-history-empty">
          {!h.since || !h.last_observed_at ? 'Not observed yet: the agent records RBAC changes on its audit scans and has not completed one.'
            : h.last_error ? `Could not check: the last observation failed (${h.last_error}).`
              : `No changes observed in the last 7 days${!includeSystem ? ' outside platform objects' : ''}.`}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800" aria-label="RBAC changes">
          {data.changes.map((c) => <ChangeRow key={c.id} change={c} onRestored={() => { void queryClient.invalidateQueries({ queryKey: ['rbac-history'] }); }} />)}
        </ul>
      )}
      <div className="px-4 py-3 border-t border-slate-800 space-y-1 text-xs text-slate-500" data-testid="rbac-history-coverage">
        <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />
          Observed by the Pulse agent{h.since ? ` since ${formatTimestamp(h.since)}` : ''}{h.last_observed_at ? `, last checked ${formatRelative(h.last_observed_at)}` : ''}: several edits between two checks show as one, and nothing before the first check is known.
          Who made a change is known only for changes made through Pulse; otherwise the client name is shown. Pulse does not read the API server audit log.
        </p>
        {h.last_error && <p className="text-amber-300">The last observation failed: {h.last_error}. Recent changes may be missing.</p>}
        {h.unwatched.length > 0 && <p className="text-amber-300">Not watched: {h.unwatched.map((u) => `${u.kind} (${u.reason})`).join(', ')}. The agent&apos;s service account cannot list them, so their changes are not recorded.</p>}
        {data.truncated && <p className="text-amber-300" data-testid="rbac-history-truncated">More changes matched than are shown; only the newest are listed.</p>}
        {data.hidden > 0 && <p>{data.hidden} change{data.hidden === 1 ? ' is' : 's are'} hidden because you cannot read those objects.</p>}
      </div>
    </Card>
  );
}
