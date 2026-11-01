import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Search, Ship, Loader2, Plus, Trash2, RefreshCw } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { k8sFetch } from '../../engine/query';
import { useFleetStore } from '../../store/fleetStore';
import DeployProgress from '../../components/DeployProgress';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { FormField } from './FormField';
import { Card } from '../../components/primitives/Card';
import { showErrorToast } from '../../engine/errorToast';
import { load } from 'js-yaml';
import { runHelmAction } from './helmRunner';
import { HelmReleases } from './HelmReleases';
import { NamespacePicker, useInitialNamespace, isNamespaceName } from './NamespacePicker';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { LoadError } from '../../components/primitives/LoadError';

/** HelmChartRepository CRD — not yet in engine/types, defined locally. */
interface HelmChartRepository {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; uid?: string; [key: string]: unknown };
  spec?: { connectionConfig?: { url?: string }; [key: string]: unknown };
  status?: {
    conditions?: Array<{ type: string; status: string; [key: string]: unknown }>;
    charts?: Array<{ name: string; version?: string; appVersion?: string; description?: string; icon?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const DEFAULT_REPO_URL = 'https://charts.openshift.io';

interface HelmChart {
  name: string;
  version: string;
  /** Every version in the repo index, newest first (as the index lists them). */
  versions: string[];
  appVersion: string;
  description: string;
  icon?: string;
  repoName?: string;
  repoUrl?: string;
}

interface HelmRepo {
  name: string;
  url: string;
  isDefault: boolean;
  isReady: boolean;
  chartCount: number;
}

export function parseHelmIndex(text: string, repoName: string, repoUrl: string): HelmChart[] {
  // Helm index.yaml: `entries:` maps chart name -> list of versions (newest
  // first). The first entry describes the chart; every entry adds a version.
  const charts: HelmChart[] = [];
  let current: HelmChart | null = null;
  let entryIndex = -1;
  let entryIndent = -1; // indent of this chart's `- ` list items
  let inEntries = false;
  const finish = () => { if (current?.name) charts.push(current); };
  for (const line of text.split('\n')) {
    if (/^entries:/.test(line)) { inEntries = true; continue; }
    if (!inEntries) continue;
    if (/^\S/.test(line)) { inEntries = false; continue; }
    const top = line.match(/^  ([a-zA-Z0-9_.-]+):\s*$/);
    if (top) {
      finish();
      current = { name: '', version: '', versions: [], appVersion: '', description: '', repoName, repoUrl };
      entryIndex = -1;
      entryIndent = -1;
      continue;
    }
    if (!current) continue;
    const item = line.match(/^( *)- (?:(\w+):\s*(.*))?$/);
    if (item && (entryIndent === -1 || item[1].length === entryIndent)) {
      entryIndent = item[1].length;
      entryIndex++;
      if (item[2]) applyField(current, entryIndex, item[2], item[3]);
      continue;
    }
    // Only the entry's own fields (two deeper than its `- `), not nested ones such as maintainers.
    const field = line.match(/^( *)(\w+):\s*(.+)$/);
    if (field && entryIndent >= 0 && field[1].length === entryIndent + 2) applyField(current, entryIndex, field[2], field[3]);
  }
  finish();
  return charts;
}

function applyField(chart: HelmChart, entryIndex: number, key: string, rawVal: string) {
  const val = rawVal.replace(/^['"]|['"]$/g, '').trim();
  if (key === 'version') {
    if (!chart.versions.includes(val)) chart.versions.push(val);
    if (entryIndex === 0 && !chart.version) chart.version = val;
    return;
  }
  if (entryIndex !== 0) return;
  if (key === 'name' && !chart.name) chart.name = val;
  else if (key === 'appVersion' && !chart.appVersion) chart.appVersion = val;
  else if (key === 'description' && !chart.description) chart.description = val;
  else if (key === 'icon' && !chart.icon) chart.icon = val;
}

export function HelmTab() {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  // Releases, repos and installs all belong to the cluster on screen.
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const [search, setSearch] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const initialNs = useInitialNamespace();
  const [installNs, setInstallNs] = useState(initialNs);
  const [installVersion, setInstallVersion] = useState('');
  const [installValues, setInstallValues] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const install = usePinnedAction<{ chart: HelmChart; releaseName: string; ns: string; version: string; values: string }>();
  const [selectedChart, setSelectedChart] = useState<HelmChart | null>(null);
  const [installedJob, setInstalledJob] = useState<{ name: string; ns: string; clusterId: string } | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [deleteRepo, setDeleteRepo] = useState<string | null>(null);

  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Fetch chart repos from OpenShift HelmChartRepository CRDs
  const { data: chartRepoCRDs = [] } = useQuery({
    queryKey: ['helm', 'repos', clusterId],
    queryFn: async () => {
      const res = await k8sFetch(clusterId, '/apis/helm.openshift.io/v1beta1/helmchartrepositories');
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []) as HelmChartRepository[];
    },
    staleTime: 60000,
  });

  // Build repo list: cluster repos + default fallback
  const repos: HelmRepo[] = chartRepoCRDs.map((r) => ({
    name: r.metadata?.name || '',
    url: r.spec?.connectionConfig?.url || '',
    isDefault: false,
    isReady: (r.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
    chartCount: 0,
  }));

  const hasDefaultRepo = repos.some(r => r.url === DEFAULT_REPO_URL || r.url === DEFAULT_REPO_URL + '/');
  if (!hasDefaultRepo) {
    repos.unshift({ name: 'openshift-charts', url: DEFAULT_REPO_URL, isDefault: true, isReady: true, chartCount: 0 });
  }

  // Fetch charts from all repos
  const { data: chartCatalog = [], isLoading: chartsLoading } = useQuery<HelmChart[]>({
    queryKey: ['helm', 'charts', 'index', repos.map(r => r.url).join(',')],
    queryFn: async () => {
      const allCharts: HelmChart[] = [];

      for (const repo of repos) {
        if (!repo.url) continue;

        // Try fetching from cluster CRD status first (for non-default repos)
        if (!repo.isDefault) {
          const crd = chartRepoCRDs.find((r) => r.metadata?.name === repo.name);
          if (crd?.status?.charts?.length) {
            for (const chart of crd.status.charts) {
              allCharts.push({
                name: chart.name,
                version: chart.version || '',
                versions: chart.version ? [chart.version] : [],
                appVersion: chart.appVersion || '',
                description: chart.description || '',
                icon: chart.icon,
                repoName: repo.name,
                repoUrl: repo.url,
              });
            }
            continue;
          }
        }

        // Fetch index.yaml directly (for default repo or repos without status)
        try {
          const indexUrl = repo.url.endsWith('/') ? `${repo.url}index.yaml` : `${repo.url}/index.yaml`;
          const res = await fetch(indexUrl);
          if (res.ok) {
            const text = await res.text();
            const parsed = parseHelmIndex(text, repo.name, repo.url);
            allCharts.push(...parsed);
          }
        } catch (err) { showErrorToast(err, 'Failed to load Helm chart'); }
      }

      return allCharts;
    },
    staleTime: 300000,
    enabled: repos.length > 0,
  });

  // Update repo chart counts
  for (const repo of repos) {
    repo.chartCount = chartCatalog.filter(c => c.repoName === repo.name).length;
  }

  const filteredCharts = search
    ? chartCatalog.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()))
    : chartCatalog;

  // Validate the form, then confirm with exactly what will run.
  const requestInstall = () => {
    if (!selectedChart) return;
    const sanitizedName = releaseName.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,52}$/.test(sanitizedName)) {
      setFormError('Release name must start with a lowercase letter or number, contain only lowercase letters, numbers, and hyphens, and be at most 53 characters.');
      return;
    }
    if (!isNamespaceName(installNs)) {
      setFormError('Choose the namespace to install into.');
      return;
    }
    const repoUrl = selectedChart.repoUrl || DEFAULT_REPO_URL;
    if (!/^https?:\/\/.+/.test(repoUrl)) {
      setFormError('Repository URL must start with http:// or https://');
      return;
    }
    if (installValues.trim()) {
      try {
        const parsed = load(installValues);
        if (parsed !== null && typeof parsed !== 'object') throw new Error('Values must be a YAML mapping');
      } catch (e) {
        setFormError(`Values are not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    setFormError(null);
    install.open({ chart: selectedChart, releaseName: sanitizedName, ns: installNs, version: installVersion || selectedChart.version, values: installValues });
  };

  const confirmInstall = () => install.run('Installing this chart', async (t, pinnedCluster) => {
    const jobName = await runHelmAction(pinnedCluster, t.ns, {
      action: 'install',
      releaseName: t.releaseName,
      chartName: t.chart.name,
      repoUrl: t.chart.repoUrl || DEFAULT_REPO_URL,
      version: t.version || undefined,
    }, t.values);
    addToast({ type: 'success', title: 'Helm install started', detail: `${t.chart.name} as "${t.releaseName}" in ${t.ns}` });
    setInstalledJob({ name: jobName, ns: t.ns, clusterId: pinnedCluster });
    setSelectedChart(null);
    setReleaseName('');
    setInstallValues('');
    queryClient.invalidateQueries({ queryKey: ['helm'] });
  });

  const handleAddRepo = async () => {
    if (!newRepoName.trim() || !newRepoUrl.trim()) return;
    setAddingRepo(true);
    try {
      const repo = {
        apiVersion: 'helm.openshift.io/v1beta1',
        kind: 'HelmChartRepository',
        metadata: { name: newRepoName.trim() },
        spec: {
          connectionConfig: { url: newRepoUrl.trim() },
        },
      };
      const res = await k8sFetch(clusterId, '/apis/helm.openshift.io/v1beta1/helmchartrepositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repo),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }
      addToast({ type: 'success', title: `Repository "${newRepoName}" added` });
      setShowAddRepo(false);
      setNewRepoName('');
      setNewRepoUrl('');
      queryClient.invalidateQueries({ queryKey: ['helm', 'repos'] });
      queryClient.invalidateQueries({ queryKey: ['helm', 'charts'] });
    } catch (err) {
      showErrorToast(err, 'Failed to add repository');
    }
    setAddingRepo(false);
  };

  const handleDeleteRepo = async (repoName: string) => {
    try {
      const res = await k8sFetch(clusterId, `/apis/helm.openshift.io/v1beta1/helmchartrepositories/${encodeURIComponent(repoName)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }
      addToast({ type: 'success', title: `Repository "${repoName}" removed` });
      queryClient.invalidateQueries({ queryKey: ['helm', 'repos'] });
      queryClient.invalidateQueries({ queryKey: ['helm', 'charts'] });
    } catch (err) {
      showErrorToast(err, 'Failed to remove repository');
    }
    setDeleteRepo(null);
  };

  return (
    <div className="space-y-6">
      {installedJob && (
        <DeployProgress
          type="job"
          name={installedJob.name}
          namespace={installedJob.ns}
          clusterId={installedJob.clusterId}
          onClose={() => setInstalledJob(null)}
        />
      )}

      {/* Repositories */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Ship className="w-4 h-4 text-blue-400" />
            Chart Repositories ({repos.length})
          </h3>
          <button onClick={() => setShowAddRepo(!showAddRepo)}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            <Plus className="w-3 h-3" /> Add Repository
          </button>
        </div>

        {/* Add repo form */}
        {showAddRepo && (
          <div className="mb-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormField label="Repository Name" required value={newRepoName} onChange={setNewRepoName} placeholder="my-charts" />
              <FormField label="Repository URL" required value={newRepoUrl} onChange={setNewRepoUrl} placeholder="https://charts.example.com" />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleAddRepo} disabled={addingRepo || !newRepoName.trim() || !newRepoUrl.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-sm disabled:opacity-50">
                {addingRepo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                {addingRepo ? 'Adding...' : 'Add'}
              </button>
              <button onClick={() => { setShowAddRepo(false); setNewRepoName(''); setNewRepoUrl(''); }}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
              <span className="text-xs text-slate-500">Creates a HelmChartRepository CRD on the cluster</span>
            </div>
          </div>
        )}

        {/* Repo list */}
        <div className="space-y-2">
          {repos.map((repo) => (
            <div key={repo.name} className="flex items-center justify-between px-3 py-2 bg-slate-800/30 rounded-sm border border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn('w-2 h-2 rounded-full shrink-0', repo.isReady ? 'bg-green-500' : 'bg-yellow-500')} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{repo.name}</span>
                    {repo.isDefault && (
                      <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded-sm">default</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono truncate">{repo.url}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">{repo.chartCount} chart{repo.chartCount !== 1 ? 's' : ''}</span>
                {!repo.isDefault && (
                  <button onClick={() => setDeleteRepo(repo.name)}
                    className="p-1 text-slate-500 hover:text-red-400 rounded-sm hover:bg-slate-700 transition-colors" title="Remove repository">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <HelmReleases
        nsFilter={nsFilter}
        charts={chartCatalog.map((c) => ({ name: c.name, repoName: c.repoName, repoUrl: c.repoUrl, versions: c.versions }))}
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search charts..." className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Install form */}
      {selectedChart && (
        <div className="bg-blue-950/30 rounded-lg border border-blue-800 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-200">Install {selectedChart.name}</h3>
          <p className="text-xs text-slate-400">{selectedChart.description}</p>
          <div className="text-xs text-slate-500">From: <span className="text-slate-300">{selectedChart.repoName}</span></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormField label="Release Name" required value={releaseName} onChange={setReleaseName} placeholder={`my-${selectedChart.name}`} />
            <NamespacePicker value={installNs} onChange={setInstallNs} />
            <label className="block text-xs text-slate-400">
              Chart version
              <select aria-label="Chart version" value={installVersion || selectedChart.version} onChange={(e) => setInstallVersion(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-sm text-slate-200">
                {(selectedChart.versions.length ? selectedChart.versions : [selectedChart.version]).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-slate-400">
            Values (YAML, optional — the chart's defaults apply to anything not set here)
            <textarea aria-label="Values" value={installValues} onChange={(e) => setInstallValues(e.target.value)} rows={5}
              className="mt-1 w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded-sm text-slate-200" />
          </label>
          {formError && <LoadError title="Cannot install yet" error={formError} />}
          <div className="flex items-center gap-2">
            <button onClick={requestInstall} disabled={!releaseName.trim() || !installNs} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-sm disabled:opacity-50">
              <Ship className="w-4 h-4" /> Install
            </button>
            <button onClick={() => { setSelectedChart(null); setFormError(null); }} className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!install.pending}
        onClose={install.close}
        onConfirm={confirmInstall}
        title={install.pending ? `Install ${install.pending.target.chart.name} in ${install.pending.target.ns}?` : ''}
        description={install.pending ? `Runs "helm install ${install.pending.target.releaseName} ${install.pending.target.chart.name} --version ${install.pending.target.version}" from ${install.pending.target.chart.repoName ?? install.pending.target.chart.repoUrl} as a Job in ${install.pending.target.ns}${install.pending.target.values.trim() ? ', with your values (stored in a Secret the Job mounts)' : ' with the chart\'s default values'}. The Job's ServiceAccount gets a Role in ${install.pending.target.ns} to create the chart's resources.` : ''}
        confirmLabel="Install"
        variant="warning"
        loading={install.running}
      >
        {install.error && <LoadError className="mt-3" title="The install was not started" error={install.error} />}
      </ConfirmDialog>

      {/* Chart catalog */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">
            {chartsLoading ? 'Loading charts...' : `Charts (${filteredCharts.length})`}
          </span>
          {repos.length > 1 && (
            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded-sm">{repos.length} repos</span>
          )}
        </div>
        <button onClick={() => { queryClient.invalidateQueries({ queryKey: ['helm', 'charts'] }); }}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {chartsLoading && (
          <div className="col-span-full text-center py-8 text-sm text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading charts from repositories...
          </div>
        )}
        {!chartsLoading && filteredCharts.length === 0 && (
          <div className="col-span-full text-center py-8">
            <Ship className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <div className="text-sm text-slate-500">
              {chartCatalog.length === 0 ? 'No charts available — check repository connectivity' : 'No charts match your search'}
            </div>
          </div>
        )}
        {filteredCharts.map((chart) => (
          <button key={`${chart.repoName || 'default'}-${chart.name}`} onClick={() => { setSelectedChart(chart); setReleaseName(`my-${chart.name}`); setInstallVersion(chart.version); setFormError(null); }}
            className="flex items-start gap-3 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-blue-600 transition-colors text-left">
            {chart.icon ? (
              <img src={chart.icon} alt="" className="w-8 h-8 rounded-sm shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <Ship className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200">{chart.name}</span>
                <span className="text-xs text-slate-500 font-mono">{chart.version}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1 line-clamp-2">{chart.description}</div>
              <div className="flex items-center gap-2 mt-1">
                {chart.appVersion && <span className="text-xs text-slate-600">App: v{chart.appVersion}</span>}
                {chart.repoName && <span className="text-xs text-slate-600">· {chart.repoName}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Delete repo confirmation */}
      {deleteRepo && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteRepo(null)}
          onConfirm={() => handleDeleteRepo(deleteRepo)}
          title={`Remove repository "${deleteRepo}"?`}
          description="This will delete the HelmChartRepository CRD from the cluster. Charts from this repository will no longer be available."
          confirmLabel="Remove"
          variant="danger"
        />
      )}
    </div>
  );
}
