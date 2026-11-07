/**
 * Dry run for an app (DeployDryRun mock): 1 Dry run · 2 Create · 3 Rollout ·
 * 4 Route answers. The dry run sends every object with dryRun=All and lists
 * the result in create order, with what the dry run could not check. Create
 * turns on only when every object passes; it then creates in order, stops at
 * the first failure (with a one-click delete of what was created), watches
 * the rollout and reports the Route's admission. Whether the Route answers
 * is not checked: Pulse has no way to request it from here.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '../../components/primitives/Dialog';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import DeployProgress from '../../components/DeployProgress';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';
import { useCanI } from '../../hooks/useCanI';
import { k8sFetch } from '../../engine/query';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { errorMessage } from '../../hooks/usePinnedAction';
import { formatBytes, formatTime } from '../../engine/format';

function fmtQuantity(resource: string, v: number): string {
  if (/memory|storage/.test(resource)) return formatBytes(v);
  if (/cpu/.test(resource)) return v < 1 ? `${Math.round(v * 1000)}m` : `${Number(v.toFixed(2))}`;
  return String(Math.round(v));
}
import { planObjects, quotaVerdict, type DeployForm, type QuotaLine } from '../../engine/deployApp';
import { useActingAs } from '../../hooks/useActingAs';
import { createPlan, deleteCreated, dryRunPlan, extraChecks, type Check, type CreateOutcome, type ObjectResult } from './deployRunner';

const PLURAL = {
  ImageStream: ['image.openshift.io', 'imagestreams'],
  BuildConfig: ['build.openshift.io', 'buildconfigs'],
} as const;

/** RBAC for each kind in the plan, on the pinned cluster. Still loading counts as not yet allowed. */
function useDenied(ns: string, kinds: string[], clusterId: string): { denied: string[]; checking: boolean } {
  const check = (kind: string) => ({ enabled: kinds.includes(kind), clusterId });
  const answers: Array<[string, { allowed: boolean; isLoading: boolean }]> = [
    ['ImageStream', useCanI('create', PLURAL.ImageStream[0], PLURAL.ImageStream[1], ns, undefined, check('ImageStream'))],
    ['BuildConfig', useCanI('create', PLURAL.BuildConfig[0], PLURAL.BuildConfig[1], ns, undefined, check('BuildConfig'))],
    ['PersistentVolumeClaim', useCanI('create', '', 'persistentvolumeclaims', ns, undefined, check('PersistentVolumeClaim'))],
    ['Deployment', useCanI('create', 'apps', 'deployments', ns, undefined, check('Deployment'))],
    ['PodDisruptionBudget', useCanI('create', 'policy', 'poddisruptionbudgets', ns, undefined, check('PodDisruptionBudget'))],
    ['Service', useCanI('create', '', 'services', ns, undefined, check('Service'))],
    ['Route', useCanI('create', 'route.openshift.io', 'routes', ns, undefined, check('Route'))],
  ];
  const relevant = answers.filter(([kind]) => kinds.includes(kind));
  return {
    denied: relevant.filter(([, a]) => !a.isLoading && !a.allowed).map(([kind]) => kind),
    checking: relevant.some(([, a]) => a.isLoading),
  };
}

function Step({ n, label, state }: { n: number; label: string; state: 'done' | 'active' | 'todo' | 'failed' }) {
  return (
    <li className={cn('flex items-center gap-1.5 text-xs', state === 'done' ? 'text-emerald-300' : state === 'active' ? 'text-blue-300' : state === 'failed' ? 'text-red-300' : 'text-faint')}>
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current">{n}</span>{label}
    </li>
  );
}

const CHECK_STYLE: Record<Check['status'], string> = { pass: 'text-emerald-300', warning: 'text-amber-300', fail: 'text-red-300', unknown: 'text-amber-300' };
const CHECK_LABEL: Record<Check['status'], string> = { pass: 'Passed', warning: 'Warning', fail: 'Would fail', unknown: 'Could not check' };

