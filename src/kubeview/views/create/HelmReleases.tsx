/**
 * The one Helm releases list: chart and version, revision, status, values,
 * and the actions the Helm runner Job supports: edit values (with the chart
 * Helm stored in the release, so no repository is needed), upgrade to another
 * chart version (needs the chart's repository), rollback and uninstall.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dump } from 'js-yaml';
import { Ship, FileText, ArrowUpCircle, RotateCcw, Trash2, Folder, Pencil } from 'lucide-react';
import { k8sFetch } from '../../engine/query';
import { summarizeHelmReleases, valuesBaseRevision, type HelmReleaseSummary } from '../../engine/helmRelease';
import type { Secret } from '../../engine/types';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { Card } from '../../components/primitives/Card';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import DeployProgress from '../../components/DeployProgress';
import { runHelmAction } from './helmRunner';
import { runnerCanManage } from './helmInstall';
import { diffObjects, parseRendered } from '../../engine/helmManifest';
import { fetchReleaseRecord, rollbackHooks } from './helmPreview';
import { HelmUpgradeDialog } from './HelmUpgradeDialog';
import { HooksList, PreviewObjects } from './HelmPreviewPanel';

export interface ChartSource {
  name: string;
  repoName?: string;
  repoUrl?: string;
  /** Versions available in the repo, newest first. */
  versions: string[];
  /** Archive URL per version, from the repo index (for the chart's defaults). */
  urls?: Record<string, string>;
}

export type ReleaseAction =
  | { kind: 'values'; release: HelmReleaseSummary }
  | { kind: 'upgrade'; release: HelmReleaseSummary }
  | { kind: 'rollback'; release: HelmReleaseSummary }
  | { kind: 'uninstall'; release: HelmReleaseSummary };

export function useHelmReleases(nsFilter: string | undefined) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  return useQuery<HelmReleaseSummary[]>({
    queryKey: ['helm', 'release-summaries', clusterId, nsFilter ?? '*'],
    queryFn: async () => {
      const path = nsFilter
        ? `/api/v1/namespaces/${nsFilter}/secrets?labelSelector=owner%3Dhelm`
        : '/api/v1/secrets?labelSelector=owner%3Dhelm';
      const res = await k8sFetch(clusterId, path);
      if (!res.ok) throw new Error(`Helm releases could not be listed (${res.status} ${res.statusText})`);
      const data = await res.json();
      return summarizeHelmReleases((data.items || []) as Secret[]);
    },
    refetchInterval: 30000,
    retry: false,
  });
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'deployed') return 'success';
  if (status === 'failed') return 'error';
  if (status.startsWith('pending')) return 'info';
  return 'warning';
}

export function HelmReleases({ nsFilter, charts }: { nsFilter: string | undefined; charts: ChartSource[] }) {
  const { data: releases = [], error, isLoading, refetch } = useHelmReleases(nsFilter);
  const [valuesFor, setValuesFor] = React.useState<HelmReleaseSummary | null>(null);
  const [job, setJob] = React.useState<{ name: string; ns: string; clusterId: string } | null>(null);
  const action = usePinnedAction<ReleaseAction>();

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
        <Ship className="w-4 h-4 text-blue-400" />
        Helm releases ({releases.length})
        {nsFilter && <span className="text-xs font-normal text-slate-500">in {nsFilter}</span>}
      </h3>

      {job && (
        <div className="mb-3">
          <DeployProgress type="job" name={job.name} namespace={job.ns} clusterId={job.clusterId} onClose={() => setJob(null)} />
        </div>
      )}

      {error ? (
        <LoadError title="Helm releases could not be listed" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <p className="text-xs text-slate-500 py-4 text-center">Loading Helm releases…</p>
      ) : releases.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">No Helm releases installed{nsFilter ? ` in ${nsFilter}` : ''}</p>
      ) : (
        <div className="divide-y divide-slate-800">
          {releases.map((r) => (
            <ReleaseRow key={`${r.namespace}/${r.name}`} release={r} charts={charts}
              onValues={() => setValuesFor(r)}
              onAction={(kind) => action.open({ kind, release: r } as ReleaseAction)} />
          ))}
        </div>
      )}

      {valuesFor && (
        <DrawerShell title={`Values — ${valuesFor.name} (rev ${valuesFor.revision})`} onClose={() => setValuesFor(null)}>
          {valuesFor.values === undefined ? (
            <p className="text-sm text-slate-400">This release record could not be decoded, so its values are not available.</p>
          ) : Object.keys(valuesFor.values).length === 0 ? (
            <p className="text-sm text-slate-400">This revision was installed with the chart's default values (no user-supplied values).</p>
          ) : (
            <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap" aria-label="Release values">{dump(valuesFor.values)}</pre>
          )}
        </DrawerShell>
      )}

      {action.pending && (action.pending.target.kind === 'values' || action.pending.target.kind === 'upgrade') && (
        <HelmUpgradeDialog
          key={`${action.pending.target.kind}-${action.pending.target.release.name}`}
          kind={action.pending.target.kind}
          release={action.pending.target.release}
          action={action}
          charts={charts}
          onStarted={(j) => setJob(j)}
        />
      )}
      {action.pending && (action.pending.target.kind === 'rollback' || action.pending.target.kind === 'uninstall') && (
        <ReleaseActionDialog
          key={`${action.pending.target.kind}-${action.pending.target.release.name}`}
          action={action}
          onStarted={(j) => setJob(j)}
        />
      )}
    </Card>
  );
}

