/**
 * Install a chart, preview before apply (HelmInstall mock): release name,
 * namespace and version; chart defaults beside the overrides; "Preview
 * rendered manifests" through the Helm runner; then install the previewed
 * objects. Install stays off while the preview finds an object that would fail.
 */
import { Eye, Ship, MessageSquare } from 'lucide-react';
import { FormField } from './FormField';
import { NamespacePicker } from './NamespacePicker';
import { LoadError } from '../../components/primitives/LoadError';
import { Button } from '../../components/primitives/Button';
import { HelmValuesPanel, useChartDefaults } from './HelmValuesPanel';
import { canSkipPreview, PreviewResult, previewDisabledReason, usePreviewPermission, type useHelmPreview } from './HelmPreviewPanel';
import { previewCounts } from './helmPreview';
import { askPulse } from '../../engine/askPulse';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import type { HelmChart } from './HelmTab';

export function previewText(state: ReturnType<typeof useHelmPreview>['current']): string {
  if (!state || state.status !== 'done') return 'No preview yet.';
  const p = state.preview;
  const c = previewCounts(p);
  const lines = p.entries.filter((e) => e.change !== 'unchanged').map((e) => `- ${e.change} ${e.kind}/${e.name}${e.check.status !== 'ok' ? ` (${e.check.status === 'fail' ? 'would fail' : 'could not check'}: ${e.check.message})` : ''}`);
  return `${c.added} added, ${c.changed} changed, ${c.removed} removed, ${c.failing} would fail, ${c.unknown} could not be checked.\n${lines.join('\n')}\nHooks: ${p.hooks.map((h) => `${h.hook!.events.join(',')} ${h.kind}/${h.name}`).join('; ') || 'none'}`;
}

export function InstallPanel(props: {
  chart: HelmChart;
  releaseName: string;
  onReleaseName: (v: string) => void;
  ns: string;
  onNs: (v: string) => void;
  version: string;
  onVersion: (v: string) => void;
  values: string;
  onValues: (v: string) => void;
  formError: string | null;
  onInstall: () => void;
  onCancel: () => void;
  preview: ReturnType<typeof useHelmPreview>;
  previewKey: string;
  onPreview: () => void;
  clusterId: string;
}) {
  const { chart, preview } = props;
  const defaults = useChartDefaults({ from: 'repo', repoUrl: chart.repoUrl ?? '', chartUrl: chart.urls?.[props.version], chartName: chart.name, version: props.version });
  const perm = usePreviewPermission(props.ns);
  const denied = previewDisabledReason(perm);
  const cur = preview.current;
  const running = cur?.status === 'running';
  const clean = cur?.status === 'done' && preview.blockers === 0;
  const canInstallUnpreviewed = canSkipPreview(perm, cur);
  const remote = props.clusterId !== LOCAL_CLUSTER_ID;
  const objects = cur?.status === 'done' ? cur.preview.entries.filter((e) => !e.key.startsWith('hook:')).length : 0;

  return (
    <div className="space-y-4 rounded-lg border border-blue-800 bg-blue-950/30 p-4" data-testid="helm-install-panel">
      <div>
        <h3 className="text-sm font-semibold text-blue-200">Install {chart.name}</h3>
        <p className="text-xs text-slate-400">from repository <span className="text-slate-300">{chart.repoName}</span>{chart.repoUrl ? ` (${chart.repoUrl})` : ''}{chart.appVersion ? ` · app version ${chart.appVersion}` : ''}</p>
        {chart.description && <p className="mt-1 text-xs text-faint">{chart.description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FormField label="Release Name" required value={props.releaseName} onChange={props.onReleaseName} placeholder={`my-${chart.name}`} />
        <NamespacePicker value={props.ns} onChange={props.onNs} />
        <label className="block text-xs text-slate-400">
          Chart version
          <select aria-label="Chart version" value={props.version} onChange={(e) => props.onVersion(e.target.value)}
            className="mt-1 w-full rounded-sm border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            {(chart.versions.length ? chart.versions : [chart.version]).map((v, i) => <option key={v} value={v}>{v}{i === 0 ? ' (latest)' : ''}</option>)}
          </select>
        </label>
      </div>
      <HelmValuesPanel defaults={defaults} overrides={props.values} onOverridesChange={props.onValues} />

      <div className="space-y-2 rounded-md border border-slate-800 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-slate-200">Preview rendered manifests</div>
            <div className="text-xs text-faint">Runs helm template in the Helm runner Job, then a server dry run of each object. Nothing is applied.</div>
          </div>
          <Button variant="secondary" onClick={props.onPreview} disabled={running || !!denied} title={denied} loading={running}>
            <Eye className="h-3.5 w-3.5" /> {cur?.status === 'done' || preview.stale ? 'Preview again' : 'Preview'}
          </Button>
        </div>
        {perm.state === 'checking' && <p className="text-xs text-slate-400" role="status">Checking your permissions…</p>}
        {perm.state === 'denied' && <p className="text-xs text-amber-300">{perm.reason}.</p>}
        <PreviewResult state={preview.state} stale={preview.stale} action="install" />
        {cur?.status === 'done' && (
          <p className="text-xs text-slate-400"><span className="text-faint">Undo:</span> uninstall the release, which deletes what it created (objects the chart marks "keep" stay).</p>
        )}
      </div>

      {props.formError && <LoadError title="Cannot preview or install yet" error={props.formError} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={props.onInstall} disabled={!clean} title={clean ? undefined : cur?.status === 'done' ? 'Fix what would fail first; the preview reruns when you change the values' : 'Preview first'}>
          <Ship className="h-4 w-4" /> {clean ? `Install ${objects} objects` : 'Install'}
        </Button>
        {canInstallUnpreviewed && <Button variant="secondary" onClick={props.onInstall}>Install without a preview</Button>}
        <Button variant="ghost" onClick={props.onCancel}>Cancel</Button>
        {cur?.status === 'done' && preview.blockers > 0 && <span className="text-xs text-red-300">Fix {preview.blockers} item{preview.blockers === 1 ? '' : 's'} first: {cur.preview.entries.filter((e) => e.check.status === 'fail').map((e) => `${e.kind}/${e.name}`).join(', ')}.</span>}
        {cur?.status === 'done' && (
          <Button variant="ghost" size="sm" disabled={remote} title={remote ? 'Pulse AI answers about the local cluster only' : undefined}
            onClick={() => askPulse(`I am installing Helm chart ${chart.name} ${props.version} as release ${props.releaseName} in namespace ${props.ns}. Help me fix what the preview found.\nMy overrides:\n${props.values || '(none)'}\nPreview:\n${previewText(cur)}`, { kind: 'Namespace', name: props.ns })}>
            <MessageSquare className="h-3.5 w-3.5" /> Ask Pulse about this preview
          </Button>
        )}
      </div>
      {remote && cur?.status === 'done' && <p className="text-xs text-faint">Pulse AI answers about the local cluster only.</p>}
    </div>
  );
}
