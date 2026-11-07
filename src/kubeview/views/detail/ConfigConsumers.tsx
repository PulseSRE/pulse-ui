/**
 * "Used by" on ConfigMap and Secret pages, and "Restart consumers".
 *
 * The section scans the pod templates of every Deployment, StatefulSet,
 * DaemonSet, CronJob and Job in the namespace and says, per consumer, how it
 * uses the object and when its running pods see a change. A kind that could
 * not be listed is named as not checked; the list is never presented as
 * complete when it is not. Secrets: names and key names only.
 */
import React from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { k8sList } from '../../engine/query';
import { useFleetStore } from '../../store/fleetStore';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { PulseError } from '../../engine/errors';
import {
  CONSUMER_KINDS, CONSUMER_SOURCES, NOT_SCANNED, OPTIONAL_KINDS, RESTARTABLE_KINDS, describePickUp, describeUsage, findConsumers, lastEditTime,
  type ConfigKind, type Consumer, type ConsumerKind,
} from '../../engine/configConsumers';
import { labelSelectorMatches } from '../../engine/upgradeHealth';
import { formatTimestamp } from '../../engine/format';
import type { K8sResource } from '../../engine/renderers';
import { DetailSection } from './MetadataSections';
import { RestartConsumersDialog, useRestartDialogOpen } from './RestartConsumersDialog';

type Go = (path: string, title: string) => void;

export interface ConsumerScan {
  consumers: Consumer[];
  /** All workloads read (any kind), for callers that need the whole picture. */
  workloads: K8sResource[];
  /** Kinds that could not be listed, with why (workload kinds, or ServiceAccount). */
  failures: Array<{ kind: string; error: unknown }>;
  /** Workload kinds that were listed (an API that is not served is left out). */
  kindsRead: string[];
  loading: boolean;
  scanned: number;
  refetch: () => void;
}

