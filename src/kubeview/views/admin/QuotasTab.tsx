import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Shield, Database, AlertTriangle } from 'lucide-react';
import { k8sList } from '../../engine/query';
import { parseResourceValue, formatResourceValue } from '../../engine/formatting';
import { Panel } from '../../components/primitives/Panel';
import type { K8sResource } from '../../engine/renderers';
import type { Namespace } from '../../engine/types';

/** ResourceQuota resource */
interface ResourceQuota extends K8sResource {
  spec?: { hard?: Record<string, string>; [key: string]: unknown };
  status?: { hard?: Record<string, string>; used?: Record<string, string>; [key: string]: unknown };
}

/** LimitRange resource */
interface LimitRange extends K8sResource {
  spec?: {
    limits?: Array<{
      type: string;
      default?: Record<string, string>;
      defaultRequest?: Record<string, string>;
      max?: Record<string, string>;
      min?: Record<string, string>;
    }>;
    [key: string]: unknown;
  };
}

export function QuotasTab({ quotas, limitRanges, go }: { quotas: K8sResource[]; limitRanges: K8sResource[]; go: (path: string, title: string) => void }) {
  const { data: namespaces = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/namespaces'],
    queryFn: () => k8sList('/api/v1/namespaces'),
    staleTime: 60000,
  });

  const userNamespaces = React.useMemo(() =>
    namespaces.filter((ns) => {
      const name = ns.metadata?.name || '';
      return !name.startsWith('openshift-') && !name.startsWith('kube-') && name !== 'default' && name !== 'openshift';
    }),
  [namespaces]);

  const quotaNamespaces = new Set(quotas.map((q) => q.metadata?.namespace));
  const lrNamespaces = new Set(limitRanges.map((lr) => lr.metadata?.namespace));
  const unprotectedNs = userNamespaces.filter((ns) => !quotaNamespaces.has(ns.metadata?.name) && !lrNamespaces.has(ns.metadata?.name));

  // Aggregate usage across all quotas
  const totalResources = React.useMemo(() => {
    const agg: Record<string, { hard: number; used: number; display: string }> = {};
    for (const q of quotas as unknown as ResourceQuota[]) {
      const hard = q.spec?.hard || {};
      const used = q.status?.used || {};
      for (const [key, hardVal] of Object.entries(hard)) {
        if (!agg[key]) agg[key] = { hard: 0, used: 0, display: key };
        agg[key].hard += parseResourceValue(hardVal as string);
        agg[key].used += parseResourceValue((used[key] || '0') as string);
      }
    }
    return agg;
  }, [quotas]);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Resource Quotas</div>
          <div className="text-xl font-bold text-slate-100">{quotas.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">{quotaNamespaces.size} namespace{quotaNamespaces.size !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">Limit Ranges</div>
          <div className="text-xl font-bold text-slate-100">{limitRanges.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">{lrNamespaces.size} namespace{lrNamespaces.size !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
          <div className="text-xs text-slate-400 mb-1">User Namespaces</div>
          <div className="text-xl font-bold text-slate-100">{userNamespaces.length}</div>
        </div>
        <div className={cn('bg-slate-900 rounded-lg border p-3', unprotectedNs.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Unprotected</span>
            {unprotectedNs.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
          </div>
          <div className={cn('text-xl font-bold', unprotectedNs.length > 0 ? 'text-yellow-400' : 'text-green-400')}>{unprotectedNs.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">no quota or limit range</div>
        </div>
      </div>

      {/* Cluster-wide resource usage */}
      {Object.keys(totalResources).length > 0 && (
        <Panel title="Cluster Quota Usage" icon={<Database className="w-4 h-4 text-blue-400" />}>
          <div className="space-y-3">
            {Object.entries(totalResources).sort(([a], [b]) => a.localeCompare(b)).map(([key, { hard, used }]) => {
              const pct = hard > 0 ? Math.min(100, (used / hard) * 100) : 0;
              const isMemory = key.includes('memory') || key.includes('storage') || key.includes('ephemeral');
              const formatVal = (v: number) => {
                if (isMemory) {
                  if (v >= 1024 * 1024 * 1024) return `${(v / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
                  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(0)}Mi`;
                  return `${v}`;
                }
                if (v >= 1000) return `${(v / 1000).toFixed(1)}`;
                if (v < 1 && v > 0) return `${(v * 1000).toFixed(0)}m`;
                return `${v}`;
              };
              const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500';
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-300">{key}</span>
                    <span className="text-xs text-slate-400 font-mono">{formatVal(used)} / {formatVal(hard)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Per-namespace quota details */}
      <Panel title={`Resource Quotas (${quotas.length})`} icon={<Shield className="w-4 h-4 text-orange-500" />}>
        {quotas.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-sm text-slate-500 mb-2">No resource quotas configured</div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">Resource quotas limit total CPU, memory, and object counts per namespace. Without quotas, a single namespace can consume all cluster resources.</p>
            <button onClick={() => go('/create/v1~resourcequotas', 'Create ResourceQuota')} className="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Create ResourceQuota</button>
          </div>
        ) : (
          <div className="space-y-4">
            {(quotas as unknown as ResourceQuota[]).map((q) => {
              const hard = q.spec?.hard || {};
              const used = q.status?.used || {};
              const resources = Object.keys(hard);
              return (
                <div key={q.metadata?.uid} className="border border-slate-800 rounded-lg overflow-hidden">
                  <button onClick={() => go(`/r/v1~resourcequotas/${q.metadata.namespace}/${q.metadata.name}`, q.metadata.name)}
                    className="w-full px-4 py-2.5 flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{q.metadata.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{q.metadata.namespace}</span>
                    </div>
                    <span className="text-xs text-slate-500">{resources.length} resource{resources.length !== 1 ? 's' : ''}</span>
                  </button>
                  <div className="px-4 py-2 space-y-2">
                    {resources.map((key) => {
                      const hardVal = parseResourceValue(hard[key]);
                      const usedVal = parseResourceValue(used[key] || '0');
                      const pct = hardVal > 0 ? Math.min(100, (usedVal / hardVal) * 100) : 0;
                      const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500';
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs text-slate-400">{key}</span>
                            <span className="text-xs font-mono text-slate-300">
                              {formatResourceValue(used[key] || '0', key)} / {formatResourceValue(hard[key], key)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Limit Ranges */}
      <Panel title={`Limit Ranges (${limitRanges.length})`} icon={<Shield className="w-4 h-4 text-yellow-500" />}>
        {limitRanges.length === 0 ? (
          <div className="text-center py-6">
            <div className="text-sm text-slate-500 mb-2">No limit ranges configured</div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">LimitRanges set default and max CPU/memory for containers that don't specify their own. Without them, containers can request unlimited resources.</p>
            <button onClick={() => go('/create/v1~limitranges', 'Create LimitRange')} className="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Create LimitRange</button>
          </div>
        ) : (
          <div className="space-y-4">
            {(limitRanges as unknown as LimitRange[]).map((lr) => {
              const limits = lr.spec?.limits || [];
              return (
                <div key={lr.metadata?.uid} className="border border-slate-800 rounded-lg overflow-hidden">
                  <button onClick={() => go(`/r/v1~limitranges/${lr.metadata.namespace}/${lr.metadata.name}`, lr.metadata.name)}
                    className="w-full px-4 py-2.5 flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{lr.metadata.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{lr.metadata.namespace}</span>
                    </div>
                    <span className="text-xs text-slate-500">{limits.length} limit{limits.length !== 1 ? 's' : ''}</span>
                  </button>
                  <div className="px-4 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-800">
                          <th className="py-1.5 text-left font-normal">Type</th>
                          <th className="py-1.5 text-left font-normal">Resource</th>
                          <th className="py-1.5 text-right font-normal">Default</th>
                          <th className="py-1.5 text-right font-normal">Default Request</th>
                          <th className="py-1.5 text-right font-normal">Max</th>
                          <th className="py-1.5 text-right font-normal">Min</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {limits.flatMap((limit) => {
                          const resources = new Set([
                            ...Object.keys(limit.default || {}),
                            ...Object.keys(limit.defaultRequest || {}),
                            ...Object.keys(limit.max || {}),
                            ...Object.keys(limit.min || {}),
                          ]);
                          return [...resources].map((res) => (
                            <tr key={`${limit.type}-${res}`} className="text-slate-300">
                              <td className="py-1.5 text-slate-400">{limit.type}</td>
                              <td className="py-1.5">{res}</td>
                              <td className="py-1.5 text-right font-mono">{limit.default?.[res] || '—'}</td>
                              <td className="py-1.5 text-right font-mono">{limit.defaultRequest?.[res] || '—'}</td>
                              <td className="py-1.5 text-right font-mono">{limit.max?.[res] || '—'}</td>
                              <td className="py-1.5 text-right font-mono">{limit.min?.[res] || '—'}</td>
                            </tr>
                          ));
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Unprotected namespaces */}
      {unprotectedNs.length > 0 && (
        <Panel title={`Unprotected Namespaces (${unprotectedNs.length})`} icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}>
          <p className="text-xs text-slate-500 mb-3">These user namespaces have no ResourceQuota or LimitRange. Workloads can consume unlimited resources.</p>
          <div className="flex flex-wrap gap-2">
            {unprotectedNs.map((ns) => (
              <button key={ns.metadata?.name} onClick={() => go(`/r/v1~namespaces/_/${ns.metadata?.name}`, ns.metadata?.name)}
                className="text-xs px-2.5 py-1.5 bg-yellow-950/30 border border-yellow-900/50 text-yellow-300 rounded hover:bg-yellow-900/40 transition-colors">
                {ns.metadata?.name}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