function RouteStatus({ clusterId, ns, name }: { clusterId: string; ns: string; name: string }) {
  const q = useQuery({
    queryKey: ['deploy-app', 'route', clusterId, ns, name],
    refetchInterval: (query) => (query.state.data?.admitted === undefined ? 3000 : false),
    retry: false,
    queryFn: async () => {
      const res = await k8sFetch(clusterId, `/apis/route.openshift.io/v1/namespaces/${ns}/routes/${name}`);
      if (!res.ok) throw new Error(`The Route could not be read (${res.status})`);
      const r = await res.json();
      const ing = r.status?.ingress?.[0];
      const cond = ing?.conditions?.find((c: { type: string }) => c.type === 'Admitted');
      return { host: ing?.host ?? r.spec?.host, admitted: cond ? cond.status === 'True' : undefined, reason: cond?.reason as string | undefined, message: cond?.message as string | undefined, tls: !!r.spec?.tls };
    },
  });
  if (q.error) return <p className="text-xs text-amber-300">Route: Could not check — {errorMessage(q.error)}.</p>;
  if (!q.data) return <p className="text-xs text-slate-400">Route: Checking…</p>;
  const d = q.data;
  return (
    <div className="space-y-0.5 text-xs" data-testid="route-status">
      <p className={d.admitted === false ? 'text-red-300' : d.admitted ? 'text-emerald-300' : 'text-slate-400'}>
        Route {d.admitted === undefined ? 'waiting for the router to admit it…' : d.admitted ? 'admitted by the router' : `not admitted: ${d.reason ?? ''} ${d.message ?? ''}`}{d.host ? ` · ${d.tls ? 'https' : 'http'}://${d.host}` : ''}
      </p>
      <p className="text-slate-400">Route answers: <span className="text-amber-300">not checked</span> — Pulse has no way to send a request to the route from here; open the link to try it.</p>
    </div>
  );
}

