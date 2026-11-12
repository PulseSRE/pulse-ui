/**
 * One confirmation for restarting every consumer that keeps old values until
 * it restarts: the exact patch, the order (non-serving first, traffic-serving
 * last), per-workload strategy and PDB, the quota for the surge pods, a dry
 * run of every patch, then a sequential run that stops at the first failure,
 * with a progress panel. Pinned to the cluster it was opened on.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle, Circle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '../../components/primitives/Dialog';
import { LoadError } from '../../components/primitives/LoadError';
import { k8sGet, k8sList } from '../../engine/query';
import { getActiveClusterId } from '../../engine/clusterConnection';
import { assertActiveCluster, clusterDisplayName } from '../../engine/pendingCluster';
import { describeWriteError } from '../../components/ActionDialog';
import { useCanI } from '../../hooks/useCanI';
import { apiPathOf, rolloutRestart, sendWrite } from '../../engine/workloadActions';
import { buildRestartPlan, runRestarts, type PlanItem, type StepProgress } from '../../engine/restartPlan';
import { CONSUMER_SOURCES, type ConfigKind, type Consumer, type ConsumerKind } from '../../engine/configConsumers';
import type { K8sResource } from '../../engine/renderers';

const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';

// Only one restart confirmation at a time (the "Used by" section and the
// save offer can both open one): a second would run a parallel restart.
let openCount = 0;
const listeners = new Set<() => void>();
function setOpen(delta: number) { openCount += delta; listeners.forEach((l) => l()); }
/** True while a restart dialog is open anywhere on the page. */
export function useRestartDialogOpen(): boolean {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => openCount > 0,
  );
}

function useOptionalList(path: string, clusterId: string, key: string) {
  return useQuery({
    queryKey: ['k8s', 'list', 'restart-plan', key, path, clusterId],
    queryFn: () => k8sList<K8sResource>(path, undefined, clusterId),
    retry: false,
  });
}

function useCanPatch(kind: ConsumerKind, ns: string, enabled: boolean) {
  const src = CONSUMER_SOURCES[kind];
  return useCanI('patch', src.group, src.plural, ns, undefined, { enabled });
}

