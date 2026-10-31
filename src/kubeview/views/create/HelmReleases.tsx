/**
 * The one Helm releases list: chart and version, revision, status, values,
 * and the actions the Helm runner Job supports (upgrade, rollback, uninstall).
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dump, load } from 'js-yaml';
import { Ship, FileText, ArrowUpCircle, RotateCcw, Trash2, Folder } from 'lucide-react';
import { k8sFetch } from '../../engine/query';
import { summarizeHelmReleases, type HelmReleaseSummary } from '../../engine/helmRelease';
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

export interface ChartSource {
  name: string;
  repoName?: string;
  repoUrl?: string;
  /** Versions available in the repo, newest first. */
  versions: string[];
}

type ReleaseAction =
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
            <ReleaseRow key={`${r.namespace}/${r.name}`} release={r}
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

      {action.pending && (
        <ReleaseActionDialog
          key={`${action.pending.target.kind}-${action.pending.target.release.name}`}
          action={action}
          charts={charts}
          onStarted={(j) => setJob(j)}
        />
      )}
    </Card>
  );
}

function ReleaseRow({ release, onValues, onAction }: {
  release: HelmReleaseSummary;
  onValues: () => void;
  onAction: (kind: ReleaseAction['kind']) => void;
}) {
  const { allowed: canRun } = useCanI('create', 'batch', 'jobs', release.namespace);
  const denied = canRun ? undefined : `You do not have permission to create Jobs in ${release.namespace}`;
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
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={onValues} aria-label={`Values of ${release.name}`}><FileText className="w-3.5 h-3.5" /> Values</Button>
        <Button size="sm" variant="secondary" onClick={() => onAction('upgrade')} disabled={!canRun} title={denied} aria-label={`Upgrade ${release.name}`}><ArrowUpCircle className="w-3.5 h-3.5" /> Upgrade</Button>
        <Button size="sm" variant="secondary" onClick={() => onAction('rollback')} disabled={!canRun || release.revisions.length < 2}
          title={denied ?? (release.revisions.length < 2 ? 'There is no earlier revision to roll back to' : undefined)} aria-label={`Roll back ${release.name}`}>
          <RotateCcw className="w-3.5 h-3.5" /> Rollback
        </Button>
        <Button size="sm" variant="danger" onClick={() => onAction('uninstall')} disabled={!canRun} title={denied} aria-label={`Uninstall ${release.name}`}><Trash2 className="w-3.5 h-3.5" /> Uninstall</Button>
      </div>
    </div>
  );
}

function ReleaseActionDialog({ action, charts, onStarted }: {
  action: ReturnType<typeof usePinnedAction<ReleaseAction>>;
  charts: ChartSource[];
  onStarted: (job: { name: string; ns: string; clusterId: string }) => void;
}) {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const target = action.pending!.target;
  const r = target.release;
  const source = charts.find((c) => c.name === r.chart);
  const [version, setVersion] = React.useState(source?.versions[0] ?? '');
  const [valuesText, setValuesText] = React.useState(r.values && Object.keys(r.values).length > 0 ? dump(r.values) : '');
  const [valuesError, setValuesError] = React.useState<string | null>(null);
  const earlier = r.revisions.filter((rev) => rev.revision !== r.revision);
  const [revision, setRevision] = React.useState<number>(earlier[0]?.revision ?? 0);

  const confirm = () => {
    if (target.kind === 'upgrade') {
      try {
        const parsed = valuesText.trim() ? load(valuesText) : {};
        if (parsed !== null && typeof parsed !== 'object') throw new Error('Values must be a YAML mapping');
        setValuesError(null);
      } catch (e) {
        setValuesError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    return action.run(`${target.kind} of ${r.name}`, async (t, clusterId) => {
      const rel = t.release;
      let jobName: string;
      if (t.kind === 'upgrade') {
        if (!source?.repoUrl) throw new Error(`Chart ${rel.chart ?? '(unknown)'} is not in any configured repository`);
        jobName = await runHelmAction(clusterId, rel.namespace, { action: 'upgrade', releaseName: rel.name, chartName: source.name, repoUrl: source.repoUrl, version: version || undefined }, valuesText);
      } else if (t.kind === 'rollback') {
        jobName = await runHelmAction(clusterId, rel.namespace, { action: 'rollback', releaseName: rel.name, revision });
      } else {
        jobName = await runHelmAction(clusterId, rel.namespace, { action: 'uninstall', releaseName: rel.name });
      }
      addToast({ type: 'success', title: `Helm ${t.kind} started`, detail: `${rel.name} in ${rel.namespace} (Job ${jobName})` });
      onStarted({ name: jobName, ns: rel.namespace, clusterId });
      queryClient.invalidateQueries({ queryKey: ['helm'] });
    });
  };

  const upgradeBlocked = target.kind === 'upgrade' && !source?.repoUrl;
  const title = target.kind === 'upgrade' ? `Upgrade ${r.name}?` : target.kind === 'rollback' ? `Roll back ${r.name}?` : `Uninstall ${r.name}?`;
  const description = target.kind === 'upgrade'
    ? upgradeBlocked
      ? `The chart ${r.chart ?? '(unknown)'} is not in any configured chart repository, so Pulse cannot fetch a version to upgrade to. Add its repository under Chart Repositories first.`
      : `Runs "helm upgrade ${r.name} ${r.chart}${version ? ` --version ${version}` : ''}" from ${source?.repoName ?? source?.repoUrl} in ${r.namespace} as a Job, with the values below (replacing rev ${r.revision}'s user values). The release moves to rev ${r.revision + 1}.`
    : target.kind === 'rollback'
      ? `Runs "helm rollback ${r.name} ${revision}" in ${r.namespace} as a Job. The release returns to rev ${revision}'s chart and values as a new revision (rev ${r.revision + 1}).`
      : `Runs "helm uninstall ${r.name}" in ${r.namespace} as a Job. Every resource the chart created is deleted, and the release history is removed.`;

  return (
    <ConfirmDialog
      open
      onClose={action.close}
      onConfirm={() => { if (upgradeBlocked) action.close(); else void confirm(); }}
      title={title}
      description={description}
      confirmLabel={upgradeBlocked ? 'Close' : target.kind === 'upgrade' ? 'Upgrade' : target.kind === 'rollback' ? 'Roll back' : 'Uninstall'}
      variant={target.kind === 'uninstall' ? 'danger' : 'warning'}
      loading={action.running}
    >
      {target.kind === 'upgrade' && !upgradeBlocked && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-slate-400">
            Chart version
            <select aria-label="Chart version" value={version} onChange={(e) => setVersion(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-sm text-slate-200">
              {(source?.versions ?? []).map((v) => <option key={v} value={v}>{v}{v === r.chartVersion ? ' (installed)' : ''}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-400">
            Values (YAML)
            <textarea aria-label="Values" value={valuesText} onChange={(e) => setValuesText(e.target.value)} rows={8}
              className="mt-1 w-full px-2 py-1.5 text-xs font-mono bg-slate-900 border border-slate-600 rounded-sm text-slate-200" />
          </label>
          {valuesError && <LoadError title="The values are not valid YAML" error={valuesError} />}
        </div>
      )}
      {target.kind === 'rollback' && (
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
      {action.error && <LoadError className="mt-3" title={`The ${target.kind} was not started`} error={action.error} />}
    </ConfirmDialog>
  );
}
