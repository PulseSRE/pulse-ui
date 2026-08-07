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

export function DriftDetectorView() {
  const resourceRegistry = useClusterStore(s => s.resourceRegistry);

  const [resourceType, setResourceType] = useState('');
  const [namespace, setNamespace] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DriftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build sorted list of resource types from registry
  const resourceTypes = useMemo(() => {
    if (!resourceRegistry) return [];
    return Array.from(resourceRegistry.entries())
      .filter(([, r]) => r.namespaced)
      .sort(([, a], [, b]) => a.kind.localeCompare(b.kind));
  }, [resourceRegistry]);

  // Get cluster names for display (reactive to cluster changes)
  const fleetClusters = useFleetStore((s) => s.clusters);
  const clusterNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of fleetClusters) {
      map[c.id] = c.name;
    }
    return map;
  }, [fleetClusters]);

  const canCompare = resourceType && name;

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
        namespace.trim() || undefined,
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
          <h2 className="text-lg font-semibold text-slate-100">Configuration Drift</h2>
          <p className="text-sm text-slate-400">
            Compare a resource across all connected clusters to detect configuration differences.
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
                  {rt.kind} ({rt.group || 'core'}/{rt.version})
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
              placeholder="default"
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

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/30 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
            {result.driftedFields === 0 ? (
              <CheckCircle className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            )}
            <span className="text-sm text-slate-200">
              <span className={result.driftedFields === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                {result.identicalFields} of {result.identicalFields + result.driftedFields} fields match
              </span>
              {' '}across {result.clusters.length} clusters
            </span>
          </div>

          {/* Identical message */}
          {result.driftedFields === 0 && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-900 bg-emerald-950/20 p-6">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
              <p className="text-sm text-emerald-300">Resources are identical across all clusters</p>
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
