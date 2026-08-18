/**
 * useMultiSourceTable — Orchestrates K8s watches + PromQL/log enrichment
 * for multi-datasource live tables.
 *
 * K8s datasources use useK8sListWatch (real-time via WebSocket watch).
 * PromQL datasources use queryInstant (polled via TanStack Query).
 * Log datasources poll /api/agent/log-counts (polled via TanStack Query).
 *
 * Results are merged: K8s rows are the base, enrichment datasources
 * add columns by joining on a key (e.g., Prometheus "pod" label → row "name").
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { K8sResource, ColumnDef } from '../engine/renderers';
import type { TableDatasource, K8sDatasource, PromQLDatasource, LogDatasource } from '../engine/agentComponents';
import { useK8sListWatch } from './useK8sListWatch';
import { buildApiPath } from './useResourceUrl';
import { queryInstant, queryRange } from '../components/metrics/prometheus';
import { getColumnsForResource } from '../engine/enhancers';

function formatMetricValue(value: number, unit?: string): string {
  if (unit === 'MiB' || unit === 'Mi') {
    if (value > 1048576) return `${(value / 1048576).toFixed(1)} GiB`;
    if (value > 1024) return `${(value / 1024).toFixed(1)} MiB`;
    if (value > 1) return `${value.toFixed(0)} KiB`;
    return `${value.toFixed(2)} ${unit}`;
  }
  if (unit === 'KB/s') {
    if (value > 1024) return `${(value / 1024).toFixed(1)} MB/s`;
    return `${value.toFixed(1)} KB/s`;
  }
  if (unit === 'm' || unit === 'cores') {
    if (unit === 'm' && value > 1000) return `${(value / 1000).toFixed(2)} cores`;
    return `${value.toFixed(2)} ${unit}`;
  }
  if (!unit) {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toFixed(2);
  }
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M ${unit}`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K ${unit}`;
  return `${value.toFixed(2)} ${unit}`;
}

function Sparkline({ values, width = 48, height = 16 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const color = last > prev ? '#22c55e' : last < prev ? '#ef4444' : '#64748b';
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
import { getDefaultColumns } from '../engine/renderers';
import { getImpersonationHeaders } from '../engine/query';
import { agentFetch } from '../engine/safeQuery';

const DEFAULT_ENRICHMENT_INTERVAL_MS = 30_000;

interface SourceInfo {
  id: string;
  label: string;
  count: number;
  error?: string;
}

export interface UseMultiSourceTableResult {
  /** Merged K8s resources, enriched with metric + log columns */
  resources: K8sResource[];
  /** Union of all columns (enhancer + enrichment) */
  columns: ColumnDef[];
  /** Whether any data is still loading */
  isLoading: boolean;
  /** Whether K8s watches are connected */
  isLive: boolean;
  /** Whether auto-refresh is paused */
  isPaused: boolean;
  /** Toggle pause/resume */
  togglePause: () => void;
  /** Source metadata for the footer */
  sources: SourceInfo[];
  /** Timestamp of last enrichment poll (ms epoch), null if no enrichment */
  enrichmentUpdatedAt: number | null;
}

/** Convert a K8sDatasource to a GVR key like "v1/pods" or "apps/v1/deployments" */
function datasourceToGvrKey(ds: K8sDatasource): string {
  const group = ds.group || '';
  const version = ds.version || 'v1';
  return group ? `${group}/${version}/${ds.resource}` : `${version}/${ds.resource}`;
}

/** Convert a K8sDatasource to an apiPath for useK8sListWatch */
function datasourceToApiPath(ds: K8sDatasource): string {
  const gvrKey = datasourceToGvrKey(ds);
  return buildApiPath(gvrKey, ds.namespace);
}

/**
 * Hook wrapper that conditionally calls useK8sListWatch.
 * React hooks must be called unconditionally, so each datasource
 * slot calls this — disabled slots return empty arrays.
 */
