/**
 * Readable reasons for failed reads.
 *
 * One cause (say, Prometheus behind a login page) used to reach the screen as
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` on one page, "No
 * data" on another and a dev-server hint on a third. `describeReadError` turns
 * the errors we know into one plain sentence and keeps the raw text as detail
 * for whoever needs to debug it. Kept free of store/query imports so the
 * LoadError primitive can use it anywhere.
 */

export type PrometheusFailure =
  | 'html' // the proxy or a login page answered instead of Prometheus
  | 'forbidden'
  | 'unauthorized'
  | 'timeout'
  | 'unreachable'
  | 'http'
  | 'query' // Prometheus answered with status "error" (bad query, too many samples, …)
  | 'not-json';

/** A Prometheus read that failed, with a sentence a user can act on as its message. */
export class PrometheusReadError extends Error {
  constructor(
    public readonly kind: PrometheusFailure,
    message: string,
    public readonly status?: number,
    /** Raw text (parser message, response snippet) for the Details disclosure. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'PrometheusReadError';
  }
}

export interface ReadErrorDescription {
  /** One plain sentence. */
  reason: string;
  /** The raw message, when it says something the reason does not. */
  detail?: string;
}

// An HTML page parsed as JSON: only a fetched body produces this, never a
// user's own JSON or YAML (whose parse errors must reach them unchanged).
const HTML_AS_JSON = /Unexpected token '?<'?|"<!DOCTYPE|<html/i;
const NETWORK_MESSAGE = /Failed to fetch|NetworkError|Load failed|ECONNREFUSED|network request failed/i;

/** The HTTP status a failed read carries (`statusCode` on PulseError, `status` on agent/Prometheus errors). */
export function readErrorStatus(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const o = e as { statusCode?: unknown; status?: unknown };
  if (typeof o.statusCode === 'number') return o.statusCode;
  if (typeof o.status === 'number') return o.status;
  return undefined;
}

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  if (typeof e === 'string') return e;
  return '';
}

function withDetail(reason: string, raw: string, extra?: string): ReadErrorDescription {
  const detail = [raw, extra].filter((s) => s && s !== reason && !reason.includes(s)).join('\n');
  return detail ? { reason, detail } : { reason };
}

/** A plain-English reason for a failed read; `detail` keeps the raw text. */
export function describeReadError(e: unknown): ReadErrorDescription {
  const raw = rawMessage(e);
  if (e instanceof PrometheusReadError) return withDetail(e.message, '', e.detail);
  // DOMException is not an Error subclass in every runtime: match on the name.
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === 'TimeoutError') return withDetail('The request timed out', raw);
  // A cancel (the user navigated away, a newer request replaced it) is not a timeout.
  if (name === 'AbortError') return withDetail('The request was cancelled', raw);
  if (HTML_AS_JSON.test(raw)) {
    return withDetail('The server answered with a web page instead of data — the backend may be down or behind a login page', raw);
  }
  if (e instanceof TypeError && NETWORK_MESSAGE.test(raw)) {
    return withDetail('Could not reach the server — check the connection', raw);
  }
  const status = readErrorStatus(e);
  if (status === 401) return withDetail('Your session has expired — sign in again', raw);
  // Keep the server's text in view: Kubernetes says exactly what was forbidden.
  if (status === 403) {
    if (!raw) return { reason: 'You do not have permission to read this' };
    return { reason: /^(Permission denied|You do not have permission)/i.test(raw) ? raw : `Permission denied: ${raw}` };
  }
  if (status === 404) return withDetail('Not found — it may have been deleted', raw);
  if (status !== undefined && status >= 500) return withDetail(`The server returned an error (status ${status})`, raw);
  return { reason: raw };
}

/**
 * True when a failed read means "there is no such thing" (404, or 410 Gone),
 * so the page should say what was not found and offer a way out. Every other
 * failure (403, 500, network, timeout) is not an answer about existence and
 * stays a LoadError with Retry.
 */
export function isNotFoundError(e: unknown): boolean {
  const status = readErrorStatus(e);
  return status === 404 || status === 410;
}
