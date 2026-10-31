/**
 * Logs for the "All containers" / "All pods" merged views.
 *
 * Each source is fetched from the cluster the screen shows, with
 * impersonation, and its failure is reported against that source. The old
 * merged views used a bare fetch() and turned a 403 or 500 into "no lines",
 * so a pod the user could not read looked like a pod that logged nothing.
 */
import { k8sFetch } from '../../engine/query';
import { pickDefaultContainer } from './pickDefaultContainer';

export interface LogSourceResult {
  lines: string[];
  /** Why this source has no lines, when it failed. */
  error?: string;
}

async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.clone().json();
    if (body && typeof body.message === 'string') detail = body.message;
  } catch {
    try { detail = (await res.text()).trim().slice(0, 200); } catch { /* no body */ }
  }
  const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  return detail ? `${status}: ${detail}` : status;
}

export async function fetchSourceLogs(
  clusterId: string,
  namespace: string,
  podName: string,
  params: URLSearchParams,
  opts: { autoDetectContainer?: boolean; signal?: AbortSignal } = {},
): Promise<LogSourceResult> {
  const logPath = (p: URLSearchParams) => `/api/v1/namespaces/${namespace}/pods/${podName}/log?${p}`;
  try {
    let res = await k8sFetch(clusterId, logPath(params), { signal: opts.signal });
    // 400 = multi-container pod without a container param: pick the main one.
    if (res.status === 400 && opts.autoDetectContainer && !params.has('container')) {
      const podRes = await k8sFetch(clusterId, `/api/v1/namespaces/${namespace}/pods/${podName}`, { signal: opts.signal });
      if (!podRes.ok) return { lines: [], error: `could not read the pod to choose a container (${await describeFailure(podRes)})` };
      const podData = await podRes.json();
      const names = (podData?.spec?.containers ?? []).map((c: { name?: string }) => c.name);
      const container = pickDefaultContainer(names);
      if (container) {
        const withContainer = new URLSearchParams(params);
        withContainer.set('container', container);
        res = await k8sFetch(clusterId, logPath(withContainer), { signal: opts.signal });
      }
    }
    if (!res.ok) return { lines: [], error: await describeFailure(res) };
    const text = await res.text();
    return { lines: text.split('\n').filter((l) => l.trim()) };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return { lines: [], error: err instanceof Error ? err.message : String(err) };
  }
}