/** Configured repositories that have a chart with this release's chart name. */
function repoCandidates(charts: ChartSource[], release: HelmReleaseSummary): ChartSource[] {
  return charts.filter((c) => c.name === release.chart && !!c.repoUrl);
}

function ReleaseRow({ release, charts, onValues, onAction }: {
  release: HelmReleaseSummary;
  charts: ChartSource[];
  onValues: () => void;
  onAction: (kind: ReleaseAction['kind']) => void;
}) {
  const { allowed: canRun } = useCanI('create', 'batch', 'jobs', release.namespace);
  const denied = canRun ? undefined : `You do not have permission to create Jobs in ${release.namespace}`;
  // Edit values also creates two Secrets (the rebuilt chart and the values).
  const { allowed: canCreateSecrets } = useCanI('create', '', 'secrets', release.namespace);
  const valuesDenied = denied ?? (canCreateSecrets ? undefined : `You do not have permission to create Secrets in ${release.namespace}`);
  const candidates = repoCandidates(charts, release);
  const noRepo = candidates.length === 0
    ? `Upgrading to another chart version needs the chart's repository: ${release.chart ?? 'this chart'} is not in any configured chart repository. Edit values still works with the installed chart.`
    : undefined;
  const newest = candidates.length === 1 ? candidates[0].versions[0] : undefined;
  const upgradeLabel = newest && newest !== release.chartVersion ? `Upgrade to ${newest}` : 'Upgrade';
  return (
    <div className="py-3 flex flex-wrap items-center gap-3" data-testid={`helm-release-${release.name}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-100">{release.name}</span>
          <Badge size="sm" variant={statusVariant(release.status)}>{release.status}</Badge>
          <span className="text-xs text-slate-400">rev {release.revision}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          <span className="flex items-center gap-1"><Folder className="w-3 h-3" />{release.namespace}</span>
          {release.chart && <span>chart {release.chart}{release.chartVersion ? ` ${release.chartVersion}` : ''}</span>}
          {release.appVersion && <span className="text-slate-500">app {release.appVersion}</span>}
          {noRepo && <span className="text-slate-500" data-testid={`helm-no-repo-${release.name}`}>No chart repository configured for upgrades</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={onValues} aria-label={`Values of ${release.name}`}><FileText className="w-3.5 h-3.5" /> Values</Button>
        <Button size="sm" variant="secondary" onClick={() => onAction('values')} disabled={!!valuesDenied} title={valuesDenied} aria-label={`Edit values of ${release.name}`}><Pencil className="w-3.5 h-3.5" /> Edit values</Button>
        <Button size="sm" variant="secondary" onClick={() => onAction('upgrade')} disabled={!canRun || !!noRepo} title={denied ?? noRepo} aria-label={`Upgrade ${release.name}`}><ArrowUpCircle className="w-3.5 h-3.5" /> {upgradeLabel}</Button>
        <Button size="sm" variant="secondary" onClick={() => onAction('rollback')} disabled={!canRun || release.revisions.length < 2}
          title={denied ?? (release.revisions.length < 2 ? 'There is no earlier revision to roll back to' : undefined)} aria-label={`Roll back ${release.name}`}>
          <RotateCcw className="w-3.5 h-3.5" /> Rollback
        </Button>
        <Button size="sm" variant="danger" onClick={() => onAction('uninstall')} disabled={!canRun} title={denied} aria-label={`Uninstall ${release.name}`}><Trash2 className="w-3.5 h-3.5" /> Uninstall</Button>
      </div>
    </div>
  );
}

function ReleaseActionDialog({ action, onStarted }: {
  action: ReturnType<typeof usePinnedAction<ReleaseAction>>;
  onStarted: (job: { name: string; ns: string; clusterId: string }) => void;
}) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const target = action.pending!.target;
  const pinned = action.pending!.clusterId;
  const r = target.release;
  const earlier = r.revisions.filter((rev) => rev.revision !== r.revision);
  const [revision, setRevision] = React.useState<number>(earlier[0]?.revision ?? 0);
  const deployed = valuesBaseRevision(r.revisions) ?? r;
  const targetRev = r.revisions.find((rev) => rev.revision === revision);

  // The runner's Role only covers some kinds; helm fails part-way on anything else.
  const affected = target.kind === 'rollback' ? targetRev?.resources : r.resources;
  const uncovered = affected?.filter((x) => !runnerCanManage(x.apiVersion, x.kind)) ?? [];
  const runnerBlock = affected === undefined
    ? `The release record could not be read, so Pulse cannot check that the Helm runner may manage its resources.`
    : uncovered.length > 0
      ? `This release contains ${[...new Set(uncovered.map((x) => x.kind))].join(', ')}, which the Helm runner's Role in ${r.namespace} cannot manage, so the Job would fail part-way. Run this ${target.kind} with helm and sufficient permissions instead.`
      : null;

  // Rollback: what changes, from the two release records (no render needed).
  const rollbackDiff = useQuery({
    queryKey: ['helm', 'rollback-diff', pinned, r.namespace, deployed.secretName, targetRev?.secretName],
    enabled: target.kind === 'rollback' && !!targetRev && !runnerBlock,
    retry: false,
    queryFn: async () => {
      const [cur, tgt] = await Promise.all([
        fetchReleaseRecord(pinned, r.namespace, deployed.secretName),
        fetchReleaseRecord(pinned, r.namespace, targetRev!.secretName),
      ]);
      const changes = diffObjects(parseRendered(cur.manifest, r.namespace).objects, parseRendered(tgt.manifest, r.namespace).objects);
      return {
        at: Date.now(), action: 'upgrade' as const, warnings: [], testHooks: [],
        hooks: rollbackHooks(tgt, r.namespace),
        entries: changes.map((c) => ({ ...c, check: { status: 'ok' as const, message: '' } })),
      };
    },
  });

  const confirm = () => action.run(`${target.kind} of ${r.name}`, async (t, clusterId) => {
    const rel = t.release;
    const jobName = t.kind === 'rollback'
      ? await runHelmAction(clusterId, rel.namespace, { action: 'rollback', releaseName: rel.name, revision })
      : await runHelmAction(clusterId, rel.namespace, { action: 'uninstall', releaseName: rel.name });
    addToast({ type: 'success', title: `Helm ${t.kind} started`, detail: `${rel.name} in ${rel.namespace} (Job ${jobName})` });
    onStarted({ name: jobName, ns: rel.namespace, clusterId });
    queryClient.invalidateQueries({ queryKey: ['helm'] });
  });

  const blocked = !!runnerBlock;
  const resourceSummary = affected?.length ? `${affected.length} object${affected.length === 1 ? '' : 's'}: ${[...new Set(affected.map((x) => x.kind))].join(', ')}` : 'no objects';
  const title = target.kind === 'rollback' ? `Roll back ${r.name}?` : `Uninstall ${r.name}?`;
  const description = target.kind === 'rollback'
    ? `Runs "helm rollback ${r.name} ${revision}" in ${r.namespace} as a Job. The release returns to rev ${revision}'s chart and values as a new revision (rev ${r.revision + 1}).`
    : `Runs "helm uninstall ${r.name}" in ${r.namespace} as a Job. Helm deletes the objects it recorded for rev ${r.revision} (${resourceSummary}) — except any the chart marks "keep" — and removes the release history.`;

  return (
    <ConfirmDialog
      open
      onClose={action.close}
      onConfirm={() => { if (blocked) action.close(); else void confirm(); }}
      title={title}
      description={description}
      confirmLabel={blocked ? 'Close' : target.kind === 'rollback' ? 'Roll back' : 'Uninstall'}
      variant={target.kind === 'uninstall' ? 'danger' : 'warning'}
      loading={action.running}
    >
      {runnerBlock && <LoadError className="mt-3" title={`The ${target.kind} cannot run from Pulse`} error={runnerBlock} />}
      {target.kind === 'rollback' && earlier.length > 0 && (
        <label className="mt-3 block text-xs text-slate-400">
          Revision
          <select aria-label="Revision" value={revision} onChange={(e) => setRevision(Number(e.target.value))}
            className="mt-1 w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-sm text-slate-200">
            {earlier.map((rev) => (
              <option key={rev.revision} value={rev.revision}>
                rev {rev.revision} — {rev.status}{rev.chartVersion ? `, chart ${rev.chartVersion}` : ''}{rev.updated ? `, ${new Date(rev.updated).toLocaleString()}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {target.kind === 'rollback' && !blocked && (
        <div className="mt-3 space-y-2" data-testid="rollback-diff">
          <div className="text-xs font-medium text-slate-300">What changes, rev {deployed.revision} (running) → rev {revision}</div>
          {rollbackDiff.error ? <LoadError title="The revisions could not be compared" error={rollbackDiff.error} />
            : !rollbackDiff.data ? <p className="text-xs text-slate-500">Comparing the release records…</p>
              : <><PreviewObjects preview={rollbackDiff.data} /><HooksList hooks={rollbackDiff.data.hooks} action="rollback" /></>}
          <p className="text-xs text-slate-500">Undo: roll back to rev {deployed.revision} the same way.</p>
        </div>
      )}
      {action.error && <LoadError className="mt-3" title={`The ${target.kind} was not started`} error={action.error} />}
    </ConfirmDialog>
  );
}