export function RestartConsumersDialog({ configKind, configName, namespace, consumers, incomplete = [], onClose, onRestarted, pollMs }: {
  configKind: ConfigKind;
  configName: string;
  namespace: string;
  consumers: Consumer[];
  /** Kinds the scan could not read: there may be more consumers. */
  incomplete?: string[];
  onClose: () => void;
  /** Called after every restart finished. */
  onRestarted?: () => void;
  /** How often a rollout is polled (tests shorten it). */
  pollMs?: number;
}) {
  // Pinned when the dialog opens.
  const [clusterId] = React.useState(() => getActiveClusterId());
  React.useEffect(() => { setOpen(1); return () => setOpen(-1); }, []);
  const services = useOptionalList(`/api/v1/namespaces/${namespace}/services`, clusterId, 'services');
  const pdbs = useOptionalList(`/apis/policy/v1/namespaces/${namespace}/poddisruptionbudgets`, clusterId, 'pdbs');
  const quotas = useOptionalList(`/api/v1/namespaces/${namespace}/resourcequotas`, clusterId, 'quotas');
  const user = useQuery({
    queryKey: ['currentUser', clusterId],
    queryFn: async () => (await k8sGet<{ metadata?: { name?: string } }>('/apis/user.openshift.io/v1/users/~', clusterId)).metadata?.name ?? '',
    retry: false,
    staleTime: 5 * 60_000,
  });
  const has = (k: string) => consumers.some((c) => c.kind === k);
  const dep = useCanPatch('Deployment', namespace, has('Deployment'));
  const sts = useCanPatch('StatefulSet', namespace, has('StatefulSet'));
  const ds = useCanPatch('DaemonSet', namespace, has('DaemonSet'));
  const rbac: Record<string, { allowed: boolean; isLoading: boolean }> = { Deployment: dep, StatefulSet: sts, DaemonSet: ds };
  const rbacLoading = Object.entries(rbac).some(([k, r]) => has(k) && r.isLoading);

  const readsDone = !services.isLoading && !pdbs.isLoading && !quotas.isLoading;
  const plan = React.useMemo(() => {
    if (!readsDone) return null;
    const p = buildRestartPlan(consumers, namespace, services.isError ? null : services.data ?? [], pdbs.isError ? null : pdbs.data ?? [], quotas.isError ? null : quotas.data ?? []);
    for (const item of p.items) {
      if (!item.skip && !rbacLoading && !rbac[item.kind]?.allowed) {
        item.skip = `You do not have permission to patch ${CONSUMER_SOURCES[item.kind as ConsumerKind].plural} in ${namespace}.`;
      }
    }
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readsDone, consumers, namespace, services.data, services.isError, pdbs.data, pdbs.isError, quotas.data, quotas.isError, rbacLoading, dep.allowed, sts.allowed, ds.allowed]);
  const runnable = plan?.items.filter((i) => !i.skip) ?? [];

  // Dry run every patch before the user can confirm.
  const [dryRun, setDryRun] = React.useState<{ state: 'idle' | 'running' | 'passed' | 'failed'; errors: Array<{ name: string; error: string }> }>({ state: 'idle', errors: [] });
  const runnableKey = runnable.map((i) => `${i.kind}/${i.name}`).join(',');
  React.useEffect(() => {
    if (!plan || rbacLoading || runnable.length === 0) return;
    let cancelled = false;
    setDryRun({ state: 'running', errors: [] });
    (async () => {
      const errors: Array<{ name: string; error: string }> = [];
      for (const item of runnable) {
        const req = rolloutRestart(item.workload);
        try {
          await sendWrite({ ...req, path: `${req.path}?dryRun=All` }, clusterId);
        } catch (err) {
          errors.push({ name: item.name, error: describeWriteError(err) });
        }
      }
      if (!cancelled) setDryRun({ state: errors.length ? 'failed' : 'passed', errors });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnableKey, rbacLoading, !!plan, clusterId]);

  const [steps, setSteps] = React.useState<StepProgress[] | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [finished, setFinished] = React.useState<boolean | null>(null);
  const stopRef = React.useRef(false);
  // Closing the dialog (or leaving the page) ends the run: nothing restarts
  // unseen. The rollout already started continues on its own.
  const abortRef = React.useRef(false);
  React.useEffect(() => () => { abortRef.current = true; }, []);
  const [stopping, setStopping] = React.useState(false);
  const risky = !!plan && (plan.quota.ok === false || plan.items.some((i) => !i.skip && i.pdb.ok === false));
  // The acknowledgement covers the risks shown for this target only. It is
  // stored with the target it was given for, so a dialog that stays mounted
  // while its target or its risks change (another ConfigMap, a refreshed
  // consumer list, a new PDB) is unticked again, and a newly opened dialog
  // always starts unticked.
  const riskKey = plan ? `${plan.quota.ok === false ? 'quota' : ''}|${plan.items.filter((i) => !i.skip && i.pdb.ok === false).map((i) => `${i.kind}/${i.name}`).join(',')}` : '';
  const ackTarget = `${configKind}/${namespace}/${configName}|${consumers.map((c) => `${c.kind}/${c.name}`).join(',')}|${riskKey}`;
  const [ackFor, setAckFor] = React.useState<string | null>(null);
  const ackRisk = ackFor === ackTarget;
  const setAckRisk = (checked: boolean) => setAckFor(checked ? ackTarget : null);

  const confirm = async () => {
    if (!plan) return;
    setRunError(null);
    try {
      assertActiveCluster(clusterId, `Restarting the consumers of ${configName}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      return;
    }
    setRunning(true);
    stopRef.current = false;
    const now = new Date();
    const result = await runRestarts(plan.items, {
      patch: async (item: PlanItem) => {
        assertActiveCluster(clusterId, `Restarting ${item.kind} "${item.name}"`);
        try {
          await sendWrite(rolloutRestart(item.workload, now), clusterId);
        } catch (err) {
          throw new Error(describeWriteError(err));
        }
      },
      get: (item: PlanItem) => k8sGet<K8sResource>(apiPathOf(item.workload), clusterId),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onUpdate: (s) => { if (!abortRef.current) setSteps(s); },
      stopRequested: () => stopRef.current,
      aborted: () => abortRef.current,
      pollMs,
    });
    if (abortRef.current) return;
    setRunning(false);
    setFinished(result.ok);
  };

  const userName = user.data;
  // After every restart finished, closing also clears the "saved, restart?" offer.
  const close = () => { onClose(); if (finished === true) onRestarted?.(); };
  const confirmDisabled = !plan || rbacLoading || runnable.length === 0 || dryRun.state !== 'passed' || (risky && !ackRisk);
  const kinds = [...new Set(runnable.map((i) => i.kind))];
  const confirmLabel = `Restart ${runnable.length} ${kinds.length === 1 ? (runnable.length === 1 ? kinds[0] : `${kinds[0]}s`) : 'workloads'}`;

  const footer = steps ? (
    <>
      {running && (
        <button type="button" onClick={() => { stopRef.current = true; setStopping(true); }} disabled={stopping}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50">
          {stopping ? 'Stopping after the current one…' : 'Stop after current'}
        </button>
      )}
      {!running && <button type="button" onClick={close} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600">Close</button>}
    </>
  ) : (
    <>
      <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">Not now</button>
      <button type="button" onClick={() => void confirm()} disabled={confirmDisabled}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
        {confirmLabel}
      </button>
    </>
  );

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!running}
      size="2xl"
      title={(() => { const n = plan ? runnable.length : consumers.length; return `Restart the ${n} consumer${n === 1 ? '' : 's'} of ${configName}?`; })()}
      description={`${namespace} · cluster ${clusterDisplayName(clusterId)}${userName ? ` · you are acting as ${userName}` : ''}. Their running pods read ${configName} when they started, so they keep the old values until restarted.`}
      footer={footer}
    >
      <div className="space-y-4 text-xs">
        {incomplete.length > 0 && (
          <p className="text-amber-300">{incomplete.join(', ')} could not be checked, so consumers among them are not in this list.</p>
        )}
        <section>
          <h3 className="mb-1 font-semibold text-slate-300">What will change on each workload</h3>
          <pre className="rounded-sm bg-slate-950 p-2 font-mono text-slate-300" aria-label="Patch">
            {'spec.template.metadata.annotations\n'}
            <span className="text-emerald-400">{`+ ${RESTART_ANNOTATION}: "<time of confirm>"`}</span>
          </pre>
          <p className="mt-1 text-faint">The same patch as <code className="font-mono">oc rollout restart</code>: every pod is replaced following the workload&apos;s update strategy.</p>
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-slate-300">Order and impact</h3>
          {!plan ? (
            <p className="text-faint">Checking Services, PodDisruptionBudgets and quota…</p>
          ) : (
            <>
              {plan.orderUnknown && <p className="mb-1 text-amber-300">Could not check which workloads serve traffic (Services could not be listed), so they run in the order listed.</p>}
              <table className="w-full" aria-label="Restart order">
                <thead><tr className="text-left text-faint"><th className="py-1 pr-2 font-normal">#</th><th className="pr-2 font-normal">Workload</th><th className="pr-2 font-normal">Pods and strategy</th><th className="font-normal">PDB</th></tr></thead>
                <tbody>
                  {plan.items.map((item, i) => (
                    <tr key={`${item.kind}/${item.name}`} className="border-t border-slate-800 align-top" data-testid={`restart-row-${item.name}`}>
                      <td className="py-1.5 pr-2 text-faint">{item.skip ? '—' : i + 1}</td>
                      <td className="py-1.5 pr-2 text-slate-200">
                        <span className="text-faint">{item.kind} </span>{item.name}
                        {item.services && item.services.length > 0 && <span className="text-faint"> (serves traffic via {item.services.join(', ')}, last)</span>}
                        {item.skip && <div className="text-amber-300">Not restarted: {item.skip}</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-300">{item.strategy.text}</td>
                      <td className={cn('py-1.5', item.pdb.ok === false ? 'text-amber-300' : item.pdb.ok === null ? 'text-faint' : 'text-slate-300')}>{item.pdb.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-faint">Dry run</dt>
          <dd data-testid="restart-dry-run" className={dryRun.state === 'failed' ? 'text-red-300' : dryRun.state === 'passed' ? 'text-emerald-300' : 'text-slate-400'}>
            {runnable.length === 0 && plan ? 'Nothing to restart' : dryRun.state === 'passed' ? `Passed for all ${runnable.length}` : dryRun.state === 'failed'
              ? `Failed: ${dryRun.errors.map((e) => `${e.name}: ${e.error}`).join('; ')}. Nothing will be restarted.`
              : 'Running…'}
          </dd>
          <dt className="text-faint">Quota during rollout</dt>
          <dd className={plan?.quota.ok === false ? 'text-amber-300' : 'text-slate-300'} data-testid="restart-quota">{plan ? plan.quota.text : 'Checking…'}</dd>
          <dt className="text-faint">If one fails</dt>
          <dd className="text-slate-300">Pulse stops; the rest are not restarted.</dd>
          <dt className="text-faint">Undo</dt>
          <dd className="text-slate-300">A restart only replaces pods. To undo the value, edit {configKind === 'Secret' ? 'the Secret' : configName} back and restart again.</dd>
        </dl>

        {risky && !steps && (
          <label className="flex items-start gap-2 rounded-md border border-amber-800 bg-amber-950/30 p-2 text-amber-200">
            <input type="checkbox" className="mt-0.5" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} />
            <span>
              {plan?.quota.ok === false ? 'The surge pods do not fit the quota, so a rollout can stall with pods that are refused. ' : ''}
              {plan?.items.some((i) => !i.skip && i.pdb.ok === false) ? 'A rollout can take more pods down than a PodDisruptionBudget allows. ' : ''}
              I understand and want to restart anyway.
            </span>
          </label>
        )}

        {steps && (
          <section aria-label="Restart progress" className="rounded-md border border-slate-700 bg-slate-950 p-3">
            <h3 className="mb-2 font-semibold text-slate-300">Progress</h3>
            <ul className="space-y-1">
              {steps.map((s) => (
                <li key={`${s.kind}/${s.name}`} className="flex items-start gap-2" data-testid={`restart-step-${s.name}`}>
                  {s.status === 'done' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-400" />
                    : s.status === 'failed' ? <XCircle className="mt-0.5 h-3.5 w-3.5 text-red-400" />
                    : s.status === 'restarting' || s.status === 'rolling' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-blue-400" />
                    : s.status === 'skipped' || s.status === 'not-started' ? <MinusCircle className="mt-0.5 h-3.5 w-3.5 text-slate-500" />
                    : <Circle className="mt-0.5 h-3.5 w-3.5 text-slate-600" />}
                  <span className="font-mono text-slate-200">{s.name}</span>
                  <span className={s.status === 'failed' ? 'text-red-300' : 'text-slate-400'}>{s.text}</span>
                </li>
              ))}
            </ul>
            {finished === true && <p className="mt-2 text-emerald-300">All restarts finished.</p>}
            {finished === false && <p className="mt-2 text-amber-300">Stopped. Workloads already restarted stay restarted.</p>}
          </section>
        )}
        {runError && <LoadError title="Nothing was restarted" error={runError} />}
      </div>
    </Dialog>
  );
}
