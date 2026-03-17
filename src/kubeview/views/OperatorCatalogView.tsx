import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Puzzle, Search, Package, CheckCircle, XCircle, Loader2,
  ArrowRight, ArrowLeft, Star, Filter, Shield, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sCreate } from '../engine/query';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

interface PackageManifest {
  metadata: { name: string; namespace?: string };
  status: {
    catalogSource: string;
    catalogSourceNamespace: string;
    channels: Array<{
      name: string;
      currentCSV: string;
      currentCSVDesc: {
        displayName: string;
        description: string;
        icon: Array<{ base64data: string; mediatype: string }>;
        version: string;
        provider: { name: string };
        installModes: Array<{ type: string; supported: boolean }>;
        annotations?: Record<string, string>;
      };
    }>;
    defaultChannel: string;
    provider: { name: string };
  };
}

const CATALOG_LABELS: Record<string, { label: string; color: string }> = {
  'redhat-operators': { label: 'Red Hat', color: 'bg-red-900/50 text-red-300 border-red-800' },
  'certified-operators': { label: 'Certified', color: 'bg-blue-900/50 text-blue-300 border-blue-800' },
  'community-operators': { label: 'Community', color: 'bg-green-900/50 text-green-300 border-green-800' },
};

const POPULAR_OPERATORS = [
  'cluster-logging', 'loki-operator', 'cluster-observability-operator',
  'redhat-oadp-operator', 'quay-operator', 'external-secrets-operator',
  'elasticsearch-operator', 'servicemeshoperator', 'serverless-operator',
  'web-terminal', 'devworkspace-operator', 'rhacs-operator',
  'compliance-operator', 'file-integrity-operator', 'costmanagement-metrics-operator',
  'kubevirt-hyperconverged', 'local-storage-operator', 'odf-operator',
];

