/**
 * Memory quota left in a namespace after a fix raises requests/limits.
 *
 * A raised limit can be refused at pod creation by a ResourceQuota, which
 * would leave the rollout stuck with the old pods. The answer is "unknown"
 * when the quotas could not be read — never "has room".
 */
import type { K8sResource } from './renderers';
import type { ReadResult } from './readResult';
import { parseMem } from './formatting';

export interface Headroom {
  text: string;
  tone: 'ok' | 'over' | 'unknown' | 'none';
}

const Gi = 1024 ** 3;
const Mi = 1024 ** 2;
function fmt(bytes: number): string {
  const v = Math.abs(bytes);
  const s = v >= Gi ? `${(v / Gi).toFixed(1)}Gi` : `${Math.round(v / Mi)}Mi`;
  return bytes < 0 ? `-${s}` : s;
}

export function quotaHeadroom(
  quotas: ReadResult<K8sResource[]> | undefined,
  delta: { requests: number; limits: number; replicas: number },
): Headroom {
  if (!quotas) return { text: 'Quota headroom: checking…', tone: 'unknown' };
  if (quotas.state === 'error') return { text: `Quota headroom unknown: ResourceQuotas could not be read (${quotas.reason})`, tone: 'unknown' };
  const items = quotas.state === 'ok' ? quotas.data : [];
  const rows: Array<{ quota: string; key: string; hard: number; left: number }> = [];
  for (const q of items) {
    const st = (q.status || {}) as { hard?: Record<string, string>; used?: Record<string, string> };
    for (const key of ['requests.memory', 'memory', 'limits.memory']) {
      const hard = st.hard?.[key];
      if (!hard) continue;
      const add = (key === 'limits.memory' ? delta.limits : delta.requests) * delta.replicas;
      rows.push({ quota: q.metadata.name, key, hard: parseMem(hard), left: parseMem(hard) - parseMem(st.used?.[key] ?? '0') - add });
    }
  }
  if (rows.length === 0) return { text: 'No ResourceQuota limits memory in this namespace.', tone: 'none' };
  const tightest = rows.reduce((a, b) => (b.left < a.left ? b : a));
  const what = tightest.key === 'limits.memory' ? 'memory limits' : 'memory requests';
  if (tightest.left < 0) {
    return { text: `Over quota: ${tightest.quota} allows ${fmt(tightest.hard)} of ${what}; this change needs ${fmt(-tightest.left)} more, so new pods would be refused.`, tone: 'over' };
  }
  return { text: `Namespace quota has room: ${fmt(tightest.left)} of ${fmt(tightest.hard)} ${what} left after this change (${tightest.quota}).`, tone: 'ok' };
}
