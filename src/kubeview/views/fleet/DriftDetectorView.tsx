/**
 * DriftDetectorView — cross-cluster resource drift detection UI.
 * Select a resource type, namespace, and name, then compare across all connected clusters.
 */

import React, { useState, useMemo } from 'react';
import { GitCompareArrows, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fleetCompareResource, type DriftResult } from '../../engine/fleetDrift';
import { useClusterStore } from '../../store/clusterStore';
import { useFleetStore } from '../../store/fleetStore';
import { LoadError } from '../../components/primitives/LoadError';

export function DriftDetectorView() {
  const resourceRegistry = useClusterStore(s => s.resourceRegistry);

  const [resourceType, setResourceType] = useState('');
  const [namespace, setNamespace] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DriftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every type, namespaced and cluster-scoped: cluster config (APIServer,
  // OAuth, …) is often exactly what drifts between clusters.
  const resourceTypes = useMemo(() => {
    if (!resourceRegistry) return [];
    return Array.from(resourceRegistry.entries())
      .sort(([, a], [, b]) => a.kind.localeCompare(b.kind));
  }, [resourceRegistry]);
  const selectedType = resourceType ? resourceRegistry?.get(resourceType) : undefined;
  const clusterScoped = selectedType ? !selectedType.namespaced : false;

  // Get cluster names for display (reactive to cluster changes)
  const fleetClusters = useFleetStore((s) => s.clusters);
  const clusterNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of fleetClusters) {
      map[c.id] = c.name;
    }
    return map;
  }, [fleetClusters]);

  // Which clusters to compare (all connected ones unless narrowed).
  const connectedClusters = useMemo(() => fleetClusters.filter((c) => c.status === 'connected'), [fleetClusters]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const chosenClusters = connectedClusters.filter((c) => !excluded.has(c.id)).map((c) => c.id);

  // A namespaced type needs a namespace: an empty box used to read as
  // "default" (its placeholder) but searched cluster-wide paths instead.
  const canCompare = !!resourceType && !!name.trim() && (clusterScoped || !!namespace.trim()) && chosenClusters.length >= 2;

  const handleCompare = async () => {
    if (!canCompare) return;

    const rt = resourceRegistry?.get(resourceType);
    if (!rt) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const apiPath = rt.group
        ? `/apis/${rt.group}/${rt.version}/${rt.plural}`
        : `/api/${rt.version}/${rt.plural}`;

      const driftResult = await fleetCompareResource(
        apiPath,
        name.trim(),
        clusterScoped ? undefined : namespace.trim(),
        chosenClusters,
      );
      setResult(driftResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  const truncate = (val: unknown, maxLen = 60): string => {
    const s = JSON.stringify(val);
    if (s.length > maxLen) return s.slice(0, maxLen) + '...';
    return s;
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <GitCompareArrows className="h-5 w-5 text-blue-400" />
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Resource drift</h2>
          <p className="text-sm text-slate-400">
            Compare one resource across clusters to find where its configuration differs.
          </p>
        </div>
      </div>

      {/* Selector */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Resource Type</label>
            <select
              value={resourceType}
              onChange={e => setResourceType(e.target.value)}
              className="w-full rounded-sm border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              aria-label="Resource type"
            >
              <option value="">Select type...</option>
              {resourceTypes.map(([key, rt]) => (
                <option key={key} value={key}>
                  {rt.kind} ({rt.group || 'core'}/{rt.version}){rt.namespaced ? '' : ' · cluster-scoped'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Namespace</label>
            <input
              type="text"
              value={namespace}
              onChange={e => setNamespace(e.target.value)}
              disabled={clusterScoped}
              placeholder={clusterScoped ? 'cluster-scoped' : 'e.g. default'}
              className="w-full rounded-sm border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              aria-label="Namespace"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Resource Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-deployment"
              className="w-full rounded-sm border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              aria-label="Resource name"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleCompare}
              disabled={!canCompare || loading}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors',
                !canCompare || loading
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-500',
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
              {loading ? 'Comparing...' : 'Compare'}
            </button>
          </div>
        </div>
      </div>

      {connectedClusters.length > 2 && (
        <fieldset className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <legend className="px-1 text-xs font-medium text-slate-400">Clusters</legend>
          <div className="flex flex-wrap gap-3">
            {connectedClusters.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={!excluded.has(c.id)}
                  onChange={() => setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                    return next;
                  })}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/30 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Summary bar: say how many clusters were actually compared */}
          {(() => {
            const hasDrift = result.driftedFields > 0 || result.absentClusters.length > 0;
            const fullyCompared = result.failedClusters.length === 0;
            return (
              <div className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
                {hasDrift ? (
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                ) : fullyCompared ? (
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-slate-400" />
                )}
                <span className="text-sm text-slate-200">
                  {result.clusters.length} of {result.totalClusters} clusters compared
                  {result.clusters.length > 0 && (
                    <>
                      {' · '}
                      <span className={result.driftedFields === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                        {result.identicalFields} of {result.identicalFields + result.driftedFields} fields match
                      </span>
                    </>
                  )}
                </span>
              </div>
            );
          })()}

          {result.absentClusters.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-300">
              Drift: the resource is absent on {result.absentClusters.map((cid) => clusterNames[cid] || cid).join(', ')}
            </div>
          )}

          {result.failedClusters.length > 0 && (
            <LoadError
              title={`${result.failedClusters.length} cluster${result.failedClusters.length !== 1 ? 's' : ''} could not be read and were not compared`}
              error={result.failedClusters.map((f) => `${clusterNames[f.id] || f.id}: ${f.reason}`).join(' · ')}
              onRetry={handleCompare}
            />
          )}

          {/* Identical message: only when every cluster was read and has the resource */}
          {result.driftedFields === 0 && result.absentClusters.length === 0 && result.failedClusters.length === 0 && result.clusters.length > 1 && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-900 bg-emerald-950/20 p-6">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
              <p className="text-sm text-emerald-300">Resources are identical across all {result.clusters.length} clusters</p>
            </div>
          )}

          {/* Diff table */}
          {result.diffs.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800">
                    <th className="px-4 py-2 text-left font-medium text-slate-300">Field</th>
                    {result.clusters.map(cid => (
                      <th key={cid} className="px-4 py-2 text-left font-medium text-slate-300">
                        {clusterNames[cid] || cid}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.diffs.map(diff => (
                    <tr
                      key={diff.field}
                      className={cn(
                        'border-b border-slate-800',
                        diff.drifted
                          ? 'bg-amber-950/20 border-l-2 border-l-amber-500'
                          : 'bg-slate-900',
                      )}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-slate-300">{diff.field}</td>
                      {result.clusters.map(cid => (
                        <td key={cid} className="px-4 py-2 font-mono text-xs text-slate-400">
                          {truncate(diff.values[cid])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
