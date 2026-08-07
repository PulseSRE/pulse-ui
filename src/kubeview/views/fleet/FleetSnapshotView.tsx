/**
 * FleetSnapshotView — matrix comparison across 3+ clusters.
 * Captures snapshots from all registered clusters and shows
 * which clusters match and which diverge.
 */

import React, { useState } from 'react';
import { Loader2, Camera, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardBody } from '../../components/primitives/Card';
import { captureSnapshot, compareSnapshots, type ClusterSnapshot, type DiffRow } from '../../engine/snapshot';
import { getAllConnections } from '../../engine/clusterConnection';

interface ClusterSnapshotEntry {
  clusterId: string;
  clusterName: string;
  snapshot: ClusterSnapshot | null;
  error: string | null;
}

export default function FleetSnapshotView() {
  const clusters = getAllConnections().filter(c => c.status === 'connected');

  const [entries, setEntries] = useState<ClusterSnapshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [captured, setCaptured] = useState(false);

  const handleCaptureAll = async () => {
    setLoading(true);
    setCaptured(false);

    const results = await Promise.allSettled(
      clusters.map(async (cluster) => {
        const snapshot = await captureSnapshot(`Fleet snapshot: ${cluster.name}`, cluster.id);
        return { clusterId: cluster.id, clusterName: cluster.name, snapshot, error: null };
      })
    );

    const newEntries: ClusterSnapshotEntry[] = results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        clusterId: clusters[i].id,
        clusterName: clusters[i].name,
        snapshot: null,
        error: result.reason instanceof Error ? result.reason.message : 'Capture failed',
      };
    });

    setEntries(newEntries);
    setLoading(false);
    setCaptured(true);
  };

  // Build comparison matrix: compare each pair
  const successfulEntries = entries.filter(e => e.snapshot !== null);
  const pairComparisons: Array<{
    clusterA: string;
    clusterB: string;
    diff: DiffRow[];
    changedCount: number;
    totalCount: number;
  }> = [];

  if (successfulEntries.length >= 2) {
    for (let i = 0; i < successfulEntries.length; i++) {
      for (let j = i + 1; j < successfulEntries.length; j++) {
        const diff = compareSnapshots(successfulEntries[i].snapshot!, successfulEntries[j].snapshot!);
        pairComparisons.push({
          clusterA: successfulEntries[i].clusterName,
          clusterB: successfulEntries[j].clusterName,
          diff,
          changedCount: diff.filter(r => r.changed).length,
          totalCount: diff.length,
        });
      }
    }
  }

  // Find divergent fields across all clusters
  const divergentFields = new Set<string>();
  for (const pair of pairComparisons) {
    for (const row of pair.diff) {
      if (row.changed) divergentFields.add(row.field);
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <Card>
        <CardHeader
          title="Fleet Snapshot Comparison"
          icon={<Camera className="h-4 w-4" />}
          actions={
            <button
              onClick={handleCaptureAll}
              disabled={loading || clusters.length < 2}
              className={cn(
                'flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                loading || clusters.length < 2
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {loading ? 'Capturing...' : 'Capture All'}
            </button>
          }
        />
        <CardBody>
          <div className="text-sm text-slate-400">
            {clusters.length} cluster{clusters.length !== 1 ? 's' : ''} registered.
            {clusters.length < 2 && (
              <span className="ml-2 text-amber-400">At least 2 connected clusters needed for comparison.</span>
            )}
          </div>

          {/* Cluster list */}
          <div className="mt-3 flex flex-wrap gap-2">
            {clusters.map(c => {
              const entry = entries.find(e => e.clusterId === c.id);
              return (
                <span
                  key={c.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                    entry?.snapshot ? 'bg-emerald-900/40 text-emerald-300' :
                    entry?.error ? 'bg-red-900/40 text-red-300' :
                    'bg-slate-800 text-slate-400'
                  )}
                >
                  {entry?.snapshot ? <CheckCircle className="h-3 w-3" /> :
                   entry?.error ? <AlertTriangle className="h-3 w-3" /> : null}
                  {c.name}
                </span>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Pair matrix */}
      {captured && pairComparisons.length > 0 && (
        <Card>
          <CardHeader title="Pair Comparison Summary" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Cluster A</th>
                  <th className="px-4 py-2 text-left font-medium">Cluster B</th>
                  <th className="px-4 py-2 text-left font-medium">Matching</th>
                  <th className="px-4 py-2 text-left font-medium">Divergent</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {pairComparisons.map((pair) => (
                  <tr key={`${pair.clusterA}-${pair.clusterB}`} className="border-b border-slate-800">
                    <td className="px-4 py-2 text-slate-300">{pair.clusterA}</td>
                    <td className="px-4 py-2 text-slate-300">{pair.clusterB}</td>
                    <td className="px-4 py-2 text-emerald-400">{pair.totalCount - pair.changedCount}</td>
                    <td className="px-4 py-2 text-amber-400">{pair.changedCount}</td>
                    <td className="px-4 py-2">
                      {pair.changedCount === 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle className="h-3 w-3" /> Identical
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Divergent
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Divergent fields highlight */}
      {captured && divergentFields.size > 0 && (
        <Card>
          <CardHeader title="Divergent Fields" icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {[...divergentFields].sort().map(field => (
                <span
                  key={field}
                  className="inline-block rounded-sm bg-amber-900/40 px-2 py-1 text-xs font-medium text-amber-300"
                >
                  {field}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* All identical */}
      {captured && divergentFields.size === 0 && successfulEntries.length >= 2 && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle className="h-4 w-4" />
              All clusters are identical across all compared fields.
            </div>
          </CardBody>
        </Card>
      )}

      {/* Errors */}
      {entries.filter(e => e.error).map(e => (
        <Card key={e.clusterId}>
          <CardBody>
            <p className="text-sm text-red-400">
              {e.clusterName}: {e.error}
            </p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
