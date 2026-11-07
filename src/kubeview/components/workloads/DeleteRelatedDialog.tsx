/**
 * Delete a workload with the objects that exist only for it.
 *
 * Lists what would otherwise be left behind (engine/relatedObjects) with a
 * choice per object: shared objects are kept and cannot be chosen, PVCs are
 * not chosen by default and say how much data is lost, and a kind Pulse
 * could not read is named as not checked. The user types the workload's name;
 * every chosen object is dry-run first, then deleted workload-first with a
 * result per object. A Helm-owned workload first points to the release
 * uninstall, since the next upgrade would recreate it.
 */
import React from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, MinusCircle, Download, Ship } from 'lucide-react';
import { Dialog } from '../primitives/Dialog';
import { LoadError } from '../primitives/LoadError';
import { Input } from '../primitives/Input';
import { k8sFetch, k8sGet, k8sList } from '../../engine/query';
import { PulseError, parseK8sErrorResponse } from '../../engine/errors';
import { getActiveClusterId } from '../../engine/clusterConnection';
import { assertActiveCluster, clusterDisplayName } from '../../engine/pendingCluster';
import { describeWriteError } from '../ActionDialog';
import { useCanI } from '../../hooks/useCanI';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { apiPathOf } from '../../engine/workloadActions';
import { resourceToYaml } from '../../engine/yamlUtils';
import { helmReleasePath } from '../../engine/helmOwnership';
import { useHelmOwnership, HelmClaimNote } from '../HelmOwnership';
import { useArgoSyncInfo } from '../../hooks/useArgoCD';
import { useArgoCDStore } from '../../store/argoCDStore';
import { useServiceAccounts, useWorkloadsInNamespace } from '../../views/detail/ConfigConsumers';
import {
  KIND_LABEL, LISTED_KINDS, RELATED_SOURCES, computeRelated, type ListedKind, type RelatedCandidate, type RelatedKind,
} from '../../engine/relatedObjects';
import type { K8sResource } from '../../engine/renderers';

