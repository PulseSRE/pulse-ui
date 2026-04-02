/**
 * useChartLiveData — TanStack Query hook for live Prometheus chart refresh.
 *
 * When a ChartSpec has a `query` (PromQL) field, this hook periodically
 * fetches fresh data from Prometheus and transforms it into the chart's
 * series format.  Falls back to the static spec.series when the query
 * field is absent or fetching fails.
 */

import { useQuery } from '@tanstack/react-query';
import { queryRange, getTimeRange, parseDuration } from '../components/metrics/prometheus';
import type { ChartSpec } from '../engine/agentComponents';

/** Default refresh interval in milliseconds */
export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

/** Default time range when spec.timeRange is missing */
const DEFAULT_TIME_RANGE = '1h';

const CHART_COLORS = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa',
  '#38bdf8', '#fb923c', '#e879f9', '#f472b6', '#2dd4bf',
];

export interface LiveChartResult {
  /** Series data to render — live or static fallback */
  series: ChartSpec['series'];
  /** Whether live refresh is active and succeeding */
  isLive: boolean;
  /** Whether a fetch is currently in flight */
  isFetching: boolean;
  /** Error from the latest fetch, if any */
  error: Error | null;
  /** Timestamp of last successful data fetch */
  lastUpdated: number | null;
  /** Whether auto-refresh is paused */
  isPaused: boolean;
  /** Toggle pause/resume */
  togglePause: () => void;
}

/**
 * Transform Prometheus range query results into the ChartSpec series format.
 */
function promResultToSeries(
  result: Awaited<ReturnType<typeof queryRange>>,
  specSeries: ChartSpec['series'],
): ChartSpec['series'] {
  return result.map((promSeries, i) => {
    // Build a human-readable label from the metric labels
    const metricLabels = { ...promSeries.metric };
    delete metricLabels.__name__;
    const label =
      Object.values(metricLabels).filter(Boolean).join(' / ') ||
      promSeries.metric.__name__ ||
      specSeries[i]?.label ||
      `series-${i + 1}`;

    // Preserve color from original spec if available
    const color = specSeries[i]?.color || CHART_COLORS[i % CHART_COLORS.length];

    const data: [number, number][] = promSeries.values.map(([ts, val]) => [
      ts * 1000, // Prometheus returns epoch seconds, charts expect ms
      parseFloat(val),
    ]);

    return { label, data, color };
  });
}

import { useState, useCallback } from 'react';

export function useChartLiveData(
  spec: ChartSpec,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
): LiveChartResult {
  const [isPaused, setIsPaused] = useState(false);
  const togglePause = useCallback(() => setIsPaused((p) => !p), []);

  const hasQuery = Boolean(spec.query);

  const {
    data: liveSeries,
    error,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['chart-live', spec.query, spec.timeRange],
    queryFn: async () => {
      if (!spec.query) throw new Error('No query');

      const timeRangeStr = spec.timeRange || DEFAULT_TIME_RANGE;
      let startSec: number;
      let endSec: number;

      try {
        [startSec, endSec] = getTimeRange(timeRangeStr);
      } catch {
        // If timeRange is not a valid duration string, default to 1h
        [startSec, endSec] = getTimeRange(DEFAULT_TIME_RANGE);
      }

      const result = await queryRange(spec.query!, startSec, endSec);
      return promResultToSeries(result, spec.series);
    },
    enabled: hasQuery && !isPaused,
    refetchInterval: isPaused ? false : refreshIntervalMs,
    // Keep previous data while refetching so the chart doesn't flash
    placeholderData: (prev) => prev,
    // Don't retry too aggressively for dashboard polling
    retry: 1,
    // Cache for the refresh interval
    staleTime: refreshIntervalMs / 2,
  });

  // Use live data if available, otherwise fall back to static series
  const series = liveSeries && liveSeries.length > 0 ? liveSeries : spec.series;
  const isLive = hasQuery && !isPaused && liveSeries != null && liveSeries.length > 0;

  return {
    series,
    isLive,
    isFetching,
    error: error as Error | null,
    lastUpdated: dataUpdatedAt || null,
    isPaused,
    togglePause,
  };
}
