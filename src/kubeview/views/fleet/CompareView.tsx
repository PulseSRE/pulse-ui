/**
 * CompareView — side-by-side snapshot comparison of two clusters.
 * Captures a live snapshot from each cluster and shows a diff table.
 */

import React, { useState } from 'react';
import { Loader2, GitCompare, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardBody } from '../../components/primitives/Card';
import { captureSnapshot, compareSnapshots, type ClusterSnapshot, type DiffRow } from '../../engine/snapshot';
import { getAllConnections } from '../../engine/clusterConnection';

interface CompareViewProps {
  clusterA?: string;
  clusterB?: string;
}

export default function CompareView({ clusterA, clusterB }: CompareViewProps) {
  const clusters = getAllConnections().filter(c => c.status === 'connected');

  const [selectedA, setSelectedA] = useState(clusterA || clusters[0]?.id || '');
  const [selectedB, setSelectedB] = useState(clusterB || clusters[1]?.id || clusters[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotA, setSnapshotA] = useState<ClusterSnapshot | null>(null);
  const [snapshotB, setSnapshotB] = useState<ClusterSnapshot | null>(null);
  const [diff, setDiff] = useState<DiffRow[]>([]);

  const clusterNameA = clusters.find(c => c.id === selectedA)?.name || selectedA;
  const clusterNameB = clusters.find(c => c.id === selectedB)?.name || selectedB;

  const handleCompare = async () => {
    if (!selectedA || !selectedB) return;
    setLoading(true);
    setError(null);
    setDiff([]);

    try {
      const [snapA, snapB] = await Promise.all([
        captureSnapshot(`Compare: ${clusterNameA}`, selectedA),
        captureSnapshot(`Compare: ${clusterNameB}`, selectedB),
      ]);
      setSnapshotA(snapA);
      setSnapshotB(snapB);
      setDiff(compareSnapshots(snapA, snapB));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture snapshots');
    } finally {
      setLoading(false);
    }
  };

  const changedCount = diff.filter(r => r.changed).length;
  const matchedCount = diff.filter(r => !r.changed).length;

  // Group diff rows by category
  const groupedDiff = diff.reduce<Record<string, DiffRow[]>>((acc, row) => {
    if (!acc[row.category]) acc[row.category] = [];
    acc[row.category].push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-4 p-4">
      {/* Cluster selectors */}
      <Card>
        <CardHeader
          title="Cross-Cluster Comparison"
          icon={<GitCompare className="h-4 w-4" />}
          actions={
            <button
              onClick={handleCompare}
              disabled={loading || !selectedA || !selectedB || selectedA === selectedB}
              className={cn(
                'flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                loading || !selectedA || !selectedB || selectedA === selectedB
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {loading ? 'Capturing...' : 'Compare'}
            </button>
          }
        />
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-400">Cluster A</label>
              <select
                value={selectedA}
                onChange={(e) => setSelectedA(e.target.value)}
                className="w-full rounded-sm border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                aria-label="Select Cluster A"
              >
                {clusters.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="pt-5 text-slate-500 text-lg font-bold">vs</div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-400">Cluster B</label>
              <select
                value={selectedB}
                onChange={(e) => setSelectedB(e.target.value)}
                className="w-full rounded-sm border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                aria-label="Select Cluster B"
              >
                {clusters.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedA === selectedB && selectedA && (
            <p className="mt-2 text-xs text-amber-400">Select two different clusters to compare.</p>
          )}
        </CardBody>
      </Card>

      {/* Error */}
      {error && (
        <Card>
          <CardBody>
            <p className="text-sm text-red-400">{error}</p>
          </CardBody>
        </Card>
      )}

      {/* Summary */}
      {diff.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex gap-6 text-sm">
              <span className="text-emerald-400">{matchedCount} fields match</span>
              <span className="text-amber-400">{changedCount} fields differ</span>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Diff table grouped by category */}
      {Object.entries(groupedDiff).map(([category, rows]) => (
        <Card key={category}>
          <CardHeader title={category} />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Field</th>
                  <th className="px-4 py-2 text-left font-medium">{clusterNameA}</th>
                  <th className="px-4 py-2 text-left font-medium">{clusterNameB}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.field}
                    className={cn(
                      'border-b border-slate-800',
                      row.changed ? 'bg-amber-950/30' : 'bg-emerald-950/20'
                    )}
                  >
                    <td className="px-4 py-2 font-medium text-slate-300">{row.field}</td>
                    <td className="px-4 py-2 text-slate-400 max-w-xs truncate">{row.left || '\u2014'}</td>
                    <td className="px-4 py-2 text-slate-400 max-w-xs truncate">{row.right || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