export function DeployDryRunDialog({ clusterId, form, storageClassBinding, quotaLines, onClose, onEditHostname }: {
  clusterId: string;
  form: DeployForm;
  storageClassBinding?: string;
  quotaLines?: QuotaLine[];
  onClose: () => void;
  onEditHostname: (host: string) => void;
}) {
  const addToast = useUIStore((s) => s.addToast);
  const clusterName = useFleetStore((s) => s.clusters.find((c) => c.id === clusterId)?.name ?? clusterId);
  const plan = React.useMemo(() => planObjects(form), [form]);
  const ns = form.namespace;
  const name = form.name.trim();
  const { denied, checking } = useDenied(ns, plan.map((o) => o.kind), clusterId);
  const actingAs = useActingAs(clusterId);
  const [ackUnchecked, setAckUnchecked] = React.useState(false);
  const [phase, setPhase] = React.useState<'dry-run' | 'creating' | 'created' | 'create-failed'>('dry-run');
  const [outcome, setOutcome] = React.useState<CreateOutcome | null>(null);
  const [progress, setProgress] = React.useState<ObjectResult[]>([]);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [deletePvc, setDeletePvc] = React.useState(false);
  const [cleanup, setCleanup] = React.useState<ObjectResult[] | null>(null);
  const [cleaning, setCleaning] = React.useState(false);

  const dry = useQuery({
    queryKey: ['deploy-app', 'dry-run', clusterId, JSON.stringify(form)],
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      assertActiveCluster(clusterId, 'The dry run');
      const [results, checks] = await Promise.all([dryRunPlan(clusterId, plan), extraChecks(clusterId, form, { storageClassBinding })]);
      return { at: Date.now(), results, checks };
    },
  });

  const failing = (dry.data?.results ?? []).filter((r) => r.status === 'fail');
  const uncheckedResults = (dry.data?.results ?? []).filter((r) => r.status === 'unknown');
  const failingChecks = (dry.data?.checks ?? []).filter((c) => c.status === 'fail');
  const uncheckedChecks = (dry.data?.checks ?? []).filter((c) => c.status === 'unknown');
  const quota = quotaLines ? quotaVerdict(quotaLines) : null;
  // Every object admitted, nothing failing, quota fits, RBAC allows each kind; what could not be checked is acknowledged.
  const dryRunClean = !!dry.data && failing.length === 0 && uncheckedResults.length === 0 && failingChecks.length === 0;
  const ready = dryRunClean && !quota?.blocks && !checking && denied.length === 0 && (uncheckedChecks.length === 0 || ackUnchecked);
  const blockedBecause = !dry.data ? 'The dry run has not finished'
    : failing.length || failingChecks.length ? 'Create turns on when every object passes'
      : uncheckedResults.length ? `${uncheckedResults.length} object${uncheckedResults.length === 1 ? '' : 's'} could not be dry-run`
        : quota?.blocks ? 'The pods would not fit the namespace quota'
          : checking ? 'Checking your permissions…'
            : denied.length ? `You do not have permission to create ${denied.join(', ')} in ${ns}`
              : 'Confirm that you have read what was not checked';

  const create = async () => {
    setCreateError(null);
    setPhase('creating');
    const out = await createPlan(clusterId, plan, () => assertActiveCluster(clusterId, `Creating app ${name}`), setProgress);
    setOutcome(out);
    if (out.stoppedBecause) setCreateError(out.stoppedBecause);
    if (out.skipped.length === 0 && out.uncertain.length === 0 && out.results.every((r) => r.status === 'ok')) {
      setPhase('created');
      addToast({ type: 'success', title: `App ${name} created`, detail: `${plan.length} objects in ${ns}` });
    } else setPhase(out.results.length ? 'create-failed' : 'dry-run');
  };

  const removeCreated = async () => {
    if (!outcome) return;
    setCleaning(true);
    try {
      assertActiveCluster(clusterId, `Deleting what was created for ${name}`);
      setCleanup(await deleteCreated(clusterId, outcome, { deletePvc }));
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setCleaning(false);
    }
  };

  const hostConflict = dry.data?.checks.find((c) => c.id === 'host' && c.status === 'fail');
  const routeObj = plan.find((o) => o.kind === 'Route');
  const hasPvc = plan.some((o) => o.kind === 'PersistentVolumeClaim');
  const stepState = (n: number): 'done' | 'active' | 'todo' | 'failed' => {
    // Not "done" while anything is unchecked.
    if (n === 1) return dry.data ? (dryRunClean && uncheckedChecks.length === 0 ? 'done' : failing.length || failingChecks.length ? 'failed' : 'active') : 'active';
    if (n === 2) return phase === 'created' ? 'done' : phase === 'create-failed' ? 'failed' : phase === 'creating' ? 'active' : 'todo';
    return phase === 'created' ? 'active' : 'todo';
  };
  const results = phase === 'dry-run' ? dry.data?.results : outcome?.results ?? progress;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={phase !== 'creating' && !cleaning}
      size="4xl"
      title={`Create app ${name} in ${ns}?`}
      description={`${dry.data ? `Dry run at ${formatTime(dry.data.at)}` : 'Dry run'} · ${plan.length} objects · cluster ${clusterName} · ${actingAs}`}
      footer={phase === 'dry-run' || phase === 'creating' ? (
        <>
          <Button variant="ghost" onClick={onClose} disabled={phase === 'creating'}>Back to form</Button>
          <Button onClick={() => { void create(); }} disabled={!ready} loading={phase === 'creating'}
            title={ready ? undefined : blockedBecause}>
            Create {plan.length} objects
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={onClose} disabled={cleaning}>Close</Button>
      )}
    >
      <div className="space-y-4" data-testid="deploy-dry-run">
        <ol className="flex flex-wrap gap-4">
          <Step n={1} label={`Dry run${!dry.data ? '' : failing.length || failingChecks.length ? ' · failed' : uncheckedResults.length + uncheckedChecks.length ? ` · ${uncheckedResults.length + uncheckedChecks.length} not checked` : ' · done'}`} state={stepState(1)} />
          <Step n={2} label="Create" state={stepState(2)} />
          <Step n={3} label="Rollout" state={stepState(3)} />
          <Step n={4} label="Route answers" state={routeObj ? stepState(4) : 'todo'} />
        </ol>

        {dry.error && <LoadError title="The dry run could not run" error={dry.error} onRetry={() => { void dry.refetch(); }} />}
        {!dry.data && !dry.error && <p className="flex items-center gap-2 text-xs text-slate-400" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending each object with dryRun=All…</p>}

        {results && (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{phase === 'dry-run' ? 'Dry run results, in create order' : 'Create results, in order'}</h4>
            <ul className="divide-y divide-slate-800">
              {plan.map((o) => {
                const r = results.find((x) => x.kind === o.kind && x.name === o.name);
                const skipped = phase !== 'dry-run' && !r;
                return (
                  <li key={o.kind} className="flex flex-wrap items-start gap-2 py-1.5 text-xs" data-testid={`result-${o.kind}`}>
                    {r?.status === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : r?.status === 'fail' ? <XCircle className="h-4 w-4 text-red-400" /> : <CircleDashed className="h-4 w-4 text-slate-500" />}
                    <span className={cn('w-24', r?.status === 'fail' ? 'text-red-300' : r?.status === 'unknown' ? 'text-amber-300' : 'text-slate-400')}>
                      {phase === 'dry-run' ? (r?.status === 'ok' ? 'Would create' : r?.status === 'fail' ? 'Would fail' : r ? 'Could not check' : '…') : r?.status === 'ok' ? 'Created' : r?.status === 'fail' ? 'Failed' : skipped && phase === 'creating' ? 'Waiting' : 'Not created'}
                    </span>
                    <span className="font-mono text-slate-200">{o.kind}/{o.name}</span>
                    <span className={cn('min-w-0 flex-1', r?.status === 'fail' ? 'text-red-300' : 'text-faint')}>{r?.message ?? o.summary}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {phase === 'dry-run' && dry.data && (
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Not checked by the dry run</h4>
            {dry.data.checks.length === 0 ? <p className="text-xs text-faint">Nothing else to check for this app.</p> : (
              <ul className="space-y-1 text-xs" data-testid="extra-checks">
                {dry.data.checks.map((c) => <li key={c.id}><span className={CHECK_STYLE[c.status]}>{CHECK_LABEL[c.status]}</span> <span className="text-slate-300">{c.text}</span></li>)}
              </ul>
            )}
            {uncheckedChecks.length > 0 && failingChecks.length === 0 && failing.length === 0 && (
              <label className="mt-2 flex items-start gap-1.5 text-xs text-slate-300">
                <input type="checkbox" checked={ackUnchecked} onChange={(e) => setAckUnchecked(e.target.checked)} />
                I have read the {uncheckedChecks.length} item{uncheckedChecks.length === 1 ? '' : 's'} Pulse could not check, and want to create anyway
              </label>
            )}
            {hostConflict && (
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => onEditHostname('')}>Clear the hostname (let the router generate one) and edit the form</Button>
            )}
          </section>
        )}

        {denied.length > 0 && <p className="text-xs text-red-300" role="alert">You do not have permission to create {denied.join(', ')} in {ns}.</p>}
        {checking && <p className="text-xs text-slate-400" role="status">Checking your permissions…</p>}
        {form.source.type === 'git' && phase === 'dry-run' && <p className="text-xs text-slate-400">Git source: the first build starts on create, and the pods wait (ImagePullBackOff or waiting for the image) until it pushes {name}:latest.</p>}

        {phase === 'dry-run' && (
          <>
            <div className="rounded-md border border-slate-800 p-3 text-xs text-slate-400">
              <div className="mb-1 font-medium text-slate-300">After Create, Pulse keeps this dialog open and reports</div>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>Creates each object in the order above and reports per object. If one fails, the ones already created are listed with a one-click delete.</li>
                <li>Watches the rollout of Deployment/{name} until its pods are ready, with events if it stalls.</li>
                <li>{routeObj ? 'Shows whether the router admitted the Route. Whether the route answers is not checked: Pulse has no way to request it from here.' : 'No Route is created, so there is nothing to answer.'}</li>
              </ol>
            </div>
            <dl className="grid grid-cols-1 gap-1 text-xs md:grid-cols-[9rem_1fr]">
              <dt className="text-faint">Quota after create</dt>
              <dd className="text-slate-300" data-testid="confirm-quota">
                {quotaLines === undefined ? <span className="text-amber-300">Could not check</span>
                  : quotaLines.length === 0 ? 'No ResourceQuota limits this app'
                    : (
                      <ul className="space-y-0.5">
                        {quotaLines.filter((l) => /cpu|memory/.test(l.resource)).map((l) => (
                          <li key={`${l.quota}/${l.resource}`} className={l.unsetButRequired || l.after > l.hard ? 'text-red-300' : l.duringRollout > l.hard ? 'text-amber-300' : ''}>
                            {l.resource}: {l.scopeUnknown ? `not counted (${l.scopeUnknown})` : l.unsetButRequired ? 'the quota requires it, but neither the form nor a LimitRange sets it: pods are rejected' : `${fmtQuantity(l.resource, l.after)} of ${fmtQuantity(l.resource, l.hard)}${l.after > l.hard ? ' — over quota' : l.duringRollout > l.hard ? ' — the next rollout would not fit' : ''}`}
                          </li>
                        ))}
                        {quota && quota.over.filter((l) => !/cpu|memory/.test(l.resource)).map((l) => <li key={l.resource} className="text-red-300">{l.resource}: {fmtQuantity(l.resource, l.after)} of {fmtQuantity(l.resource, l.hard)} — over quota</li>)}
                      </ul>
                    )}
              </dd>
              <dt className="text-faint">Undo</dt>
              <dd className="text-slate-300">Delete app {name}: removes these {plan.length} objects{hasPvc ? '; the PVC is kept unless you choose' : ''}.</dd>
            </dl>
            {!ready && dry.data && <p className="text-xs text-faint" data-testid="create-blocked">{blockedBecause}.</p>}
          </>
        )}

        {createError && <LoadError title="The app was not created" error={createError} />}

        {phase === 'create-failed' && outcome && (
          <div className="space-y-2 rounded-md border border-red-900/60 bg-red-950/20 p-3 text-xs" data-testid="create-failed">
            <p className="text-red-200">{outcome.stoppedBecause ? 'Stopped before ' + (outcome.skipped[0] ? `${outcome.skipped[0].kind}/${outcome.skipped[0].name}` : 'the next object') : `Stopped at ${outcome.results.at(-1)?.kind}/${outcome.results.at(-1)?.name}`}. {outcome.skipped.length ? `Not attempted: ${outcome.skipped.map((o) => `${o.kind}/${o.name}`).join(', ')}.` : ''}</p>
            {outcome.uncertain.length > 0 && <p className="text-amber-300">No answer for {outcome.uncertain.map((o) => `${o.kind}/${o.name}`).join(', ')}: it may or may not exist. Cleanup deletes it only if Pulse can confirm it created it.</p>}
            {(outcome.created.length > 0 || outcome.uncertain.length > 0) && !cleanup && (
              <>
                {outcome.created.length > 0 && <p className="text-slate-300">Already created: {outcome.created.map((o) => `${o.kind}/${o.name}`).join(', ')}.</p>}
                {outcome.created.some((o) => o.kind === 'PersistentVolumeClaim') && (
                  <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={deletePvc} onChange={(e) => setDeletePvc(e.target.checked)} /> Also delete the PersistentVolumeClaim (its data is lost)</label>
                )}
                <Button size="sm" variant="danger" onClick={() => { void removeCreated(); }} loading={cleaning}>Delete the {outcome.created.length + outcome.uncertain.length} created object{outcome.created.length + outcome.uncertain.length === 1 ? '' : 's'}</Button>
              </>
            )}
            {cleanup && <ul className="space-y-0.5" data-testid="cleanup-results">{cleanup.map((r) => <li key={r.kind} className={r.status === 'ok' ? 'text-slate-300' : 'text-red-300'}>{r.kind}/{r.name}: {r.message}</li>)}</ul>}
          </div>
        )}

        {phase === 'created' && (
          <div className="space-y-3">
            <DeployProgress type="deployment" name={name} namespace={ns} clusterId={clusterId} onClose={() => undefined} />
            {routeObj && <RouteStatus clusterId={clusterId} ns={ns} name={name} />}
          </div>
        )}
      </div>
    </Dialog>
  );
}