function useConditionalWatch(
  ds: K8sDatasource | null,
  enabled: boolean,
) {
  const apiPath = ds ? datasourceToApiPath(ds) : '';
  const namespace = ds?.namespace || '';

  // Build query params for selectors
  let effectivePath = apiPath;
  if (ds && (ds.labelSelector || ds.fieldSelector)) {
    const params = new URLSearchParams();
    if (ds.labelSelector) params.set('labelSelector', ds.labelSelector);
    if (ds.fieldSelector) params.set('fieldSelector', ds.fieldSelector);
    effectivePath = `${apiPath}?${params}`;
  }

  return useK8sListWatch({
    apiPath: effectivePath,
    namespace: namespace === '' ? undefined : namespace,
    enabled: enabled && !!apiPath,
  });
}

// Max K8s datasources we support (hooks must be called unconditionally)
const MAX_K8S_DATASOURCES = 5;

export function useMultiSourceTable(
  datasources: TableDatasource[],
  enrichmentIntervalMs = DEFAULT_ENRICHMENT_INTERVAL_MS,
): UseMultiSourceTableResult {
  const [isPaused, setIsPaused] = useState(false);
  const togglePause = useCallback(() => setIsPaused((p) => !p), []);

  // Partition datasources by type
  const k8sDatasources = useMemo(
    () => datasources.filter((ds): ds is K8sDatasource => ds.type === 'k8s').slice(0, MAX_K8S_DATASOURCES),
    [datasources],
  );
  const promqlDatasources = useMemo(
    () => datasources.filter((ds): ds is PromQLDatasource => ds.type === 'promql'),
    [datasources],
  );
  const logDatasources = useMemo(
    () => datasources.filter((ds): ds is LogDatasource => ds.type === 'logs'),
    [datasources],
  );

  // Pad K8s datasources array to MAX_K8S_DATASOURCES for stable hook count
  const paddedK8s: (K8sDatasource | null)[] = useMemo(() => {
    const arr: (K8sDatasource | null)[] = [...k8sDatasources];
    while (arr.length < MAX_K8S_DATASOURCES) arr.push(null);
    return arr;
  }, [k8sDatasources]);

  // Call useK8sListWatch unconditionally for each slot
  const watch0 = useConditionalWatch(paddedK8s[0], !isPaused);
  const watch1 = useConditionalWatch(paddedK8s[1], !isPaused);
  const watch2 = useConditionalWatch(paddedK8s[2], !isPaused);
  const watch3 = useConditionalWatch(paddedK8s[3], !isPaused);
  const watch4 = useConditionalWatch(paddedK8s[4], !isPaused);

  const watchResults = [watch0, watch1, watch2, watch3, watch4];

  // PromQL enrichment — instant values + sparkline range data
  const {
    data: promqlData,
    dataUpdatedAt: promqlUpdatedAt,
  } = useQuery({
    queryKey: ['multi-table-promql', promqlDatasources.map((ds) => ds.query)],
    queryFn: async () => {
      const results: Record<string, Array<{ metric: Record<string, string>; value: number }>> = {};
      await Promise.all(
        promqlDatasources.map(async (ds) => {
          try {
            results[ds.id] = await queryInstant(ds.query);
          } catch {
            results[ds.id] = [];
          }
        }),
      );
      return results;
    },
    enabled: promqlDatasources.length > 0 && !isPaused,
    refetchInterval: isPaused ? false : enrichmentIntervalMs,
    placeholderData: (prev) => prev,
    retry: 1,
    staleTime: enrichmentIntervalMs / 2,
  });

  // Sparkline data — range query for last 15 minutes (15 points at 60s step)
  const { data: sparklineData } = useQuery({
    queryKey: ['multi-table-sparkline', promqlDatasources.map((ds) => ds.query)],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const start = now - 900; // 15 minutes
      const step = 60;
      const results: Record<string, Array<{ metric: Record<string, string>; values: number[] }>> = {};
      await Promise.all(
        promqlDatasources.map(async (ds) => {
          try {
            const series = await queryRange(ds.query, start, now, step);
            results[ds.id] = series.map((s) => ({
              metric: s.metric,
              // Prometheus can return "NaN"/"+Inf"/"-Inf" samples (e.g. a
              // rate() with no data at that instant); a single one poisons
              // Sparkline's Math.min/Math.max below and breaks the chart.
              values: s.values.map(([, v]) => parseFloat(v)).filter(Number.isFinite),
            }));
          } catch {
            results[ds.id] = [];
          }
        }),
      );
      return results;
    },
    enabled: promqlDatasources.length > 0 && !isPaused,
    refetchInterval: isPaused ? false : enrichmentIntervalMs,
    placeholderData: (prev) => prev,
    retry: 1,
    staleTime: enrichmentIntervalMs / 2,
  });

  // Log enrichment
  const {
    data: logData,
    dataUpdatedAt: logUpdatedAt,
  } = useQuery({
    queryKey: ['multi-table-logs', logDatasources.map((ds) => `${ds.namespace}:${ds.pattern}:${ds.labelSelector}`)],
    queryFn: async () => {
      const results: Record<string, Record<string, number>> = {};
      await Promise.all(
        logDatasources.map(async (ds) => {
          try {
            const params = new URLSearchParams({
              namespace: ds.namespace,
              pattern: ds.pattern || 'error|Error|ERROR',
              tailLines: String(ds.tailLines || 100),
            });
            if (ds.labelSelector) params.set('labelSelector', ds.labelSelector);
            const res = await agentFetch(`/api/agent/log-counts?${params}`, {
              headers: getImpersonationHeaders(),
            });
            if (res.ok) {
              const json = await res.json();
              results[ds.id] = json.counts || {};
            } else {
              results[ds.id] = {};
            }
          } catch {
            results[ds.id] = {};
          }
        }),
      );
      return results;
    },
    enabled: logDatasources.length > 0 && !isPaused,
    refetchInterval: isPaused ? false : enrichmentIntervalMs,
    placeholderData: (prev) => prev,
    retry: 1,
    staleTime: enrichmentIntervalMs / 2,
  });

  // Merge K8s resources from all watch results
  const { mergedResources, sources, isLoading, isLive } = useMemo(() => {
    const allResources: K8sResource[] = [];
    const srcInfo: SourceInfo[] = [];
    let loading = false;
    let live = false;
    const seenUids = new Set<string>();

    k8sDatasources.forEach((ds, i) => {
      const result = watchResults[i];
      if (!result) return;

      if (result.isLoading) loading = true;
      if (result.data && result.data.length > 0) live = true;

      const resources = result.data || [];
      let count = 0;

      for (const r of resources) {
        const uid = r.metadata?.uid || '';
        if (uid && seenUids.has(uid)) continue;
        if (uid) seenUids.add(uid);

        // Stamp source label and GVR key
        const enriched = { ...r } as K8sResource & Record<string, unknown>;
        enriched._source = ds.label;
        enriched._gvrKey = datasourceToGvrKey(ds);
        allResources.push(enriched as K8sResource);
        count++;
      }

      srcInfo.push({ id: ds.id, label: ds.label, count });
    });

    return { mergedResources: allResources, sources: srcInfo, isLoading: loading, isLive: live };
  }, [k8sDatasources, ...watchResults.map((w) => w.data)]);

  // Apply PromQL enrichment
  const enrichedResources = useMemo(() => {
    if (!promqlData && !logData) return mergedResources;

    return mergedResources.map((r) => {
      const enriched = { ...r } as K8sResource & Record<string, unknown>;

      // PromQL enrichment
      if (promqlData) {
        for (const ds of promqlDatasources) {
          const results = promqlData[ds.id] || [];
          const matchRow = (m: { metric: Record<string, string> }) => {
            const labelValue = m.metric[ds.joinLabel] || '';
            const rowValue = String(
              ds.joinColumn === 'name'
                ? r.metadata?.name || ''
                : ds.joinColumn === 'namespace'
                  ? r.metadata?.namespace || ''
                  : (r as Record<string, unknown>)[ds.joinColumn] || '',
            );
            return labelValue === rowValue;
          };
          const match = results.find(matchRow);
          if (match) {
            enriched[ds.columnId] = formatMetricValue(match.value, ds.unit);
          } else {
            enriched[ds.columnId] = '-';
          }
          // Attach sparkline data
          if (sparklineData) {
            const sparkSeries = (sparklineData[ds.id] || []).find(matchRow);
            if (sparkSeries) {
              enriched[`${ds.columnId}__spark`] = sparkSeries.values;
            }
          }
        }
      }

      // Log enrichment
      if (logData) {
        for (const ds of logDatasources) {
          const counts = logData[ds.id] || {};
          const podName = r.metadata?.name || '';
          enriched[ds.columnId] = counts[podName] ?? 0;
        }
      }

      return enriched as K8sResource;
    });
  }, [mergedResources, promqlData, sparklineData, logData, promqlDatasources, logDatasources]);

  // Build columns — use enhancer for single resource type, default columns for mixed types
  const columns = useMemo(() => {
    const namespaced = k8sDatasources.some((ds) => !!ds.namespace);
    const gvrKeys = new Set(k8sDatasources.map(datasourceToGvrKey));
    const isMixedTypes = gvrKeys.size > 1;

    let baseCols: ColumnDef[];

    if (isMixedTypes || gvrKeys.size === 0) {
      // Mixed resource types — use default columns (Name, Namespace, Age, Labels, Owner)
      // which work for any K8s resource. Add a Kind column for disambiguation.
      baseCols = [
        ...getDefaultColumns(namespaced),
      ];
      // Insert Kind column after Name
      const nameIdx = baseCols.findIndex((c) => c.id === 'name');
      baseCols.splice(nameIdx + 1, 0, {
        id: '_kind',
        header: 'Kind',
        accessorFn: (r: K8sResource) => r.kind || '',
        render: (value: unknown) => (
          <span className="text-xs text-slate-400">{String(value)}</span>
        ),
        sortable: true,
        priority: 1,
      });
    } else {
      // Single resource type — use enhancer columns for rich rendering
      const gvr = [...gvrKeys][0];
      baseCols = getColumnsForResource(gvr, namespaced, mergedResources);
    }

    // Add source column when multiple K8s datasources
    if (k8sDatasources.length > 1) {
      baseCols = [
        ...baseCols,
        {
          id: '_source',
          header: 'Source',
          accessorFn: (r: K8sResource) => (r as Record<string, unknown>)._source || '',
          render: (value: unknown) => {
            const label = String(value || '');
            return (
              <span className="inline-block px-1.5 py-0.5 text-xs rounded-sm bg-slate-700 text-slate-300">
                {label}
              </span>
            );
          },
          sortable: true,
          priority: 90,
        } satisfies ColumnDef,
      ];
    }

    // Add enrichment columns with sparklines
    for (const ds of promqlDatasources) {
      baseCols.push({
        id: ds.columnId,
        header: ds.columnHeader,
        accessorFn: (r: K8sResource) => (r as Record<string, unknown>)[ds.columnId] ?? '-',
        render: (value: unknown, resource: K8sResource) => {
          const sparkPoints = (resource as Record<string, unknown>)[`${ds.columnId}__spark`] as number[] | undefined;
          return (
            <div className="flex items-center gap-1.5">
              {sparkPoints && sparkPoints.length > 1 && <Sparkline values={sparkPoints} />}
              <span className="font-mono text-sm text-slate-300">{String(value)}</span>
            </div>
          );
        },
        sortable: true,
        sortType: 'number',
        priority: 80,
      });
    }

    for (const ds of logDatasources) {
      baseCols.push({
        id: ds.columnId,
        header: ds.columnHeader,
        accessorFn: (r: K8sResource) => (r as Record<string, unknown>)[ds.columnId] ?? 0,
        render: (value: unknown) => {
          const count = Number(value) || 0;
          const color = count > 0 ? 'text-red-400' : 'text-slate-500';
          return <span className={`font-mono text-sm ${color}`}>{count}</span>;
        },
        sortable: true,
        sortType: 'number',
        priority: 80,
      });
    }

    return baseCols;
  }, [k8sDatasources, promqlDatasources, logDatasources, mergedResources]);

  // Enrichment last-updated timestamp — consumers compute age at render time
  const hasEnrichment = promqlDatasources.length > 0 || logDatasources.length > 0;
  const enrichmentUpdatedAt = hasEnrichment
    ? Math.max(promqlUpdatedAt || 0, logUpdatedAt || 0) || null
    : null;

  return {
    resources: enrichedResources,
    columns,
    isLoading,
    isLive,
    isPaused,
    togglePause,
    sources,
    enrichmentUpdatedAt,
  };
}
