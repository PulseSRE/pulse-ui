/**
 * FleetConfigMatrix — cluster configuration across ALL connected clusters,
 * each value compared with the majority of the clusters that could be read.
 *
 * This is the all-clusters view that Compliance's "Configuration Drift" table
 * used to provide; it now lives on Compare & Drift (config mode), beside the
 * two-cluster snapshot diff. A cluster whose read failed shows "unavailable"
 * and is never counted as matching or as drift.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardBody } from '../../components/primitives/Card';
import { getAllConnections } from '../../engine/clusterConnection';
import { readK8s, type ReadResult } from '../../engine/readResult';
import { DEFAULT_SCHEDULER_PROFILE } from '../../engine/snapshot';

type Extract = (d: Record<string, any> | null) => string;

/* eslint-disable @typescript-eslint/no-explicit-any */
export const CONFIG_FIELDS: Array<{ path: string; field: string; extract: Extract }> = [
  { path: '/apis/config.openshift.io/v1/clusterversions/version', field: 'Cluster Version', extract: (d: any) => d?.status?.desired?.version || d?.status?.history?.[0]?.version || 'unknown' },
  { path: '/apis/config.openshift.io/v1/oauths/cluster', field: 'Identity providers', extract: (d: any) => (d?.spec?.identityProviders || []).map((p: any) => p.type).sort().join(', ') || 'none' },
  { path: '/apis/config.openshift.io/v1/apiservers/cluster', field: 'TLS Profile', extract: (d: any) => d?.spec?.tlsSecurityProfile?.type || 'Intermediate' },
  { path: '/apis/config.openshift.io/v1/apiservers/cluster', field: 'Encryption Type', extract: (d: any) => d?.spec?.encryption?.type || 'identity' },
  { path: '/apis/config.openshift.io/v1/ingresses/cluster', field: 'Ingress Domain', extract: (d: any) => d?.spec?.domain || 'unknown' },
  { path: '/apis/config.openshift.io/v1/schedulers/cluster', field: 'Scheduler Profile', extract: (d: any) => d?.spec?.profile || `${DEFAULT_SCHEDULER_PROFILE} (default)` },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Cell { value: string; unavailable: boolean; reason?: string }
interface Row { field: string; cells: Record<string, Cell>; majority: string | null }

/** The most common readable value; null when nothing could be read. */
export function majorityOf(cells: Cell[]): string | null {
  const counts = new Map<string, number>();
  for (const c of cells) if (!c.unavailable) counts.set(c.value, (counts.get(c.value) || 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) if (n > bestCount) { best = v; bestCount = n; }
  return best;
}

export function FleetConfigMatrix() {
  const clusters = getAllConnections().filter((c) => c.status === 'connected');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const cache = new Map<string, Promise<ReadResult<Record<string, unknown>>>>();
      const read = (path: string, clusterId: string) => {
        const key = `${clusterId} ${path}`;
        if (!cache.has(key)) cache.set(key, readK8s<Record<string, unknown>>(path, clusterId));
        return cache.get(key)!;
      };
      const next: Row[] = [];
      for (const f of CONFIG_FIELDS) {
        const cells: Record<string, Cell> = {};
        await Promise.all(clusters.map(async (c) => {
          const r = await read(f.path, c.id);
          cells[c.id] = r.state === 'error'
            ? { value: 'unavailable', unavailable: true, reason: r.reason }
            : { value: f.extract(r.state === 'ok' ? (r.data as Record<string, unknown>) : null), unavailable: false };
        }));
        next.push({ field: f.field, cells, majority: majorityOf(Object.values(cells)) });
      }
      setRows(next);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters.map((c) => c.id).join(',')]);

  useEffect(() => { if (clusters.length > 0) void scan(); }, [scan, clusters.length]);

  const drifted = rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => !c.unavailable && r.majority !== null && c.value !== r.majority).length, 0);

  return (
    <Card>
      <CardHeader
        title="All clusters vs the majority"
        icon={<Layers className="h-4 w-4" />}
        actions={
          <button onClick={() => void scan()} disabled={loading} className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-scan
          </button>
        }
      />
      <CardBody className="p-0">
        {clusters.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-faint">No connected clusters.</div>
        ) : loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-faint"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading configuration…</div>
        ) : (
          <>
            <div className="px-4 py-2 text-xs text-slate-400" data-testid="config-matrix-summary">
              {drifted === 0 ? 'No readable value differs from the majority' : `${drifted} value${drifted !== 1 ? 's differ' : ' differs'} from the majority`}
              {' '}· unavailable values are not compared
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400">
                    <th className="px-4 py-2 text-left font-medium">Configuration</th>
                    {clusters.map((c) => <th key={c.id} className="px-4 py-2 text-center font-medium">{c.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.field} className="border-b border-slate-800">
                      <td className="px-4 py-2 font-medium text-slate-300">{r.field}</td>
                      {clusters.map((c) => {
                        const cell = r.cells[c.id];
                        if (!cell) return <td key={c.id} />;
                        const drift = !cell.unavailable && r.majority !== null && cell.value !== r.majority;
                        return (
                          <td key={c.id} title={cell.reason}
                            className={cn('px-4 py-2 text-center font-mono text-sm',
                              drift ? 'bg-amber-950/30 text-amber-400' : cell.unavailable ? 'italic text-faint' : 'text-slate-400')}>
                            {cell.value}
                            {drift && <span className="ml-1 text-xs text-amber-500">(drift)</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default React.memo(FleetConfigMatrix);
