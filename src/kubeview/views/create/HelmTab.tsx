import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Search, Ship, Loader2, Plus, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { K8S_BASE as BASE } from '../../engine/gvr';
import DeployProgress from '../../components/DeployProgress';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { FormField } from './FormField';
import type { Secret } from '../../engine/types';

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

function parseHelmIndex(text: string, repoName: string, repoUrl: string): HelmChart[] {
  const charts: HelmChart[] = [];
  const seen = new Set<string>();

  // Helm index.yaml has entries: map of chart name -> array of versions
  // Each version block has: name, version, appVersion, description, icon, etc.
  // We split by top-level chart entries and parse each
  const lines = text.split('\n');
  let currentChart: Partial<HelmChart> = {};
  let inEntries = false;
  let indent = 0;

  for (const line of lines) {
    if (line.match(/^entries:/)) {
      inEntries = true;
      continue;
    }
    if (!inEntries) continue;

    // Top-level chart name (2-space indent under entries)
    const topMatch = line.match(/^  ([a-zA-Z0-9_.-]+):/);
    if (topMatch) {
      // Save previous if exists
      if (currentChart.name && !seen.has(currentChart.name)) {
        seen.add(currentChart.name);
        charts.push({
          name: currentChart.name,
          version: currentChart.version || '',
          appVersion: currentChart.appVersion || '',
          description: currentChart.description || '',
          icon: currentChart.icon,
          repoName,
          repoUrl,
        });
      }
      currentChart = {};
      continue;
    }

    // Version entry start (4-space indent, starts with -)
    if (line.match(/^    - /)) {
      // If we already have a chart from this entry, skip subsequent versions
      if (currentChart.name && seen.has(currentChart.name)) continue;
      // Reset for new version entry
      if (!currentChart.name) currentChart = {};
      continue;
    }

    // Fields within a version entry (6+ space indent)
    const fieldMatch = line.match(/^\s{6,}(\w+):\s*(.+)/);
    if (fieldMatch && !seen.has(currentChart.name || '')) {
      const [, key, rawVal] = fieldMatch;
      const val = rawVal.replace(/^['"]|['"]$/g, '').trim();
      if (key === 'name' && !currentChart.name) currentChart.name = val;
      else if (key === 'version' && !currentChart.version) currentChart.version = val;
      else if (key === 'appVersion' && !currentChart.appVersion) currentChart.appVersion = val;
      else if (key === 'description' && !currentChart.description) currentChart.description = val;
      else if (key === 'icon' && !currentChart.icon) currentChart.icon = val;
    }
  }

  // Don't forget last chart
  if (currentChart.name && !seen.has(currentChart.name)) {
    charts.push({
      name: currentChart.name,
      version: currentChart.version || '',
      appVersion: currentChart.appVersion || '',
      description: currentChart.description || '',
      icon: currentChart.icon,
      repoName,
      repoUrl,
    });
  }

  return charts;
}

export function HelmTab() {
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [releaseName, setReleaseName] = useState('');
  const [selectedChart, setSelectedChart] = useState<HelmChart | null>(null);
  const [installedJob, setInstalledJob] = useState<{ name: string; ns: string } | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [deleteRepo, setDeleteRepo] = useState<string | null>(null);

  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';

  // Fetch Helm releases (secrets with owner=helm)
  const { data: helmReleases = [] } = useQuery({
    queryKey: ['helm', 'releases', ns],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/v1/namespaces/${ns}/secrets?labelSelector=owner%3Dhelm`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((s: Secret) => {
        const name = s.metadata.labels?.['name'] || s.metadata.name;
        const version = s.metadata.labels?.['version'] || '1';
        return { name, version, status: s.metadata.labels?.['status'] || 'unknown' };
      }).filter((r: { name: string }, i: number, arr: { name: string }[]) => arr.findIndex((x) => x.name === r.name) === i);
    },
    refetchInterval: 30000,
  });

  // Fetch chart repos from OpenShift HelmChartRepository CRDs
  const { data: chartRepoCRDs = [] } = useQuery({
    queryKey: ['helm', 'repos'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/apis/helm.openshift.io/v1beta1/helmchartrepositories`);
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
        } catch {}
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

  const handleInstall = async () => {
    if (!selectedChart || !releaseName.trim()) return;
    const sanitizedName = releaseName.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,52}$/.test(sanitizedName)) {
      addToast({ type: 'error', title: 'Invalid release name', detail: 'Must start with a lowercase letter or number, contain only lowercase letters, numbers, and hyphens, and be at most 53 characters.' });
      return;
    }
    const repoUrl = selectedChart.repoUrl || DEFAULT_REPO_URL;
    if (!/^https?:\/\/.+/.test(repoUrl)) {
      addToast({ type: 'error', title: 'Invalid chart repo URL', detail: 'Repository URL must start with http:// or https://' });
      return;
    }
    setInstalling(selectedChart.name);
    try {
      const job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: `helm-install-${sanitizedName}`,
          namespace: ns,
          labels: { app: 'helm-install', chart: selectedChart.name },
        },
        spec: {
          backoffLimit: 0,
          template: {
            spec: {
              restartPolicy: 'Never',
              serviceAccountName: 'default',
              containers: [{
                name: 'helm',
                image: 'alpine/helm:latest',
                command: ['helm', 'install', sanitizedName, selectedChart.name, '--repo', repoUrl, '--namespace', ns, '--wait', '--timeout', '5m'],
              }],
            },
          },
        },
      };

      const res = await fetch(`${BASE}/apis/batch/v1/namespaces/${ns}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }

      addToast({ type: 'success', title: `Helm install started`, detail: `${selectedChart.name} as "${sanitizedName}" in ${ns}` });
      setInstalledJob({ name: `helm-install-${sanitizedName}`, ns });
      setSelectedChart(null);
      setReleaseName('');
    } catch (err) {
      addToast({ type: 'error', title: 'Helm install failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setInstalling(null);
  };

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
      const res = await fetch(`${BASE}/apis/helm.openshift.io/v1beta1/helmchartrepositories`, {
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
      addToast({ type: 'error', title: 'Failed to add repository', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setAddingRepo(false);
  };

  const handleDeleteRepo = async (repoName: string) => {
    try {
      const res = await fetch(`${BASE}/apis/helm.openshift.io/v1beta1/helmchartrepositories/${repoName}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }
      addToast({ type: 'success', title: `Repository "${repoName}" removed` });
      queryClient.invalidateQueries({ queryKey: ['helm', 'repos'] });
      queryClient.invalidateQueries({ queryKey: ['helm', 'charts'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to remove repository', detail: err instanceof Error ? err.message : 'Unknown error' });
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
          onClose={() => setInstalledJob(null)}
        />
      )}

      {/* Repositories */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
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
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
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
            <div key={repo.name} className="flex items-center justify-between px-3 py-2 bg-slate-800/30 rounded border border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn('w-2 h-2 rounded-full shrink-0', repo.isReady ? 'bg-green-500' : 'bg-yellow-500')} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{repo.name}</span>
                    {repo.isDefault && (
                      <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">default</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono truncate">{repo.url}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">{repo.chartCount} chart{repo.chartCount !== 1 ? 's' : ''}</span>
                {!repo.isDefault && (
                  <button onClick={() => setDeleteRepo(repo.name)}
                    className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-700 transition-colors" title="Remove repository">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {helmReleases.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
          <h3 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
            <Ship className="w-4 h-4 text-blue-400" />
            Installed Releases ({helmReleases.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {helmReleases.map((r, i: number) => (
              <span key={i} className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded border border-slate-700 flex items-center gap-2">
                <Ship className="w-3 h-3 text-blue-400" />
                {r.name}
                <span className="text-slate-500">v{r.version}</span>
                <span className={cn('text-xs px-1 py-0.5 rounded', r.status === 'deployed' ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300')}>{r.status}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search charts..." className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Install dialog */}
      {selectedChart && (
        <div className="bg-blue-950/30 rounded-lg border border-blue-800 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-200">Install {selectedChart.name}</h3>
          <p className="text-xs text-slate-400">{selectedChart.description}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>From: <span className="text-slate-300">{selectedChart.repoName}</span></span>
            <span>Version: <span className="text-slate-300 font-mono">{selectedChart.version}</span></span>
          </div>
          <FormField label="Release Name" required value={releaseName} onChange={setReleaseName} placeholder={`my-${selectedChart.name}`} />
          <div className="flex items-center gap-2">
            <button onClick={handleInstall} disabled={!!installing || !releaseName.trim()} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
              {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ship className="w-4 h-4" />}
              {installing ? 'Installing...' : 'Install'}
            </button>
            <button onClick={() => setSelectedChart(null)} className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <span className="text-xs text-slate-500">Namespace: <span className="text-slate-300">{ns}</span></span>
          </div>
        </div>
      )}

      {/* Chart catalog */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">
            {chartsLoading ? 'Loading charts...' : `Charts (${filteredCharts.length})`}
          </span>
          {repos.length > 1 && (
            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">{repos.length} repos</span>
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
          <button key={`${chart.repoName || 'default'}-${chart.name}`} onClick={() => { setSelectedChart(chart); setReleaseName(`my-${chart.name}`); }}
            className="flex items-start gap-3 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-blue-600 transition-colors text-left">
            {chart.icon ? (
              <img src={chart.icon} alt="" className="w-8 h-8 rounded shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
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
