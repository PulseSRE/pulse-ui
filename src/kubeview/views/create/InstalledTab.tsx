import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  Package, Search, Folder, GitBranch, Image, Box, Database,
  ArrowRight, CheckCircle, Loader2, AlertCircle, Ship,
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { useK8sListWatch } from '../../hooks/useK8sListWatch';
import { K8S_BASE as BASE } from '../../engine/gvr';
import type { Deployment, StatefulSet, Secret } from '../../engine/types';

/** OLM Subscription — not yet in engine/types, so defined locally. */
interface Subscription {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string; uid?: string; [key: string]: unknown };
  spec?: { name?: string; channel?: string; [key: string]: unknown };
  status?: { installedCSV?: string; state?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export function InstalledTab() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [search, setSearch] = useState('');

  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Fetch Operators (Subscriptions)
  const { data: subscriptions = [] } = useK8sListWatch({
    apiPath: '/apis/operators.coreos.com/v1alpha1/subscriptions',
    namespace: nsFilter,
  });

  // Fetch Helm Releases (secrets with owner=helm label)
  const ns = selectedNamespace !== '*' ? selectedNamespace : 'default';
  const { data: helmReleases = [] } = useQuery({
    queryKey: ['helm', 'releases', ns],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/v1/namespaces/${ns}/secrets?labelSelector=owner%3Dhelm`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((s: Secret) => {
        const name = s.metadata.labels?.['name'] || s.metadata.name;
        const version = s.metadata.labels?.['version'] || '1';
        return {
          name,
          version,
          status: s.metadata.labels?.['status'] || 'unknown',
          namespace: s.metadata.namespace,
        };
      }).filter((r: { name: string }, i: number, arr: { name: string }[]) => arr.findIndex((x) => x.name === r.name) === i);
    },
    refetchInterval: 30000,
  });

  // Fetch Deployments
  const { data: deployments = [] } = useK8sListWatch({
    apiPath: '/apis/apps/v1/deployments',
    namespace: nsFilter,
  });

  // Fetch StatefulSets
  const { data: statefulsets = [] } = useK8sListWatch({
    apiPath: '/apis/apps/v1/statefulsets',
    namespace: nsFilter,
  });

  // Exclude platform namespaces
  const isUserNs = (ns: string) => !ns.startsWith('openshift-') && !ns.startsWith('kube-') && ns !== 'openshift' && ns !== 'default';

  const userDeployments = (deployments as Deployment[]).filter(d => isUserNs(d.metadata?.namespace || ''));
  const userStatefulSets = (statefulsets as StatefulSet[]).filter(s => isUserNs(s.metadata?.namespace || ''));
  const userSubscriptions = (subscriptions as Subscription[]).filter(s => {
    return true;
  });

  // Filter all sections by search
  const q = search.toLowerCase();
  const filteredSubscriptions = q
    ? userSubscriptions.filter((s) =>
        s.metadata?.name?.toLowerCase().includes(q) ||
        s.spec?.name?.toLowerCase().includes(q)
      )
    : userSubscriptions;

  const filteredHelmReleases = q
    ? helmReleases.filter((r: { name?: string }) =>
        r.name?.toLowerCase().includes(q)
      )
    : helmReleases;

  const filteredDeployments = q
    ? userDeployments.filter((d) =>
        d.metadata?.name?.toLowerCase().includes(q) ||
        d.metadata?.namespace?.toLowerCase().includes(q)
      )
    : userDeployments;

  const filteredStatefulSets = q
    ? userStatefulSets.filter((s) =>
        s.metadata?.name?.toLowerCase().includes(q) ||
        s.metadata?.namespace?.toLowerCase().includes(q)
      )
    : userStatefulSets;

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search installed software..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-900 text-slate-100 border border-slate-800 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Operators Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-400" />
            Operators
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredSubscriptions.length}</span>
          </h3>
          <button
            onClick={() => go('/create/v1~pods?tab=operators')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {filteredSubscriptions.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No operators installed</p>
        ) : (
          <div className="space-y-2">
            {filteredSubscriptions.slice(0, 5).map((sub) => {
              const name = sub.metadata?.name || '';
              const ns = sub.metadata?.namespace || '';
              const channel = sub.spec?.channel || '';
              const installedCSV = sub.status?.installedCSV || '';
              const state = sub.status?.state || '';

              return (
                <div
                  key={`${ns}-${name}`}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => go(`/operatorhub?q=${sub.spec?.name || name}`)}
                      className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                    >
                      {sub.spec?.name || name}
                    </button>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {ns}
                      </span>
                      {channel && (
                        <span className="flex items-center gap-1">
                          <GitBranch className="w-3 h-3" />
                          {channel}
                        </span>
                      )}
                      {installedCSV && (
                        <span className="text-slate-500">{installedCSV}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {state === 'AtLatestKnown' ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : state === 'UpgradePending' ? (
                      <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                </div>
              );
            })}
            {filteredSubscriptions.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredSubscriptions.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* Helm Releases Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Ship className="w-4 h-4 text-blue-400" />
            Helm Releases
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredHelmReleases.length}</span>
          </h3>
        </div>
        {filteredHelmReleases.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No Helm releases installed</p>
        ) : (
          <div className="space-y-2">
            {filteredHelmReleases.slice(0, 5).map((release, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-100">{release.name}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Folder className="w-3 h-3" />
                      {release.namespace}
                    </span>
                    <span className="text-slate-500">v{release.version}</span>
                  </div>
                </div>
                <span className={cn(
                  'text-xs px-2 py-1 rounded',
                  release.status === 'deployed'
                    ? 'bg-green-900/50 text-green-300 border border-green-800'
                    : 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                )}>
                  {release.status}
                </span>
              </div>
            ))}
            {filteredHelmReleases.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredHelmReleases.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* Deployments Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Box className="w-4 h-4 text-blue-400" />
            Deployments
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredDeployments.length}</span>
          </h3>
          <button
            onClick={() => go('/workloads')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {filteredDeployments.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No deployments found</p>
        ) : (
          <div className="space-y-2">
            {filteredDeployments.slice(0, 5).map((deploy) => {
              const name = deploy.metadata?.name || '';
              const ns = deploy.metadata?.namespace || '';
              const replicas = deploy.spec?.replicas || 0;
              const available = deploy.status?.availableReplicas || 0;
              const image = deploy.spec?.template?.spec?.containers?.[0]?.image || '';
              const isReady = available === replicas && replicas > 0;

              return (
                <div
                  key={`${ns}-${name}`}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => go(`/r/apps.v1.deployments/${ns}/${name}`)}
                      className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                    >
                      {name}
                    </button>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {ns}
                      </span>
                      {image && (
                        <span className="flex items-center gap-1 truncate">
                          <Image className="w-3 h-3" />
                          {image.split('/').pop()?.split(':')[0] || image}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs px-2 py-1 rounded',
                      isReady
                        ? 'bg-green-900/50 text-green-300 border border-green-800'
                        : 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                    )}>
                      {available}/{replicas}
                    </span>
                    {isReady ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    )}
                  </div>
                </div>
              );
            })}
            {filteredDeployments.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredDeployments.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* StatefulSets Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            StatefulSets
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{filteredStatefulSets.length}</span>
          </h3>
          <button
            onClick={() => go('/workloads')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {filteredStatefulSets.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No statefulsets found</p>
        ) : (
          <div className="space-y-2">
            {filteredStatefulSets.slice(0, 5).map((sts) => {
              const name = sts.metadata?.name || '';
              const ns = sts.metadata?.namespace || '';
              const replicas = sts.spec?.replicas || 0;
              const ready = sts.status?.readyReplicas || 0;
              const image = sts.spec?.template?.spec?.containers?.[0]?.image || '';
              const isReady = ready === replicas && replicas > 0;

              return (
                <div
                  key={`${ns}-${name}`}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => go(`/r/apps.v1.statefulsets/${ns}/${name}`)}
                      className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                    >
                      {name}
                    </button>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        {ns}
                      </span>
                      {image && (
                        <span className="flex items-center gap-1 truncate">
                          <Image className="w-3 h-3" />
                          {image.split('/').pop()?.split(':')[0] || image}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs px-2 py-1 rounded',
                      isReady
                        ? 'bg-green-900/50 text-green-300 border border-green-800'
                        : 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                    )}>
                      {ready}/{replicas}
                    </span>
                    {isReady ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                    )}
                  </div>
                </div>
              );
            })}
            {filteredStatefulSets.length > 5 && (
              <p className="text-xs text-slate-500 text-center pt-2">
                +{filteredStatefulSets.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
