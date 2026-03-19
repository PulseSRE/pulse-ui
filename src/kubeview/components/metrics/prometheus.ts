/**
 * Prometheus API client utilities
 *
 * Helper functions for querying Prometheus/Thanos via the /api/prometheus proxy
 */

const PROM_BASE = '/api/prometheus';

export interface PrometheusDataPoint {
  timestamp: number;
  value: number;
}

export interface PrometheusSeries {
  metric: Record<string, string>;
  values: [number, string][];
}

export interface PrometheusRangeResult {
  resultType: 'matrix';
  result: PrometheusSeries[];
}

export interface PrometheusInstantResult {
  resultType: 'vector';
  result: Array<{
    metric: Record<string, string>;
    value: [number, string];
  }>;
}

export interface PrometheusResponse<T> {
  status: 'success' | 'error';
  data?: T;
  errorType?: string;
  error?: string;
}

/**
 * Execute a range query (time-series data)
 */
export async function queryRange(
  query: string,
  start: number,
  end: number,
  step?: number
): Promise<PrometheusSeries[]> {
  const calculatedStep = step ?? Math.max(15, Math.floor((end - start) / 200));

  const params = new URLSearchParams({
    query,
    start: start.toString(),
    end: end.toString(),
    step: calculatedStep.toString(),
  });

  const url = `${PROM_BASE}/api/v1/query_range?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Prometheus query failed: ${res.status} ${res.statusText}`);
  }

  const json: PrometheusResponse<PrometheusRangeResult> = await res.json();

  if (json.status === 'error') {
    throw new Error(`Prometheus error: ${json.error || json.errorType}`);
  }

  return json.data?.result || [];
}

/**
 * Execute an instant query (single point in time)
 */
export async function queryInstant(
  query: string,
  time?: number
): Promise<Array<{ metric: Record<string, string>; value: number }>> {
  const params = new URLSearchParams({ query });
  if (time) {
    params.set('time', time.toString());
  }

  const url = `${PROM_BASE}/api/v1/query?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Prometheus query failed: ${res.status} ${res.statusText}`);
  }

  const json: PrometheusResponse<PrometheusInstantResult> = await res.json();

  if (json.status === 'error') {
    throw new Error(`Prometheus error: ${json.error || json.errorType}`);
  }

  return (json.data?.result || []).map((r) => ({
    metric: r.metric,
    value: parseFloat(r.value[1]),
  }));
}

/**
 * Get all metric names
 */
export async function getMetricNames(): Promise<string[]> {
  const url = `${PROM_BASE}/api/v1/label/__name__/values`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch metric names: ${res.status} ${res.statusText}`);
  }

  const json: PrometheusResponse<string[]> = await res.json();

  if (json.status === 'error') {
    throw new Error(`Prometheus error: ${json.error || json.errorType}`);
  }

  return json.data || [];
}

/**
 * Get label values for a given label name
 */
export async function getLabelValues(labelName: string): Promise<string[]> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(labelName)) {
    throw new Error(`Invalid Prometheus label name: ${labelName}`);
  }
  const url = `${PROM_BASE}/api/v1/label/${labelName}/values`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch label values: ${res.status} ${res.statusText}`);
  }

  const json: PrometheusResponse<string[]> = await res.json();

  if (json.status === 'error') {
    throw new Error(`Prometheus error: ${json.error || json.errorType}`);
  }

  return json.data || [];
}

/**
 * Convert Prometheus series to chart data points
 */
export function seriesToDataPoints(series: PrometheusSeries): PrometheusDataPoint[] {
  return series.values.map(([timestamp, value]) => ({
    timestamp,
    value: parseFloat(value),
  }));
}

/**
 * Parse Prometheus duration string (e.g., "5m", "1h", "30s")
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdw])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
  };

  return value * (multipliers[unit] || 1);
}

/**
 * Format duration as Prometheus duration string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

/**
 * Build a time range for common durations
 */
export function getTimeRange(duration: string): [number, number] {
  const now = Math.floor(Date.now() / 1000);
  const seconds = parseDuration(duration);
  return [now - seconds, now];
}

/**
 * React hook for querying Prometheus range data
 */
export function usePrometheusRange(
  query: string,
  timeRange: [number, number],
  enabled = true
) {
  const [data, setData] = React.useState<PrometheusSeries[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!enabled || !query) return;

    const [start, end] = timeRange;
    setLoading(true);
    setError(null);

    queryRange(query, start, end)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [query, timeRange[0], timeRange[1], enabled]);

  return { data, loading, error };
}

/**
 * React hook for querying Prometheus instant data
 */
export function usePrometheusInstant(query: string, enabled = true) {
  const [data, setData] = React.useState<Array<{ metric: Record<string, string>; value: number }>>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!enabled || !query) return;

    setLoading(true);
    setError(null);

    queryInstant(query)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [query, enabled]);

  return { data, loading, error };
}

// Import React for hooks
import * as React from 'react';
