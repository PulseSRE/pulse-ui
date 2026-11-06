/**
 * Prometheus API client utilities
 *
 * Helper functions for querying Prometheus/Thanos via the /api/prometheus proxy.
 *
 * That proxy reaches the monitoring stack of the cluster Pulse is deployed on
 * ("local") and nothing else: clusterConnection has no per-cluster Prometheus
 * route. Every helper therefore takes the cluster the screen is showing and
 * refuses — without sending a request — when it is not the local cluster, so
 * a remote cluster's page can never be drawn with the local cluster's numbers.
 */

import { getImpersonationHeaders } from '../../engine/query';
import { checkAuth } from '../../engine/safeQuery';
import { getActiveClusterId, getAllConnections, LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { formatPromRange } from '../../engine/format';
import { PrometheusReadError } from '../../engine/readError';

export { PrometheusReadError } from '../../engine/readError';

const PROM_BASE = '/api/prometheus';

/** The only cluster whose Prometheus the UI can reach. */
export const METRICS_CLUSTER_ID = LOCAL_CLUSTER_ID;

/** Metrics were requested for a cluster whose Prometheus Pulse cannot reach. */
export class MetricsUnavailableError extends Error {
  constructor(public readonly clusterId: string) {
    const name = getAllConnections().find(c => c.id === clusterId)?.name ?? clusterId;
    super(`Metrics are only available for the local cluster. Prometheus for ${name} is not reachable from Pulse.`);
    this.name = 'MetricsUnavailableError';
  }
}

/** Whether Prometheus data can be shown for this cluster (default: the active one). */
export function metricsAvailableFor(clusterId?: string): boolean {
  return (clusterId ?? getActiveClusterId()) === METRICS_CLUSTER_ID;
}

/** How long a Prometheus read may take before it is reported as timed out. */
export const PROM_TIMEOUT_MS = 30_000;

/** The JSON error envelope Prometheus sends with most failures. */
interface PromErrorBody { error?: string; errorType?: string }

const HTML_TEXT = /Unexpected token '?<|<!DOCTYPE|<html/i;

function htmlFailure(status: number): PrometheusReadError {
  return new PrometheusReadError(
    'html',
    `Prometheus returned an HTML page (status ${status}) — the metrics backend may be down or behind a login`,
    status,
  );
}

/** A failure Prometheus itself described: keep its reason, and its timeouts as timeouts. */
function envelopeFailure(status: number, body: PromErrorBody): PrometheusReadError | null {
  const reason = body.error || body.errorType;
  if (body.errorType === 'timeout') {
    return new PrometheusReadError('timeout', `Prometheus timed out${reason ? `: ${reason}` : ''} — try a shorter range`, status);
  }
  if (reason && status < 500) return new PrometheusReadError('query', `Prometheus error: ${reason}`, status);
  return null;
}

function httpFailure(res: Response, body?: PromErrorBody): PrometheusReadError {
  const status = res.status;
  const statusText = res.statusText ? ` ${res.statusText}` : '';
  const reason = body?.error || body?.errorType;
  if (status === 401) return new PrometheusReadError('unauthorized', 'Prometheus rejected the session (401) — sign in again', status, reason);
  if (status === 403) {
    return new PrometheusReadError('forbidden', 'Prometheus refused the query (403 forbidden) — your account may not have access to metrics', status, reason);
  }
  const described = body ? envelopeFailure(status, body) : null;
  if (described) return described;
  if (status === 504 || status === 408) {
    return new PrometheusReadError('timeout', `Prometheus timed out (status ${status}) — try a shorter range`, status, reason);
  }
  return new PrometheusReadError('http', `Prometheus query failed: ${status}${statusText}${reason ? ` — ${reason}` : ''}`, status);
}

function isHtml(res: Response): boolean {
  const ct = res.headers?.get?.('content-type') ?? '';
  return /text\/html/i.test(ct);
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * One Prometheus request, start to finish: the timeout covers reading the
 * body (`read`), not just the headers, and the caller's signal cancels it.
 */
async function promRequest<R>(
  apiPath: string,
  clusterId: string | undefined,
  init: RequestInit,
  read: (res: Response) => Promise<R>,
): Promise<R> {
  const id = clusterId ?? getActiveClusterId();
  if (!metricsAvailableFor(id)) throw new MetricsUnavailableError(id);
  const headers = { ...getImpersonationHeaders(), ...((init.headers as Record<string, string> | undefined) ?? {}) };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PROM_TIMEOUT_MS);
  const outer = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timeoutError = () => new PrometheusReadError('timeout', `Prometheus did not answer within ${PROM_TIMEOUT_MS / 1000}s (timed out)`);

  try {
    let res: Response;
    try {
      res = await fetch(`${PROM_BASE}${apiPath}`, { ...init, headers, signal: controller.signal });
    } catch (e) {
      if (timedOut) throw timeoutError();
      // The caller cancelled (React Query unmount, new key): pass that through untouched.
      if (outer?.aborted) throw e;
      throw new PrometheusReadError(
        'unreachable',
        'Prometheus could not be reached — check the network or the metrics proxy',
        undefined,
        e instanceof Error ? e.message : String(e),
      );
    }
    checkAuth(res);
    if (isHtml(res)) throw htmlFailure(res.status);
    if (!res.ok) {
      let body: PromErrorBody | undefined;
      try {
        body = await res.json();
      } catch (e) {
        if (timedOut) throw timeoutError();
        if (HTML_TEXT.test(e instanceof Error ? e.message : '')) throw htmlFailure(res.status);
        // Not JSON: the status line is all there is.
      }
      throw httpFailure(res, body);
    }
    try {
      return await read(res);
    } catch (e) {
      if (timedOut && isAbort(e)) throw timeoutError();
      throw e;
    }
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * fetch() a Prometheus API path for one cluster, with impersonation headers.
 *
 * Throws instead of handing back an answer that is not Prometheus's:
 * - MetricsUnavailableError (no request sent) for a non-local cluster;
 * - PrometheusReadError for a non-2xx status (keeping Prometheus's own
 *   `error`), an HTML page (a proxy error or login page), a network failure,
 *   or no answer within PROM_TIMEOUT_MS.
 * Its message is a sentence a user can read. Prefer promJson, whose timeout
 * also covers reading the body.
 */
export function promFetch(apiPath: string, clusterId?: string, init: RequestInit = {}): Promise<Response> {
  return promRequest(apiPath, clusterId, init, async (res) => res);
}

/**
 * Read a Prometheus API path and unwrap its envelope. A body that is not JSON
 * (an HTML page served with a 200) and `status: "error"` become
 * PrometheusReadErrors rather than a raw parser message.
 */
export function promJson<T>(apiPath: string, clusterId?: string, signal?: AbortSignal): Promise<T | undefined> {
  return promRequest(apiPath, clusterId, { signal }, async (res) => {
    let json: PrometheusResponse<T>;
    try {
      json = await res.json();
    } catch (e) {
      if (isAbort(e)) throw e;
      const raw = e instanceof Error ? e.message : String(e);
      if (HTML_TEXT.test(raw)) throw htmlFailure(res.status);
      throw new PrometheusReadError('not-json', `Prometheus returned a response that is not JSON (status ${res.status})`, res.status, raw);
    }
    if (json?.status === 'error') {
      throw envelopeFailure(res.status, json) ?? new PrometheusReadError('query', `Prometheus error: ${json.error || json.errorType}`, res.status);
    }
    return json?.data;
  });
}

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
  step?: number,
  clusterId?: string,
  signal?: AbortSignal,
): Promise<PrometheusSeries[]> {
  const calculatedStep = step ?? Math.max(15, Math.floor((end - start) / 200));

  const params = new URLSearchParams({
    query,
    start: start.toString(),
    end: end.toString(),
    step: calculatedStep.toString(),
  });

  const data = await promJson<PrometheusRangeResult>(`/api/v1/query_range?${params}`, clusterId, signal);
  return data?.result || [];
}

/**
 * Execute an instant query (single point in time)
 */
export async function queryInstant(
  query: string,
  time?: number,
  clusterId?: string,
  signal?: AbortSignal,
): Promise<Array<{ metric: Record<string, string>; value: number }>> {
  const params = new URLSearchParams({ query });
  if (time) {
    params.set('time', time.toString());
  }

  const data = await promJson<PrometheusInstantResult>(`/api/v1/query?${params}`, clusterId, signal);
  return (data?.result || []).map((r) => ({
    metric: r.metric,
    value: parseFloat(r.value[1]),
  }));
}

/**
 * Get all metric names
 */
export async function getMetricNames(clusterId?: string): Promise<string[]> {
  return (await promJson<string[]>('/api/v1/label/__name__/values', clusterId)) || [];
}

/**
 * Get label values for a given label name
 */
export async function getLabelValues(labelName: string, clusterId?: string): Promise<string[]> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(labelName)) {
    throw new Error(`Invalid Prometheus label name: ${labelName}`);
  }
  return (await promJson<string[]>(`/api/v1/label/${labelName}/values`, clusterId)) || [];
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
export const formatDuration = formatPromRange;

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