/** DELETE one object; "gone" when it no longer existed. */
export async function deleteObject(path: string, clusterId: string, opts: { uid?: string; dryRun?: boolean } = {}): Promise<'deleted' | 'gone'> {
  const res = await k8sFetch(clusterId, `${path}${opts.dryRun ? '?dryRun=All' : ''}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'DeleteOptions', apiVersion: 'v1', propagationPolicy: 'Background', ...(opts.uid ? { preconditions: { uid: opts.uid } } : {}) }),
  });
  if (res.status === 404) return 'gone';
  if (!res.ok) throw await parseK8sErrorResponse(res, { operation: 'delete', apiPath: path });
  return 'deleted';
}

function useDeleteAllowed(kind: RelatedKind, ns: string, enabled: boolean) {
  const src = RELATED_SOURCES[kind];
  return useCanI('delete', src.group, src.plural, ns, undefined, { enabled });
}

interface Result { label: string; status: 'deleted' | 'gone' | 'failed' | 'skipped'; message?: string }

function readFailure(err: unknown, kind: RelatedKind, ns: string): string {
  if (err instanceof PulseError && err.statusCode === 403) return `you cannot list ${KIND_LABEL[kind]} in ${ns}`;
  return err instanceof Error ? err.message : String(err);
}

const PARTIAL_METADATA = 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1';

/** List ConfigMaps or Secrets metadata-only: uid, labels, owners — never data. */
async function listMetadata(path: string, clusterId: string): Promise<K8sResource[]> {
  const res = await k8sFetch(clusterId, path, { headers: { Accept: PARTIAL_METADATA } });
  if (!res.ok) throw await parseK8sErrorResponse(res, { operation: 'list', apiPath: path });
  const data = await res.json() as { items?: K8sResource[] };
  return data.items ?? [];
}

export function DeleteRelatedDialog({ workload, workloadRbac, onClose, onCancel, onDeleted, queueNote }: {
  workload: K8sResource;
  /** Group/plural of the workload, for its own delete permission. */
  workloadRbac: { group: string; plural: string };
  /** Called when the dialog closes after it ran (or with nothing run, when no onCancel is given). */
  onClose: () => void;
  /** Cancel, Escape or X before anything ran (default: onClose). */
  onCancel?: () => void;
  onDeleted?: () => void;
  /** e.g. "1 of 3" when several workloads are deleted one after another. */
  queueNote?: string;
}) {
  const [clusterId] = React.useState(() => getActiveClusterId());
  const go = useNavigateTab();
  const ns = workload.metadata.namespace || '';
  const name = workload.metadata.name;
  const kind = workload.kind;
  // Helm-owned only if the release lists it; a copied or stale label is said, not obeyed.
  const helm = useHelmOwnership(workload, clusterId);
  const helmOwner = helm.owner;
  const helmRelease = { data: helm.release, isError: !!helm.releaseError };
  // Helm-owned: start on the "uninstall the release instead" step.
  const [stage, setStage] = React.useState<'helm' | 'choose'>(helm.claimed ? 'helm' : 'choose');
  const onlyWorkload = !!helmOwner;
  const controller = (workload.metadata.ownerReferences ?? []).find((o) => o.controller);
  const argoAvailable = useArgoCDStore((st) => st.available);
  const argo = useArgoSyncInfo(kind, ns, name);

  const wl = useWorkloadsInNamespace(ns, clusterId, !onlyWorkload);
  const listed = useQueries({
    queries: LISTED_KINDS.map((k) => ({
      queryKey: ['k8s', 'list', 'delete-related', k, ns, clusterId],
      queryFn: async () => {
        try {
          return await k8sList<K8sResource>(RELATED_SOURCES[k].base(ns), undefined, clusterId);
        } catch (err) {
          // Routes are an OpenShift API: not served means there are none.
          if (k === 'Route' && err instanceof PulseError && err.statusCode === 404) return [];
          throw err;
        }
      },
      enabled: !onlyWorkload && !!ns,
      retry: false,
    })),
  });
  const configMeta = useQueries({
    queries: (['ConfigMap', 'Secret'] as const).map((k) => ({
      queryKey: ['k8s', 'list', 'delete-related-meta', k, ns, clusterId],
      queryFn: () => listMetadata(RELATED_SOURCES[k].base(ns), clusterId),
      enabled: !onlyWorkload && !!ns,
      retry: false,
    })),
  });
  const sas = useServiceAccounts(ns, clusterId, !onlyWorkload);
  const pvcs = listed[LISTED_KINDS.indexOf('PersistentVolumeClaim')].data ?? [];
  const volumeNames = [...new Set(pvcs.map((p) => (p.spec as { volumeName?: string } | undefined)?.volumeName).filter((v): v is string => !!v))];
  const pvs = useQueries({
    queries: volumeNames.map((v) => ({
      queryKey: ['k8s', 'get', 'delete-related-pv', v, clusterId],
      queryFn: () => k8sGet<K8sResource>(`/api/v1/persistentvolumes/${v}`, clusterId),
      retry: false,
    })),
  });
  const user = useQuery({
    queryKey: ['currentUser', clusterId],
    queryFn: async () => (await k8sGet<{ metadata?: { name?: string } }>('/apis/user.openshift.io/v1/users/~', clusterId)).metadata?.name ?? '',
    retry: false,
    staleTime: 5 * 60_000,
  });

  const canDeleteWorkload = useCanI('delete', workloadRbac.group, workloadRbac.plural, ns);
  const rbac: Record<RelatedKind, { allowed: boolean; isLoading: boolean }> = {
    Service: useDeleteAllowed('Service', ns, !onlyWorkload),
    Route: useDeleteAllowed('Route', ns, !onlyWorkload),
    HorizontalPodAutoscaler: useDeleteAllowed('HorizontalPodAutoscaler', ns, !onlyWorkload),
    PodDisruptionBudget: useDeleteAllowed('PodDisruptionBudget', ns, !onlyWorkload),
    NetworkPolicy: useDeleteAllowed('NetworkPolicy', ns, !onlyWorkload),
    ConfigMap: useDeleteAllowed('ConfigMap', ns, !onlyWorkload),
    Secret: useDeleteAllowed('Secret', ns, !onlyWorkload),
    PersistentVolumeClaim: useDeleteAllowed('PersistentVolumeClaim', ns, !onlyWorkload),
  };

  const loading = !onlyWorkload && (wl.loading || listed.some((q) => q.isLoading) || pvs.some((q) => q.isLoading) || configMeta.some((q) => q.isLoading) || sas.isLoading || helm.loading);
  // One value per read, so the memo below has a fixed number of dependencies.
  const listedKey = [...listed, ...configMeta, sas].map((q) => `${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join(',');
  const pvKey = pvs.map((q) => `${q.dataUpdatedAt}:${q.errorUpdatedAt}`).join(',');
  const related = React.useMemo(() => {
    if (onlyWorkload || loading) return null;
    const lists: Partial<Record<ListedKind, K8sResource[] | null>> = {};
    LISTED_KINDS.forEach((k, i) => { lists[k] = listed[i].isError ? null : (listed[i].data ?? []).map((r) => ({ ...r, kind: k })); });
    const reclaimPolicies: Record<string, string | null> = {};
    volumeNames.forEach((v, i) => { reclaimPolicies[v] = pvs[i]?.isError ? null : ((pvs[i]?.data?.spec as { persistentVolumeReclaimPolicy?: string } | undefined)?.persistentVolumeReclaimPolicy ?? null); });
    return computeRelated(workload, {
      workloads: wl.workloads,
      workloadsIncomplete: wl.failures.map((f) => `${f.kind}s`),
      lists,
      reclaimPolicies,
      configMeta: { ConfigMap: configMeta[0].isError ? null : configMeta[0].data ?? [], Secret: configMeta[1].isError ? null : configMeta[1].data ?? [] },
      serviceAccounts: sas.isError ? null : sas.data ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyWorkload, loading, workload, wl.workloads, wl.failures, listedKey, pvKey]);
  const readErrors = LISTED_KINDS.flatMap((k, i) => (listed[i].isError ? [{ kind: k as RelatedKind, error: listed[i].error }] : []));

  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const keyOf = (c: RelatedCandidate) => `${c.kind}/${c.name}`;
  // Defaults only for objects not seen yet: a refetch must not undo the user's choices.
  React.useEffect(() => {
    if (!related) return;
    setChecked((prev) => {
      const next = { ...prev };
      for (const c of related.candidates) if (!(keyOf(c) in next)) next[keyOf(c)] = c.defaultChecked && !c.keptReason;
      return next;
    });
  }, [related]);
  // Every delete carries a uid precondition. An object whose list could not
  // be read has no uid yet: read that one object's metadata first; if that
  // fails too, it cannot be chosen.
  const needUid = (related?.candidates ?? []).filter((c) => !c.keptReason && !c.byController && !c.resource?.metadata.uid);
  const uidReads = useQueries({
    queries: needUid.map((c) => ({
      queryKey: ['k8s', 'get', 'delete-related-uid', c.path, clusterId],
      queryFn: async () => {
        const res = await k8sFetch(clusterId, c.path, { headers: { Accept: 'application/json;as=PartialObjectMetadata;g=meta.k8s.io;v=v1' } });
        if (!res.ok) throw await parseK8sErrorResponse(res, { operation: 'get', apiPath: c.path });
        const m = await res.json() as { metadata?: { uid?: string } };
        if (!m.metadata?.uid) throw new Error('no uid returned');
        return m.metadata.uid;
      },
      retry: false,
    })),
  });
  const uidOf = (c: RelatedCandidate): string | undefined => {
    if (c.resource?.metadata.uid) return c.resource.metadata.uid;
    const i = needUid.findIndex((x) => keyOf(x) === keyOf(c));
    return i >= 0 ? uidReads[i]?.data : undefined;
  };
  const uidReason = (c: RelatedCandidate): string | undefined => {
    if (uidOf(c)) return undefined;
    const i = needUid.findIndex((x) => keyOf(x) === keyOf(c));
    if (i >= 0 && uidReads[i]?.isLoading) return 'Checking…';
    return 'Could not check: its uid could not be read, so Pulse will not delete it';
  };
  const deniedReason = (c: RelatedCandidate) => (rbac[c.kind].isLoading ? 'Checking permission…' : !rbac[c.kind].allowed ? `You cannot delete ${KIND_LABEL[c.kind]} in ${ns}` : (c.keptReason || c.byController ? undefined : uidReason(c)));
  const chosen = (related?.candidates ?? []).filter((c) => checked[keyOf(c)] && !c.keptReason && !c.byController && !deniedReason(c) && !!uidOf(c));
  const keptPvcs = (related?.candidates ?? []).filter((c) => c.kind === 'PersistentVolumeClaim' && !c.byController && (!checked[keyOf(c)] || !!c.keptReason));
  const retainedByPolicy = (related?.candidates ?? []).filter((c) => c.byController);

  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Result[] | null>(null);

  const workloadPath = apiPathOf(workload);
  const cancel = onCancel ?? onClose;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      assertActiveCluster(clusterId, `Deleting ${kind} "${name}"`);
      // Dry run everything first: nothing is deleted unless all of it would be.
      const failures: string[] = [];
      for (const [label, path, uid] of [[`${kind} ${name}`, workloadPath, workload.metadata.uid], ...chosen.map((c) => [`${c.kind} ${c.name}`, c.path, uidOf(c)])] as Array<[string, string, string | undefined]>) {
        if (!uid) { failures.push(`${label}: its uid is unknown`); continue; }
        try { await deleteObject(path, clusterId, { uid, dryRun: true }); } catch (err) { failures.push(`${label}: ${describeWriteError(err)}`); }
      }
      if (failures.length) throw new Error(`The dry run failed, so nothing was deleted. ${failures.join('; ')}`);
      assertActiveCluster(clusterId, `Deleting ${kind} "${name}"`);
      const out: Result[] = [];
      try {
        const r = await deleteObject(workloadPath, clusterId, { uid: workload.metadata.uid });
        out.push({ label: `${kind} ${name}`, status: r });
      } catch (err) {
        // The workload stays, so its objects stay too.
        out.push({ label: `${kind} ${name}`, status: 'failed', message: describeWriteError(err) });
        for (const c of chosen) out.push({ label: `${c.kind} ${c.name}`, status: 'skipped', message: `Not deleted: the ${kind} could not be deleted` });
        setResults(out);
        return;
      }
      for (const c of chosen) {
        try {
          const r = await deleteObject(c.path, clusterId, { uid: uidOf(c)! });
          out.push({ label: `${c.kind} ${c.name}`, status: r });
        } catch (err) {
          out.push({ label: `${c.kind} ${c.name}`, status: 'failed', message: describeWriteError(err) });
        }
        setResults([...out]);
      }
      setResults(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadYaml = () => {
    // ConfigMaps and Secrets were read metadata-only: there is nothing to restore them from.
    const docs = [workload, ...chosen.filter((c) => c.resource && c.kind !== 'ConfigMap' && c.kind !== 'Secret').map((c) => ({ ...c.resource!, kind: c.kind }))]
      .map((r) => resourceToYaml(r as unknown as Record<string, unknown>));
    const blob = new Blob([docs.join('---\n')], { type: 'application/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-objects.yaml`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const title = `Delete ${kind} ${name}?`;
  const who = `${ns} · cluster ${clusterDisplayName(clusterId)}${user.data ? ` · you are acting as ${user.data}` : ''}`;

  if (stage === 'helm' && helmOwner) {
    const others = helmRelease.data?.resources ? helmRelease.data.resources.filter((r) => !(r.kind === kind && r.name === name)).length : null;
    return (
      <Dialog open onClose={cancel} size="xl" title={title} description={who} footer={(
        <>
          <button type="button" onClick={cancel} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={() => setStage('choose')} className="rounded-lg px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40">Delete only the {kind}…</button>
          <button type="button" onClick={() => { cancel(); go(helmReleasePath(helmOwner, 'uninstall'), `Helm ${helmOwner.release}`); }}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">Uninstall release {helmOwner.release}…</button>
        </>
      )}>
        <div role="alert" className="rounded-md border border-sky-800 bg-sky-950/40 px-3 py-2 text-xs text-sky-100">
          <p className="flex items-center gap-1.5 font-medium"><Ship className="h-3.5 w-3.5" aria-hidden="true" /> Managed by Helm release {helmOwner.release}{helmRelease.data ? ` (revision ${helmRelease.data.revision})` : ''}</p>
          <p className="mt-1">
            Deleting only the {kind} leaves {others === null ? "the release's other objects" : `the release's ${others} other object${others === 1 ? '' : 's'}`} behind, and the next helm upgrade recreates it.
            To retire the app, uninstall the release instead.
          </p>
          {helmRelease.isError && <p className="mt-1 text-sky-200/70">The release record could not be read, so its objects are not listed here.</p>}
          <p className="mt-1 text-sky-200/70">The uninstall dialog lists the objects Helm will delete.</p>
        </div>
      </Dialog>
    );
  }

  const confirmDisabled = busy || typed !== name || canDeleteWorkload.isLoading || !canDeleteWorkload.allowed || loading;
  const workloadGone = !!results && (results[0]?.status === 'deleted' || results[0]?.status === 'gone');
  // onDeleted first: a queue counts this workload before it moves on.
  const close = () => { if (workloadGone) onDeleted?.(); onClose(); };
  const footer = results ? (
    <button type="button" onClick={close} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600">Close</button>
  ) : (
    <>
      <button type="button" onClick={cancel} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50">Cancel</button>
      <button type="button" onClick={() => void confirm()} disabled={confirmDisabled}
        className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'Deleting…' : `Delete ${1 + chosen.length} object${chosen.length ? 's' : ''}`}
      </button>
    </>
  );

  return (
    <Dialog open onClose={results ? close : cancel} dismissible={!busy} size="2xl" title={title} description={`${who}${helmOwner ? '' : ' · not managed by Helm'}`} footer={footer}>
      <div className="space-y-4 text-xs">
        {queueNote && <p className="text-slate-400">{queueNote}</p>}
        {helm.claimed && helm.verified === false && <HelmClaimNote claimed={helm.claimed} />}
        {controller && (
          <p role="alert" className="text-amber-300">This {kind} is managed by {controller.kind} {controller.name}: its controller will probably create it again. Change or delete the {controller.kind} instead.</p>
        )}
        {argoAvailable && argo && (
          <p role="alert" className="text-amber-300">This {kind} is managed by Argo CD application {argo.appName}: a sync recreates it unless it is removed from Git.</p>
        )}
        {helmOwner && (
          <p role="alert" className="text-sky-200">Managed by Helm release {helmOwner.release}: only the {kind} is deleted, and the next helm upgrade recreates it. The release&apos;s other objects are left as they are.</p>
        )}
        <section>
          <h3 className="mb-1 font-semibold text-slate-300">Always deleted</h3>
          <p className="text-slate-300">{kind} <span className="font-mono">{name}</span>{kind === 'Deployment' ? ', its ReplicaSets and their pods' : kind === 'CronJob' ? ', its Jobs and their pods' : ' and its pods'} (removed by the garbage collector).</p>
          {!canDeleteWorkload.isLoading && !canDeleteWorkload.allowed && <p className="mt-1 text-red-300">You do not have permission to delete {workloadRbac.plural} in {ns}.</p>}
        </section>

        {!onlyWorkload && (
          <section aria-label="Related objects">
            <h3 className="mb-1 font-semibold text-slate-300">Related objects · choose what to delete</h3>
            {loading || !related ? (
              <p className="text-faint">Checking related objects…</p>
            ) : related.candidates.length === 0 && readErrors.length === 0 && wl.failures.length === 0 ? (
              <p className="text-faint">No Service, Route, autoscaler, budget, policy, config or claim exists only for this {kind}.</p>
            ) : (
              <ul className="space-y-1.5">
                {related.candidates.map((c) => {
                  const denied = deniedReason(c);
                  const disabled = !!c.keptReason || !!c.byController || !!denied || busy || !!results;
                  return (
                    <li key={keyOf(c)} className="flex items-start gap-2">
                      <input
                        id={`rel-${keyOf(c)}`}
                        type="checkbox"
                        className="mt-0.5"
                        checked={c.byController || (!!checked[keyOf(c)] && !c.keptReason)}
                        disabled={disabled}
                        onChange={(e) => setChecked((v) => ({ ...v, [keyOf(c)]: e.target.checked }))}
                        aria-label={`${c.kind} ${c.name}`}
                        aria-describedby={`rel-${keyOf(c)}-note`}
                      />
                      <label htmlFor={`rel-${keyOf(c)}`} className="flex-1">
                        <span className="text-faint">{c.kind} </span>
                        <span className="font-mono text-slate-200">{c.name}</span>
                        <span id={`rel-${keyOf(c)}-note`} className={`block ${c.dataLoss ? 'text-amber-300' : 'text-slate-400'}`}>
                          {[c.keptReason, c.note, denied].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {!loading && (readErrors.length > 0 || wl.failures.length > 0) && (
              <div className="mt-2 space-y-1" role="alert">
                {readErrors.map((f) => (
                  <p key={f.kind} className="text-amber-300">Could not check {KIND_LABEL[f.kind]}: {readFailure(f.error, f.kind, ns)}.</p>
                ))}
                {wl.failures.length > 0 && (
                  <p className="text-amber-300">Could not check {wl.failures.map((f) => `${f.kind}s`).join(', ')}, so whether other workloads share these objects is unknown; they are not chosen by default.</p>
                )}
              </div>
            )}
            <p className="mt-2 text-faint">Found through label selectors, the autoscaler&apos;s target, Route backends and pod template references in {ns}.</p>
          </section>
        )}

        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-faint">Will delete</dt>
          <dd className="text-slate-300" data-testid="delete-summary">
            {kind}{chosen.length ? ` + ${chosen.length} related object${chosen.length === 1 ? '' : 's'}` : ' only'}
            {retainedByPolicy.length ? ` · ${retainedByPolicy.length} PVC${retainedByPolicy.length === 1 ? '' : 's'} deleted by the StatefulSet's retention policy` : ''}
            {keptPvcs.length ? ` · ${keptPvcs.length} PVC${keptPvcs.length === 1 ? '' : 's'} kept` : ''}
          </dd>
          <dt className="text-faint">Dry run</dt>
          <dd className="text-slate-300">Every chosen object is dry-run first; if any would fail, nothing is deleted.</dd>
          <dt className="text-faint">Can it be undone?</dt>
          <dd className="text-slate-300">
            No.{' '}
            <button type="button" onClick={downloadYaml} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
              <Download className="h-3 w-3" aria-hidden="true" /> Download their YAML first
            </button>
            {chosen.some((c) => c.kind === 'ConfigMap' || c.kind === 'Secret') && <span className="text-faint"> (ConfigMaps and Secrets are not included: Pulse did not read their data)</span>}
          </dd>
        </dl>

        {!results && (
          <div>
            <label htmlFor="delete-confirm-name" className="mb-1 block text-slate-400">Type <span className="font-mono text-slate-200">{name}</span> to confirm</label>
            <Input id="delete-confirm-name" inputSize="sm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={busy} />
          </div>
        )}

        {results && (
          <section aria-label="Delete results" className="rounded-md border border-slate-700 bg-slate-950 p-3">
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.label} className="flex items-start gap-2">
                  {r.status === 'deleted' || r.status === 'gone' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-400" />
                    : r.status === 'failed' ? <XCircle className="mt-0.5 h-3.5 w-3.5 text-red-400" /> : <MinusCircle className="mt-0.5 h-3.5 w-3.5 text-slate-500" />}
                  <span className="font-mono text-slate-200">{r.label}</span>
                  <span className={r.status === 'failed' ? 'text-red-300' : 'text-slate-400'}>
                    {r.status === 'deleted' ? 'Deleted' : r.status === 'gone' ? 'Already gone' : r.status === 'failed' ? `Failed: ${r.message}` : r.message}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && <LoadError title="Nothing was deleted" error={error} />}
      </div>
    </Dialog>
  );
}
