/**
 * Upgrade a release or change its values, in two steps:
 *  1. Values: chart defaults beside the overrides, reset or reuse the
 *     release's values, and a rendered preview through the Helm runner.
 *  2. HelmDiffConfirm: the object-by-object diff of the release's current
 *     manifest against the new render, the hooks that run, the impact, and
 *     the undo (roll back to the current revision). Confirming starts the
 *     helm upgrade Job on the cluster the dialog was opened on.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dump, load } from 'js-yaml';
import { ArrowUpCircle, Eye, MessageSquare } from 'lucide-react';
import { Dialog } from '../../components/primitives/Dialog';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { assertActiveCluster } from '../../engine/pendingCluster';
import { valuesBaseRevision, type HelmReleaseSummary } from '../../engine/helmRelease';
import { buildChartArchive, storedChartBlocker } from '../../engine/helmChartArchive';
import { leafPaths, mergeValues, parseValues } from '../../engine/helmManifest';
import { askPulse } from '../../engine/askPulse';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { runHelmAction } from './helmRunner';
import { runnerCanManage } from './helmInstall';
import { fetchReleaseRecord, previewCounts, runHelmPreview, type HelmPreview } from './helmPreview';
import { HelmValuesPanel, useChartDefaults, type ValuesMode } from './HelmValuesPanel';
import { HooksList, PreviewCounts, PreviewNotes, PreviewObjects, PreviewResult, usePreviewDenied, useHelmPreview } from './HelmPreviewPanel';
import { previewText } from './HelmInstallPanel';
import type { ChartSource, ReleaseAction } from './HelmReleases';

export type UpgradeKind = 'values' | 'upgrade';

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);

/** Workloads whose pod template changes, so their pods restart. */
export function restartingWorkloads(preview: HelmPreview): string[] {
  return preview.entries.filter((e) => e.change === 'changed' && WORKLOADS.has(e.kind) && e.before && e.after).filter((e) => {
    const t = (y: string) => JSON.stringify((load(y) as { spec?: { template?: unknown } })?.spec?.template ?? null);
    return t(e.before!) !== t(e.after!);
  }).map((e) => `${e.kind}/${e.name}`);
}

