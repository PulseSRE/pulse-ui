import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Search, Ship, Loader2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { K8S_BASE as BASE } from '../../engine/gvr';
import DeployProgress from '../../components/DeployProgress';
import { FormField } from './FormField';

interface HelmChart {
  name: string;
  version: string;
  appVersion: string;
  description: string;
  icon?: string;
  repoName?: string;
  repoUrl?: string;
}

export function HelmTab() {
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [releaseName, setReleaseName] = useState('');
  const [selectedChart, setSelectedChart] = useState<HelmChart | null>(null);
  const [installedJob, setInstalledJob] = useState<{ name: string; ns: string } | null>(null);

  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';

  // Fetch Helm releases (secrets with owner=helm)
  const { data: helmReleases = [] } = useQuery({
    queryKey: ['helm', 'releases', ns],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/v1/namespaces/${ns}/secrets?labelSelector=owner%3Dhelm`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((s: any) => {
        const name = s.metadata.labels?.['name'] || s.metadata.name;
        const version = s.metadata.labels?.['version'] || '1';
        return { name, version, status: s.metadata.labels?.['status'] || 'unknown' };
      }).filter((r: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.name === r.name) === i);
    },
    refetchInterval: 30000,
  });

  // Fetch chart repos from OpenShift HelmChartRepository CRDs
  const { data: chartRepos = [] } = useQuery({
    queryKey: ['helm', 'repos'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/apis/helm.openshift.io/v1beta1/helmchartrepositories`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []) as any[];
    },
    staleTime: 300000,
  });

  // Fetch chart index from OpenShift's Helm chart proxy
  const { data: chartCatalog = [], isLoading: chartsLoading } = useQuery<HelmChart[]>({
    queryKey: ['helm', 'charts', 'index'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/apis/helm.openshift.io/v1beta1/helmchartrepositories`);
      if (!res.ok) return [];
      const repoData = await res.json();
      const repos = repoData.items || [];

      const charts: HelmChart[] = [];

      for (const repo of repos) {
        const repoName = repo.metadata?.name;
        const repoUrl = repo.spec?.connectionConfig?.url;
        if (!repoUrl) continue;

        try {
          const indexRes = await fetch(`${BASE}/api/kubernetes/api/v1/namespaces/openshift-config/configmaps/helm-chart-index-${repoName}`).catch(() => null);

          if (!indexRes || !indexRes.ok) {
            const directRes = await fetch(`/api/kubernetes/api/v1/proxy/namespaces/openshift-config/services/helm-chart-repo-proxy:${repoName}/index.yaml`).catch(() => null);
            if (!directRes || !directRes.ok) continue;
          }
        } catch {}

        const conditions = repo.status?.conditions || [];
        const isReady = conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
        if (isReady && repo.status?.charts) {
          for (const chart of repo.status.charts) {
            charts.push({
              name: chart.name,
              version: chart.version || '',
              appVersion: chart.appVersion || '',
              description: chart.description || '',
              icon: chart.icon,
              repoName,
              repoUrl,
            });
          }
        }
      }

      if (charts.length > 0) return charts;

      try {
        const chartApiRes = await fetch(`${BASE}/api/helm/charts/index.yaml`);
        if (chartApiRes.ok) {
          const text = await chartApiRes.text();
          const entries: HelmChart[] = [];
          const entryBlocks = text.split(/\n  [a-z]/);
          for (const block of entryBlocks) {
            const nameMatch = block.match(/name:\s*(.+)/);
            const versionMatch = block.match(/version:\s*(.+)/);
            const appVersionMatch = block.match(/appVersion:\s*(.+)/);
            const descMatch = block.match(/description:\s*(.+)/);
            const iconMatch = block.match(/icon:\s*(.+)/);
            if (nameMatch) {
              entries.push({
                name: nameMatch[1].trim(),
                version: versionMatch?.[1]?.trim() || '',
                appVersion: appVersionMatch?.[1]?.trim().replace(/['"]/g, '') || '',
                description: descMatch?.[1]?.trim().replace(/['"]/g, '') || '',
                icon: iconMatch?.[1]?.trim(),
              });
            }
          }
          const seen = new Map<string, HelmChart>();
          for (const chart of entries) {
            if (!seen.has(chart.name)) seen.set(chart.name, chart);
          }
          return [...seen.values()];
        }
      } catch {}

      return [];
    },
    staleTime: 300000,
  });

  const filteredCharts = search
    ? chartCatalog.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()))
    : chartCatalog;

  const handleInstall = async () => {
    if (!selectedChart || !releaseName.trim()) return;
    setInstalling(selectedChart.name);
    try {
      const job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: `helm-install-${releaseName.trim()}`,
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
                command: ['sh', '-c', `helm repo add chart-repo ${selectedChart.repoUrl || 'https://charts.openshift.io'} 2>/dev/null; helm install ${releaseName.trim()} chart-repo/${selectedChart.name} --namespace ${ns} --wait --timeout 5m`],
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

      addToast({ type: 'success', title: `Helm install started`, detail: `${selectedChart.name} as "${releaseName}" in ${ns}` });
      setInstalledJob({ name: `helm-install-${releaseName.trim()}`, ns });
      setSelectedChart(null);
      setReleaseName('');
    } catch (err) {
      addToast({ type: 'error', title: 'Helm install failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setInstalling(null);
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

      {helmReleases.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
          <h3 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
            <Ship className="w-4 h-4 text-blue-400" />
            Installed Releases ({helmReleases.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {helmReleases.map((r: any, i: number) => (
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
          {chartRepos.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">{chartRepos.length} repo{chartRepos.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        {chartCatalog.length === 0 && !chartsLoading && (
          <span className="text-xs text-slate-500">No HelmChartRepositories configured</span>
        )}
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
              {chartCatalog.length === 0 ? 'No Helm chart repositories configured on this cluster' : 'No charts match your search'}
            </div>
            {chartCatalog.length === 0 && (
              <p className="text-xs text-slate-600 mt-2 max-w-md mx-auto">
                Add a HelmChartRepository to enable chart browsing. OpenShift includes a default Red Hat Helm chart repo.
              </p>
            )}
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
    </div>
  );
}
