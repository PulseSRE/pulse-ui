import React, { useState, useMemo } from 'react';
import {
  Puzzle, Search, CheckCircle, ArrowRight,
  AlertTriangle, Layers, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useUIStore } from '../store/uiStore';
import { Panel } from '../components/primitives/Panel';
import { timeAgo } from '../engine/dateUtils';
import { Card } from '../components/primitives/Card';
import { MetricGrid } from '../components/primitives/MetricGrid';
import type { K8sResource } from '../engine/renderers';

interface CRDResource extends K8sResource {
  spec: {
    group: string;
    names: { kind: string; plural: string; singular: string; shortNames?: string[] };
    scope: 'Namespaced' | 'Cluster';
    versions: Array<{ name: string; served: boolean; storage: boolean }>;
  };
  status?: {
    acceptedNames?: { kind: string; plural: string };
    conditions?: Array<{ type: string; status: string; message?: string }>;
    storedVersions?: string[];
  };
}

export default function CRDsView() {
  const go = useNavigateTab();
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'Namespaced' | 'Cluster'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  const { data: typedCRDs = [], isLoading } = useK8sListWatch<CRDResource>({
    apiPath: '/apis/apiextensions.k8s.io/v1/customresourcedefinitions',
  });

  // Group names for filter
  const apiGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const crd of typedCRDs) {
      groups.add(crd.spec?.group || '');
    }
    return [...groups].sort();
  }, [typedCRDs]);

  // Filtered CRDs
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return typedCRDs.filter(crd => {
      const name = crd.metadata?.name || '';
      const kind = crd.spec?.names?.kind || '';
      const group = crd.spec?.group || '';
      const shortNames = (crd.spec?.names?.shortNames || []).join(' ');
      const matchesSearch = !q || name.toLowerCase().includes(q) || kind.toLowerCase().includes(q) || group.toLowerCase().includes(q) || shortNames.toLowerCase().includes(q);
      const matchesScope = scopeFilter === 'all' || crd.spec?.scope === scopeFilter;
      const matchesGroup = groupFilter === 'all' || crd.spec?.group === groupFilter;
      return matchesSearch && matchesScope && matchesGroup;
    });
  }, [typedCRDs, search, scopeFilter, groupFilter]);

  // Group by API group
  const grouped = useMemo(() => {
    const map = new Map<string, CRDResource[]>();
    for (const crd of filtered) {
      const group = crd.spec?.group || 'core';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(crd);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Stats
  const namespacedCount = typedCRDs.filter(c => c.spec?.scope === 'Namespaced').length;
  const clusterCount = typedCRDs.filter(c => c.spec?.scope === 'Cluster').length;
  const established = typedCRDs.filter(c =>
    c.status?.conditions?.some(cond => cond.type === 'Established' && cond.status === 'True')
  ).length;

  function getInstancesPath(crd: CRDResource): string {
    const group = crd.spec?.group || '';
    const plural = crd.spec?.names?.plural || '';
    const storageVersion = crd.spec?.versions?.find(v => v.storage)?.name || crd.spec?.versions?.[0]?.name || 'v1';
    const gvr = group
      ? `${group}~${storageVersion}~${plural}`
      : `${storageVersion}~${plural}`;
    return `/r/${gvr}`;
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-purple-500" /> Custom Resource Definitions
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse CRDs and their instances across all API groups
          </p>
        </div>

        {/* Stats */}
        <MetricGrid>
          <Card className="p-3">
            <div className="text-xs text-slate-400 mb-1">Total CRDs</div>
            <div className="text-xl font-bold text-slate-100">{typedCRDs.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-400 mb-1">API Groups</div>
            <div className="text-xl font-bold text-slate-100">{apiGroups.length}</div>
          </Card>
          <button onClick={() => setScopeFilter(scopeFilter === 'Namespaced' ? 'all' : 'Namespaced')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', scopeFilter === 'Namespaced' ? 'border-blue-600' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">Namespaced</div>
            <div className="text-xl font-bold text-slate-100">{namespacedCount}</div>
          </button>
          <button onClick={() => setScopeFilter(scopeFilter === 'Cluster' ? 'all' : 'Cluster')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', scopeFilter === 'Cluster' ? 'border-blue-600' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">Cluster-scoped</div>
            <div className="text-xl font-bold text-slate-100">{clusterCount}</div>
          </button>
        </MetricGrid>

        {/* Search + Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, kind, group, or short name..."
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-hidden focus:border-blue-500"
            />
          </div>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 outline-hidden"
          >
            <option value="all">All Groups ({apiGroups.length})</option>
            {apiGroups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {/* Results count */}
        <div className="text-xs text-slate-500">
          Showing {filtered.length} of {typedCRDs.length} CRDs
          {(search || scopeFilter !== 'all' || groupFilter !== 'all') && (
            <button onClick={() => { setSearch(''); setScopeFilter('all'); setGroupFilter('all'); }} className="ml-2 text-blue-400 hover:text-blue-300">Clear filters</button>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12 text-sm text-slate-500">Loading CRDs...</div>
        )}

        {/* Grouped CRDs */}
        {grouped.map(([group, groupCRDs]) => (
          <Panel key={group} title={`${group} (${groupCRDs.length})`} icon={<Layers className="w-4 h-4 text-purple-400" />}>
            <div className="divide-y divide-slate-800">
              {groupCRDs.map(crd => {
                const kind = crd.spec?.names?.kind || '';
                const plural = crd.spec?.names?.plural || '';
                const shortNames = crd.spec?.names?.shortNames || [];
                const scope = crd.spec?.scope || 'Namespaced';
                const versions = crd.spec?.versions || [];
                const servedVersions = versions.filter(v => v.served);
                const storageVersion = versions.find(v => v.storage);
                const isEstablished = crd.status?.conditions?.some(c => c.type === 'Established' && c.status === 'True');
                const hasNamesAccepted = crd.status?.conditions?.some(c => c.type === 'NamesAccepted' && c.status === 'True');
                const instancesPath = getInstancesPath(crd);

                return (
                  <div key={crd.metadata.uid} className="py-3 group">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isEstablished
                            ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                          }
                          <span className="text-sm font-medium text-slate-200">{kind}</span>
                          <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', scope === 'Namespaced' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300')}>
                            {scope}
                          </span>
                          {shortNames.length > 0 && (
                            <span className="text-xs text-slate-500">({shortNames.join(', ')})</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono truncate">{crd.metadata.name}</div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                          <span>Versions: {servedVersions.map(v => (
                            <span key={v.name} className={cn('mr-1', v.storage ? 'text-blue-400' : '')}>{v.name}{v.storage ? ' (storage)' : ''}</span>
                          ))}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {timeAgo(crd.metadata.creationTimestamp || '')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => go(`/r/apiextensions.k8s.io~v1~customresourcedefinitions/_/${crd.metadata.name}`, kind)}
                          className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-sm transition-colors"
                        >
                          Definition
                        </button>
                        <button
                          onClick={() => go(instancesPath, `${plural}`)}
                          className="px-2.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-sm transition-colors flex items-center gap-1"
                        >
                          Instances <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <Puzzle className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <div className="text-sm text-slate-500">No CRDs match your filters</div>
          </div>
        )}
      </div>
    </div>
  );
}