export function HelmUpgradeDialog({ kind, release: r, charts, action, onStarted }: {
  kind: UpgradeKind;
  release: HelmReleaseSummary;
  charts: ChartSource[];
  action: ReturnType<typeof usePinnedAction<ReleaseAction>>;
  onStarted: (job: { name: string; ns: string; clusterId: string }) => void;
}) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const pinned = action.pending!.clusterId;
  const clusterName = useFleetStore((s) => s.clusters.find((c) => c.id === pinned)?.name ?? pinned);
  // The deployed revision is what runs now (after a failed upgrade, not the latest).
  const base = valuesBaseRevision(r.revisions) ?? r;
  const candidates = charts.filter((c) => c.name === r.chart && !!c.repoUrl);
  const [repoUrl, setRepoUrl] = React.useState(candidates.length === 1 ? candidates[0].repoUrl! : '');
  const source = candidates.find((c) => c.repoUrl === repoUrl);
  const [version, setVersion] = React.useState(source?.versions[0] ?? '');
  React.useEffect(() => { setVersion(source?.versions[0] ?? ''); }, [repoUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = React.useState<ValuesMode>('reset');
  const currentValues = base.values ?? {};
  const [valuesText, setValuesText] = React.useState(Object.keys(currentValues).length > 0 ? dump(currentValues) : '');
  const [atomic, setAtomic] = React.useState(true);
  const [step, setStep] = React.useState<'edit' | 'confirm'>('edit');
  const [formError, setFormError] = React.useState<string | null>(null);

  const switchMode = (m: ValuesMode) => {
    setMode(m);
    // Reuse starts from the release's values, so the overrides start empty; reset starts from them written out.
    setValuesText(m === 'reuse' ? '' : Object.keys(currentValues).length ? dump(currentValues) : '');
  };

  const storedBlock = kind === 'values' ? storedChartBlocker(base.storedChart) : null;
  const upgradeBlocked = kind === 'upgrade' && candidates.length === 0;
  const uncovered = base.resources?.filter((x) => !runnerCanManage(x.apiVersion, x.kind)) ?? [];
  const runnerBlock = base.resources === undefined
    ? 'The release record could not be read, so Pulse cannot check that the Helm runner may manage its resources.'
    : uncovered.length > 0
      ? `This release contains ${[...new Set(uncovered.map((x) => x.kind))].join(', ')}, which the Helm runner's Role in ${r.namespace} cannot manage, so the Job would fail part-way. Run this ${kind === 'values' ? 'values change' : 'upgrade'} with helm and sufficient permissions instead.`
      : null;
  const blocked = storedBlock
    ? `Pulse cannot edit this release's values: ${storedBlock}${candidates.length ? ' Use Upgrade, which fetches the chart from its repository.' : ' Add the chart\'s repository under Chart Repositories and use Upgrade instead.'}`
    : upgradeBlocked
      ? `The chart ${r.chart ?? '(unknown)'} is not in any configured chart repository, so Pulse cannot fetch a version to upgrade to. Add its repository under Chart Repositories first.`
      : runnerBlock;

  const defaults = useChartDefaults(kind === 'values'
    ? { from: 'stored', chart: base.storedChart }
    : source && version ? { from: 'repo', repoUrl: source.repoUrl!, chartUrl: source.urls?.[version], chartName: source.name, version } : null);
  const denied = usePreviewDenied(r.namespace);

  /** The values helm renders with: for reuse, the overrides merged over the release's values. */
  const effectiveValues = (): string => {
    const over = parseValues(valuesText);
    return mode === 'reuse' ? (Object.keys(mergeValues(currentValues, over)).length ? dump(mergeValues(currentValues, over)) : '') : valuesText;
  };
  const previewKey = JSON.stringify([pinned, kind, repoUrl, version, mode, valuesText]);
  const preview = useHelmPreview(previewKey);
  const cur = preview.current;
  const done = cur?.status === 'done' ? cur.preview : null;

  const runPreview = () => {
    let values: string;
    try { values = effectiveValues(); setFormError(null); } catch (e) {
      setFormError(`The values are not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (kind === 'upgrade' && !source?.repoUrl) { setFormError(`Choose the repository to upgrade ${r.chart ?? 'the chart'} from`); return; }
    void preview.run(previewKey, async () => {
      assertActiveCluster(pinned, 'The preview');
      const current = await fetchReleaseRecord(pinned, r.namespace, base.secretName);
      const chart = kind === 'values'
        ? { from: 'stored' as const, chartArchive: await buildChartArchive(base.storedChart) }
        : { from: 'repo' as const, chartName: source!.name, repoUrl: source!.repoUrl!, version: version || undefined };
      return runHelmPreview({ clusterId: pinned, namespace: r.namespace, releaseName: r.name, chart, valuesYaml: values, current });
    });
  };

  const confirm = () => action.run(`${kind === 'values' ? 'The values change' : 'The upgrade'} of ${r.name}`, async (_t, clusterId) => {
    parseValues(valuesText);
    const opts = { valuesMode: mode, atomic };
    const jobName = kind === 'values'
      ? await runHelmAction(clusterId, r.namespace, { action: 'upgrade-stored', releaseName: r.name, chartArchive: await buildChartArchive(base.storedChart), ...opts }, valuesText)
      : await runHelmAction(clusterId, r.namespace, { action: 'upgrade', releaseName: r.name, chartName: source!.name, repoUrl: source!.repoUrl!, version: version || undefined, ...opts }, valuesText);
    addToast({ type: 'success', title: `Helm ${kind === 'values' ? 'upgrade (values only)' : 'upgrade'} started`, detail: `${r.name} in ${r.namespace} (Job ${jobName})` });
    onStarted({ name: jobName, ns: r.namespace, clusterId });
    queryClient.invalidateQueries({ queryKey: ['helm'] });
  });

  const fromChart = `${base.chart ?? 'chart'}${base.chartVersion ? ` ${base.chartVersion}` : ''}`;
  const toVersion = kind === 'values' ? base.chartVersion : version;
  let changedKeys = 0;
  try { changedKeys = leafPaths(parseValues(valuesText)).length; } catch { changedKeys = 0; }
  const valuesSummary = mode === 'reuse' ? `reuse current + ${changedKeys} change${changedKeys === 1 ? '' : 's'}` : `chart defaults + ${changedKeys} override${changedKeys === 1 ? '' : 's'}`;
  const title = step === 'confirm'
    ? kind === 'values' ? `Apply new values to ${r.name}?` : `Upgrade ${r.name} from chart ${base.chartVersion ?? '?'} to ${version}?`
    : kind === 'values' ? `Edit values of ${r.name}` : `Upgrade ${r.name}`;
  const notLatest = base.revision !== r.revision ? ` The latest revision, rev ${r.revision}, is ${r.status}; this starts from rev ${base.revision}, the deployed one.` : '';

  if (blocked) {
    return (
      <Dialog open onClose={action.close} title={title} size="xl" showClose={false} footer={<Button variant="secondary" onClick={action.close}>Close</Button>}>
        <LoadError title={`The ${kind === 'values' ? 'values change' : 'upgrade'} cannot run from Pulse`} error={blocked} />
      </Dialog>
    );
  }

  const restarts = done ? restartingWorkloads(done) : [];
  const counts = done ? previewCounts(done) : null;
  const preUpgradeHooks = done?.hooks.some((h) => h.hook!.events.includes('pre-upgrade') || h.hook!.events.includes('post-upgrade'));
  const remote = pinned !== LOCAL_CLUSTER_ID;

  return (
    <Dialog
      open
      onClose={action.close}
      dismissible={!action.running}
      size="4xl"
      title={title}
      description={step === 'confirm'
        ? `Release ${r.name} · ${r.namespace} · revision ${base.revision} → ${r.revision + 1} · values: ${valuesSummary} · cluster ${clusterName}`
        : kind === 'values'
          ? `Runs "helm upgrade ${r.name}" with the chart Helm stored in rev ${base.revision} (${fromChart}), so no chart repository is needed and the chart version does not change.${notLatest}`
          : `Runs "helm upgrade ${r.name} ${r.chart}${version ? ` --version ${version}` : ''}" from ${source ? (source.repoName ?? source.repoUrl) : 'the repository you choose'} in ${r.namespace} as a Job.${notLatest}`}
      footer={step === 'edit' ? (
        <>
          <Button variant="ghost" onClick={action.close}>Cancel</Button>
          {(cur?.status === 'error' || denied) && <Button variant="secondary" onClick={() => setStep('confirm')}>Continue without a preview</Button>}
          <Button onClick={() => setStep('confirm')} disabled={!done || preview.blockers > 0}
            title={!done ? 'Preview first' : preview.blockers > 0 ? 'Fix what would fail first' : undefined}>
            Review changes
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={() => setStep('edit')} disabled={action.running}>Back to values</Button>
          <Button onClick={() => { void confirm(); }} loading={action.running} disabled={!!done && preview.blockers > 0}>
            <ArrowUpCircle className="h-4 w-4" /> {kind === 'values' ? 'Apply values' : `Upgrade to ${toVersion}`}
          </Button>
        </>
      )}
    >
      {step === 'edit' ? (
        <div className="space-y-4">
          {kind === 'upgrade' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {candidates.length > 1 && (
                <label className="block text-xs text-slate-400">
                  Repository ({candidates.length} have a chart named {r.chart})
                  <select aria-label="Repository" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
                    className="mt-1 w-full rounded-sm border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
                    <option value="">Choose the repository this release came from…</option>
                    {candidates.map((c) => <option key={c.repoUrl} value={c.repoUrl}>{c.repoName} — {c.repoUrl}</option>)}
                  </select>
                </label>
              )}
              <label className="block text-xs text-slate-400">
                Chart version
                <select aria-label="Chart version" value={version} onChange={(e) => setVersion(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
                  {(source?.versions ?? []).map((v) => <option key={v} value={v}>{v}{v === r.chartVersion ? ' (installed)' : ''}</option>)}
                </select>
              </label>
            </div>
          )}
          <HelmValuesPanel defaults={defaults} overrides={valuesText} onOverridesChange={setValuesText} mode={mode} onModeChange={switchMode} />
          {mode === 'reset' && !valuesText.trim() && <p className="text-xs text-amber-300">No values: the release is reset to the chart's defaults.</p>}
          {formError && <LoadError title="Cannot preview yet" error={formError} />}
          <div className="space-y-2 rounded-md border border-slate-700 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-slate-200">Preview the change</div>
                <div className="text-xs text-slate-500">Renders the new manifests in the Helm runner Job and diffs them against rev {base.revision}. Nothing is applied.</div>
              </div>
              <Button variant="secondary" onClick={runPreview} disabled={cur?.status === 'running' || !!denied} title={denied} loading={cur?.status === 'running'}>
                <Eye className="h-3.5 w-3.5" /> {done || preview.stale ? 'Preview again' : 'Preview'}
              </Button>
            </div>
            {denied && <p className="text-xs text-amber-300">{denied}.</p>}
            <PreviewResult state={preview.state} stale={preview.stale} action="upgrade" />
            {done && (
              <Button variant="ghost" size="sm" disabled={remote} title={remote ? 'Pulse AI answers about the local cluster only' : undefined}
                onClick={() => askPulse(`I am ${kind === 'values' ? 'changing the values of' : `upgrading to chart ${version}`} Helm release ${r.name} in ${r.namespace} (now chart ${fromChart}, rev ${base.revision}). Help me judge this change.\nPreview:\n${previewText(cur)}`, { kind: 'Namespace', name: r.namespace })}>
                <MessageSquare className="h-3.5 w-3.5" /> Ask Pulse about this change
              </Button>
            )}
            {remote && done && <p className="text-xs text-slate-500">Pulse AI answers about the local cluster only.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-testid="helm-diff-confirm">
          {done ? (
            <>
              <PreviewCounts preview={done} />
              <p className={counts!.unknown ? 'text-xs text-amber-300' : 'text-xs text-emerald-300'}>
                {counts!.unknown ? `${counts!.unknown} object${counts!.unknown === 1 ? '' : 's'} could not be dry-run; the rest were admitted by the API server.` : 'Dry run passed · admitted by the API server'}
              </p>
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">What will change</h4>
                <PreviewObjects preview={done} />
              </section>
              <HooksList hooks={done.hooks} action="upgrade" />
              <PreviewNotes preview={done} />
            </>
          ) : (
            <p className="text-xs text-amber-300" role="alert">Not previewed{cur?.status === 'error' ? `: ${cur.error}` : ''}. What changes was not checked.</p>
          )}
          <dl className="grid grid-cols-1 gap-2 text-xs md:grid-cols-[8rem_1fr]">
            <dt className="text-slate-500">Impact</dt>
            <dd className="text-slate-300">{done ? (restarts.length ? `Rolling restart of ${restarts.join(', ')}.` : 'No workload pod template changes, so no pods restart.') : 'Unknown without a preview.'}</dd>
            <dt className="text-slate-500">Undo</dt>
            <dd className="text-slate-300">Roll back to revision {base.revision} ({fromChart}).{preUpgradeHooks ? ' What the upgrade hooks did is not reversed.' : ''}</dd>
            <dt className="text-slate-500">Options</dt>
            <dd className="text-slate-300">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={atomic} onChange={(e) => setAtomic(e.target.checked)} />
                --atomic (helm rolls back to rev {base.revision} if the upgrade fails) · timeout 5m
              </label>
            </dd>
          </dl>
          <p className="text-xs text-slate-500">After it starts, the Job's progress shows on the Helm releases list; if the release ends failed, Rollback offers rev {base.revision}.</p>
          {action.error && <LoadError title={`The ${kind === 'values' ? 'values upgrade' : 'upgrade'} was not started`} error={action.error} />}
        </div>
      )}
    </Dialog>
  );
}