export default function OperatorCatalogView() {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [catalogFilter, setCatalogFilter] = useState<string>('all');
  const [selectedOp, setSelectedOp] = useState<PackageManifest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [installNs, setInstallNs] = useState('openshift-operators');

  // Fetch all package manifests
  const { data: packages = [], isLoading } = useQuery<PackageManifest[]>({
    queryKey: ['operator-catalog'],
    queryFn: () => k8sList<PackageManifest>('/apis/packages.operators.coreos.com/v1/packagemanifests'),
    staleTime: 300000, // 5 min cache
  });

  // Fetch installed subscriptions
  const { data: subscriptions = [] } = useQuery<any[]>({
    queryKey: ['readiness', 'subscriptions'],
    queryFn: () => k8sList('/apis/operators.coreos.com/v1alpha1/subscriptions').catch(() => []),
    staleTime: 60000,
  });

  const installedNames = useMemo(() => new Set(subscriptions.map((s: any) => s.spec?.name || s.metadata?.name)), [subscriptions]);

  // Deduplicate by name (multiple catalog versions)
  const dedupedPackages = useMemo(() => {
    const seen = new Map<string, PackageManifest>();
    for (const pkg of packages) {
      const name = pkg.metadata.name;
      const existing = seen.get(name);
      // Prefer redhat-operators > certified > community
      const priority: Record<string, number> = { 'redhat-operators': 3, 'certified-operators': 2, 'community-operators': 1 };
      const existingPriority = existing ? (priority[existing.status.catalogSource.replace(/-4\.\d+$/, '')] || 0) : 0;
      const newPriority = priority[pkg.status.catalogSource.replace(/-4\.\d+$/, '')] || 0;
      if (!existing || newPriority > existingPriority) {
        seen.set(name, pkg);
      }
    }
    return [...seen.values()];
  }, [packages]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = dedupedPackages;

    if (catalogFilter !== 'all') {
      result = result.filter(p => p.status.catalogSource.replace(/-4\.\d+$/, '') === catalogFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => {
        const desc = p.status.channels?.[0]?.currentCSVDesc;
        return p.metadata.name.toLowerCase().includes(q) ||
          (desc?.displayName || '').toLowerCase().includes(q) ||
          (desc?.description || '').toLowerCase().includes(q);
      });
    }

    // Sort: popular first, then alphabetical
    return result.sort((a, b) => {
      const aPopular = POPULAR_OPERATORS.includes(a.metadata.name) ? 1 : 0;
      const bPopular = POPULAR_OPERATORS.includes(b.metadata.name) ? 1 : 0;
      if (aPopular !== bPopular) return bPopular - aPopular;
      const aName = a.status.channels?.[0]?.currentCSVDesc?.displayName || a.metadata.name;
      const bName = b.status.channels?.[0]?.currentCSVDesc?.displayName || b.metadata.name;
      return aName.localeCompare(bName);
    });
  }, [dedupedPackages, search, catalogFilter]);

  // Install operator
  const handleInstall = async (pkg: PackageManifest, channel: string, ns: string) => {
    setInstalling(true);
    try {
      // Create namespace if it doesn't exist (best effort)
      if (ns !== 'openshift-operators') {
        try {
          await k8sCreate('/api/v1/namespaces', { apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } });
        } catch {} // might already exist
      }

      // Create OperatorGroup if namespace is not openshift-operators (which has a global one)
      if (ns !== 'openshift-operators' && ns !== 'openshift-operators-redhat') {
        try {
          await k8sCreate(`/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`, {
            apiVersion: 'operators.coreos.com/v1',
            kind: 'OperatorGroup',
            metadata: { name: `${pkg.metadata.name}-group`, namespace: ns },
            spec: { targetNamespaces: [ns] },
          });
        } catch {} // might already exist
      }

      // Create Subscription
      await k8sCreate(`/apis/operators.coreos.com/v1alpha1/namespaces/${ns}/subscriptions`, {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: pkg.metadata.name, namespace: ns },
        spec: {
          channel,
          name: pkg.metadata.name,
          source: pkg.status.catalogSource,
          sourceNamespace: pkg.status.catalogSourceNamespace || 'openshift-marketplace',
          installPlanApproval: 'Automatic',
        },
      });

      addToast({ type: 'success', title: 'Operator installed', detail: `${pkg.status.channels?.[0]?.currentCSVDesc?.displayName || pkg.metadata.name} installing in ${ns}` });
      queryClient.invalidateQueries({ queryKey: ['readiness', 'subscriptions'] });
      setSelectedOp(null);
    } catch (err) {
      addToast({ type: 'error', title: 'Install failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setInstalling(false);
  };

  // Initialize channel/ns when operator is selected
  React.useEffect(() => {
    if (selectedOp) {
      const channels = selectedOp.status.channels || [];
      setSelectedChannel(selectedOp.status.defaultChannel || channels[0]?.name || '');
      const desc = channels.find(c => c.name === selectedOp.status.defaultChannel)?.currentCSVDesc || channels[0]?.currentCSVDesc;
      const allNsSupported = desc?.installModes?.find((m: any) => m.type === 'AllNamespaces')?.supported;
      setInstallNs(
        selectedOp.metadata.name.includes('logging') ? 'openshift-logging'
        : selectedOp.metadata.name.includes('loki') ? 'openshift-operators-redhat'
        : allNsSupported ? 'openshift-operators'
        : `openshift-${selectedOp.metadata.name}`
      );
    }
  }, [selectedOp]);

  // Detail view
  if (selectedOp) {
    const desc = selectedOp.status.channels?.find(c => c.name === selectedOp.status.defaultChannel)?.currentCSVDesc
      || selectedOp.status.channels?.[0]?.currentCSVDesc;
    const channels = selectedOp.status.channels || [];
    const isInstalled = installedNames.has(selectedOp.metadata.name);
    const catalogBase = selectedOp.status.catalogSource.replace(/-4\.\d+$/, '');
    const catalogInfo = CATALOG_LABELS[catalogBase];
    const allNsSupported = desc?.installModes?.find((m: any) => m.type === 'AllNamespaces')?.supported;

    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <button onClick={() => setSelectedOp(null)} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-4 h-4" /> Back to catalog
          </button>

          <div className="flex items-start gap-4">
            {desc?.icon?.[0]?.base64data ? (
              <img src={`data:${desc.icon[0].mediatype};base64,${desc.icon[0].base64data}`} className="w-16 h-16 rounded-lg" alt="" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-slate-800 flex items-center justify-center"><Puzzle className="w-8 h-8 text-slate-600" /></div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-100">{desc?.displayName || selectedOp.metadata.name}</h1>
                {isInstalled && <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-300 rounded border border-green-800">Installed</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
                <span>{desc?.provider?.name || selectedOp.status.provider?.name}</span>
                <span>v{desc?.version}</span>
                {catalogInfo && <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', catalogInfo.color)}>{catalogInfo.label}</span>}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
            <p className="text-sm text-slate-300 whitespace-pre-line">{desc?.description || 'No description available.'}</p>
          </div>

          {/* Install form */}
          {!isInstalled && (
            <div className="bg-blue-950/30 rounded-lg border border-blue-800 p-4 space-y-4">
              <h2 className="text-sm font-semibold text-blue-200">Install Operator</h2>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Channel</label>
                <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)}
                  className="px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 w-full max-w-xs">
                  {channels.map(ch => <option key={ch.name} value={ch.name}>{ch.name} (v{ch.currentCSVDesc?.version})</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Install Namespace</label>
                <input type="text" value={installNs} onChange={(e) => setInstallNs(e.target.value)}
                  className="px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 w-full max-w-xs font-mono" />
                <div className="text-[10px] text-slate-500 mt-1">
                  {allNsSupported ? 'This operator supports all namespaces — openshift-operators is recommended.' : 'This operator requires its own namespace.'}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => handleInstall(selectedOp, selectedChannel, installNs)} disabled={installing}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50">
                  {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                  {installing ? 'Installing...' : 'Install'}
                </button>
                <span className="text-xs text-slate-500">Creates Namespace, OperatorGroup, and Subscription</span>
              </div>
            </div>
          )}

          {/* Install modes */}
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
            <h3 className="text-xs text-slate-400 mb-2">Install Modes</h3>
            <div className="flex flex-wrap gap-2">
              {desc?.installModes?.map((m: any) => (
                <span key={m.type} className={cn('text-xs px-2 py-1 rounded border', m.supported ? 'bg-green-900/30 text-green-300 border-green-800' : 'bg-slate-800 text-slate-500 border-slate-700')}>
                  {m.type}: {m.supported ? '✓' : '✗'}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Catalog list
  const catalogs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of dedupedPackages) {
      const key = p.status.catalogSource.replace(/-4\.\d+$/, '');
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [dedupedPackages]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Puzzle className="w-6 h-6 text-violet-500" /> Operator Catalog</h1>
          <p className="text-sm text-slate-400 mt-1">{dedupedPackages.length} operators available from {catalogs.length} sources</p>
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search operators..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
            <button onClick={() => setCatalogFilter('all')} className={cn('px-3 py-1.5 text-xs rounded-md', catalogFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
              All ({dedupedPackages.length})
            </button>
            {catalogs.map(([name, count]) => {
              const info = CATALOG_LABELS[name];
              return (
                <button key={name} onClick={() => setCatalogFilter(name)}
                  className={cn('px-3 py-1.5 text-xs rounded-md', catalogFilter === name ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                  {info?.label || name} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" /><p className="text-sm text-slate-500 mt-3">Loading operator catalog...</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.slice(0, 60).map((pkg) => {
              const desc = pkg.status.channels?.find(c => c.name === pkg.status.defaultChannel)?.currentCSVDesc || pkg.status.channels?.[0]?.currentCSVDesc;
              const isInstalled = installedNames.has(pkg.metadata.name);
              const catalogBase = pkg.status.catalogSource.replace(/-4\.\d+$/, '');
              const catalogInfo = CATALOG_LABELS[catalogBase];
              const isPopular = POPULAR_OPERATORS.includes(pkg.metadata.name);

              return (
                <button key={pkg.metadata.name} onClick={() => setSelectedOp(pkg)}
                  className={cn('flex items-start gap-3 p-4 bg-slate-900 rounded-lg border text-left transition-colors hover:border-blue-600',
                    isInstalled ? 'border-green-800' : 'border-slate-800')}>
                  {desc?.icon?.[0]?.base64data ? (
                    <img src={`data:${desc.icon[0].mediatype};base64,${desc.icon[0].base64data}`} className="w-10 h-10 rounded shrink-0" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center shrink-0"><Puzzle className="w-5 h-5 text-slate-600" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">{desc?.displayName || pkg.metadata.name}</span>
                      {isInstalled && <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{desc?.description?.slice(0, 100) || 'No description'}</div>
                    <div className="flex items-center gap-2 mt-2">
                      {catalogInfo && <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', catalogInfo.color)}>{catalogInfo.label}</span>}
                      <span className="text-[10px] text-slate-500">v{desc?.version}</span>
                      {isPopular && <Star className="w-3 h-3 text-yellow-500" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {filtered.length > 60 && (
          <div className="text-center text-xs text-slate-500 pt-2">Showing 60 of {filtered.length} — refine your search</div>
        )}
      </div>
    </div>
  );
}