/** List every consumer kind in `ns` (on `clusterId`) and find the ones that use `kind/name`. */
export function useWorkloadsInNamespace(ns: string, clusterId: string, enabled = true) {
  const results = useQueries({
    queries: CONSUMER_KINDS.map((kind) => ({
      queryKey: ['k8s', 'list', 'config-consumers', kind, ns, clusterId],
      queryFn: async (): Promise<K8sResource[] | null> => {
        try {
          return (await k8sList<K8sResource>(CONSUMER_SOURCES[kind].path(ns), undefined, clusterId)).map((w) => ({ ...w, kind }));
        } catch (err) {
          // DeploymentConfigs are OpenShift-only: not served means there are none (null), not a failure.
          if (OPTIONAL_KINDS.has(kind) && err instanceof PulseError && err.statusCode === 404) return null;
          throw err;
        }
      },
      enabled: enabled && !!ns,
      retry: false,
      staleTime: 15_000,
    })),
  });
  // Stable between renders unless a list changed: callers derive state from these.
  const datas = results.map((r) => r.data);
  const errs = results.map((r) => r.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const workloads = React.useMemo(() => datas.flatMap((d) => d ?? []), datas);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const failures = React.useMemo(() => errs.flatMap((e, i) => (e ? [{ kind: CONSUMER_KINDS[i], error: e as unknown }] : [])), errs);
  const loading = results.some((r) => r.isLoading);
  const kindsRead = CONSUMER_KINDS.filter((_, i) => Array.isArray(results[i].data));
  return { workloads, failures, loading, kindsRead, refetch: () => results.forEach((r) => { if (r.isError) void r.refetch(); }) };
}

/** ServiceAccounts in `ns`: their imagePullSecrets reach every pod that runs as them. */
export function useServiceAccounts(ns: string, clusterId: string, enabled = true) {
  return useQuery({
    queryKey: ['k8s', 'list', 'config-consumers', 'ServiceAccount', ns, clusterId],
    queryFn: () => k8sList<K8sResource>(`/api/v1/namespaces/${ns}/serviceaccounts`, undefined, clusterId),
    enabled: enabled && !!ns,
    retry: false,
    staleTime: 15_000,
  });
}

export function useConfigConsumers(kind: ConfigKind, ns: string, name: string, clusterId: string): ConsumerScan {
  const wl = useWorkloadsInNamespace(ns, clusterId);
  // Only a Secret can be an image pull secret.
  const sas = useServiceAccounts(ns, clusterId, kind === 'Secret');
  const consumers = React.useMemo(() => findConsumers(kind, name, wl.workloads, sas.data), [kind, name, wl.workloads, sas.data]);
  const failures = React.useMemo(() => (sas.isError ? [...wl.failures, { kind: 'ServiceAccount', error: sas.error as unknown }] : wl.failures), [wl.failures, sas.isError, sas.error]);
  const scanned = wl.workloads.filter((w) => !(w.kind === 'Job' && (w.metadata.ownerReferences ?? []).some((o) => o.kind === 'CronJob'))).length;
  return {
    consumers, workloads: wl.workloads, failures, kindsRead: wl.kindsRead,
    loading: wl.loading || (kind === 'Secret' && sas.isLoading), scanned,
    refetch: () => { wl.refetch(); if (sas.isError) void sas.refetch(); },
  };
}

export const PLURAL_LABEL: Record<string, string> = { Deployment: 'Deployments', StatefulSet: 'StatefulSets', DaemonSet: 'DaemonSets', DeploymentConfig: 'DeploymentConfigs', CronJob: 'CronJobs', Job: 'Jobs', ServiceAccount: "ServiceAccounts (their image pull secrets)" };

function workloadPath(c: { kind: string; name: string }, ns: string): string {
  const src = CONSUMER_SOURCES[c.kind as ConsumerKind];
  return `/r/${src.group}~v1~${src.plural}/${ns}/${c.name}`;
}

/** Consumers whose running pods keep the old values until restarted, and that a restart applies to. */
export function restartTargets(consumers: Consumer[]): Consumer[] {
  return consumers.filter((c) => c.pickUp === 'restart' && RESTARTABLE_KINDS.has(c.kind));
}

interface PodLite { metadata: { name: string; labels?: Record<string, string> }; status?: { phase?: string; startTime?: string } }

/** Running pods of a consumer, and how many started before the last edit. */
function podsSummary(c: Consumer, pods: PodLite[] | undefined, podsError: boolean, editedAt: number | null): string {
  if (!RESTARTABLE_KINDS.has(c.kind)) return '—';
  if (podsError) return 'Could not check';
  if (!pods) return 'Checking…';
  const sel = (c.workload.spec as { selector?: { matchLabels?: Record<string, string> } } | undefined)?.selector;
  const mine = pods.filter((p) => p.status?.phase === 'Running' && labelSelectorMatches(sel, p.metadata.labels ?? {}));
  if (mine.length === 0) return 'No running pods';
  if (c.pickUp === 'file') return `${mine.length} · file current, process unknown`;
  if (c.pickUp !== 'restart') return `${mine.length} running`;
  if (editedAt === null) return `${mine.length} running · edit time not recorded, so old/new values could not be checked`;
  const old = mine.filter((p) => { const t = Date.parse(p.status?.startTime ?? ''); return Number.isNaN(t) || t < editedAt; });
  if (old.length === 0) return `${mine.length} on current values`;
  return `${old.length} of ${mine.length} on old values (started before the ${formatTimestamp(editedAt)} edit)`;
}

export function ConfigConsumersSection({ resource, go, savedAt, onRestarted }: { resource: K8sResource; go: Go; savedAt?: number; onRestarted?: () => void }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const kind = resource.kind as ConfigKind;
  const ns = resource.metadata.namespace || '';
  const name = resource.metadata.name;
  const scan = useConfigConsumers(kind, ns, name, clusterId);
  const pods = useQuery({
    queryKey: ['k8s', 'list', 'config-consumer-pods', ns, clusterId],
    queryFn: () => k8sList<PodLite>(`/api/v1/namespaces/${ns}/pods`, undefined, clusterId),
    enabled: !!ns && scan.consumers.some((c) => RESTARTABLE_KINDS.has(c.kind)),
    retry: false,
  });
  const [restartOpen, setRestartOpen] = React.useState(false);
  const anotherOpen = useRestartDialogOpen() && !restartOpen;
  const editedAt = savedAt ?? lastEditTime(resource);
  const targets = restartTargets(scan.consumers);
  const kindsRead = scan.kindsRead;

  const restartReason = anotherOpen
    ? 'Another restart confirmation is open'
    : scan.loading
    ? 'Checking the consumers…'
    : targets.length === 0
      ? 'No consumer needs a restart to pick up a change'
      : undefined;

  return (
    <DetailSection
      title="Used by"
      actions={(
        <Button size="sm" variant="secondary" onClick={() => setRestartOpen(true)} disabled={!!restartReason} title={restartReason}>
          <RotateCw className="w-3.5 h-3.5" /> Restart consumers…
        </Button>
      )}
    >
      <p className="text-xs text-faint mb-3" data-testid="consumers-scope">
        {scan.loading
          ? `Scanning pod templates in ${ns}…`
          : `Scanned ${scan.scanned} pod template${scan.scanned === 1 ? '' : 's'} in ${ns} (${kindsRead.map((k) => PLURAL_LABEL[k]).join(', ') || 'none'}).`}
        {kind === 'Secret' && ' Including ServiceAccount image pull secrets and volume driver credentials. Only names and key names are shown; values are never read here.'}
        {' '}Not checked: {NOT_SCANNED}.
      </p>
      {scan.failures.length > 0 && (
        <LoadError
          className="mb-3"
          title={`Could not check ${scan.failures.map((f) => PLURAL_LABEL[f.kind]).join(', ')}: this list may be incomplete`}
          error={scan.failures[0].error}
          onRetry={scan.refetch}
        />
      )}
      {savedAt && targets.length > 0 && (
        <div role="status" className="mb-3 rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center gap-2">
          <span>Saved. Saving does not change running pods: {targets.map((t) => t.name).join(', ')} read {name} at start and keep the old values until restarted.</span>
          <Button size="sm" variant="secondary" onClick={() => setRestartOpen(true)} disabled={anotherOpen}>Review a restart of {targets.length}</Button>
        </div>
      )}
      {scan.loading && scan.consumers.length === 0 ? (
        <p className="text-xs text-faint">Checking…</p>
      ) : scan.consumers.length === 0 ? (
        <p className="text-xs text-faint">
          {scan.failures.length > 0
            ? `No consumer found among the kinds that could be read. ${scan.failures.map((f) => PLURAL_LABEL[f.kind]).join(', ')} could not be checked.`
            : `No ${kindsRead.map((k) => PLURAL_LABEL[k]).join(', ')} in ${ns} references this ${kind}${kind === 'Secret' ? ', and no ServiceAccount lists it as an image pull secret' : ''}. Not checked: ${NOT_SCANNED}.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label={`Workloads that use ${name}`}>
            <thead>
              <tr className="text-left text-faint">
                <th className="py-1 pr-3 font-normal">Workload</th>
                <th className="pr-3 font-normal">How it uses {name}</th>
                <th className="pr-3 font-normal">Picks up changes</th>
                <th className="font-normal">Running pods</th>
              </tr>
            </thead>
            <tbody>
              {scan.consumers.map((c) => {
                const p = describePickUp(c.pickUp);
                return (
                  <tr key={`${c.kind}/${c.name}`} className="border-t border-slate-800 align-top">
                    <td className="py-1.5 pr-3">
                      <span className="text-faint">{c.kind} </span>
                      <button className="text-blue-400 hover:text-blue-300 font-mono" onClick={() => go(workloadPath(c, ns), c.name)}>{c.name}</button>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-300">
                      <ul className="space-y-0.5">{c.uses.map((u, i) => <li key={i}>{describeUsage(u, kind)}</li>)}</ul>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={c.pickUp === 'restart' ? 'text-amber-300' : 'text-slate-300'}>{p.label}</span>
                      {p.note && <div className="text-faint">{p.note}</div>}
                      {c.pickUp === 'restart' && !RESTARTABLE_KINDS.has(c.kind) && <div className="text-faint">Pulse does not restart {c.kind}s: run <code className="font-mono">oc rollout latest dc/{c.name}</code></div>}
                    </td>
                    <td className="py-1.5 text-slate-400">{podsSummary(c, pods.data, pods.isError, editedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {restartOpen && (
        <RestartConsumersDialog
          configKind={kind}
          configName={name}
          namespace={ns}
          consumers={targets}
          incomplete={scan.failures.map((f) => PLURAL_LABEL[f.kind])}
          onClose={() => setRestartOpen(false)}
          onRestarted={onRestarted}
        />
      )}
    </DetailSection>
  );
}

/**
 * After a save in the YAML editor: the consumers that keep the old values,
 * and the restart confirmation. Nothing when no consumer needs a restart.
 */
export function SavedConsumersOffer({ kind, namespace, name, clusterId, onRestarted }: { kind: ConfigKind; namespace: string; name: string; clusterId: string; onRestarted?: () => void }) {
  const scan = useConfigConsumers(kind, namespace, name, clusterId);
  const [open, setOpen] = React.useState(false);
  const anotherOpen = useRestartDialogOpen() && !open;
  const targets = restartTargets(scan.consumers);
  if (scan.loading) return <div role="status" className="px-4 py-2 border-b border-slate-800 text-xs text-slate-400">Saved. Checking which workloads use {name}…</div>;
  if (targets.length === 0 && scan.failures.length === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-amber-900 bg-amber-950/30 text-xs text-amber-200" data-testid="saved-consumers-offer">
      {targets.length > 0
        ? <span>Saved. Saving does not change running pods: {targets.map((t) => `${t.kind} ${t.name}`).join(', ')} read {name} at start and keep the old values until restarted.</span>
        : <span>Saved.</span>}
      {scan.failures.length > 0 && <span>Could not check {scan.failures.map((f) => PLURAL_LABEL[f.kind]).join(', ')} for consumers.</span>}
      {targets.length > 0 && <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={anotherOpen} title={anotherOpen ? 'Another restart confirmation is open' : undefined}><RotateCw className="w-3.5 h-3.5" /> Review a restart of {targets.length}</Button>}
      {open && (
        <RestartConsumersDialog
          configKind={kind}
          configName={name}
          namespace={namespace}
          consumers={targets}
          incomplete={scan.failures.map((f) => PLURAL_LABEL[f.kind])}
          onClose={() => setOpen(false)}
          onRestarted={onRestarted}
        />
      )}
    </div>
  );
}
