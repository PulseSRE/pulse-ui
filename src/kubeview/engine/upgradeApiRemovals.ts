/**
 * Removed-API go/no-go before a cluster update.
 *
 * Answers "if I update to the next minor, will anything still calling an API
 * that the target Kubernetes removes break, and is the update gated on an
 * administrator acknowledgement?" from real OpenShift objects:
 *
 * - `apiserver.openshift.io/v1` APIRequestCount (`status.removedInRelease`,
 *   `status.requestCount` over the last 24h, callers per node and user);
 * - ClusterVersion (current version, available and conditional updates);
 * - ConfigMap `openshift-config-managed/admin-gates` (gate key → description)
 *   and `openshift-config/admin-acks` (gate key → "true" once acknowledged).
 *
 * A read that failed (403/500/network) is "could not check", never "go". A 404
 * on APIRequestCount means the API does not exist here (not OpenShift), which
 * is unknown as well. Pure: no fetching, so every case is unit-testable.
 */
import type { ClusterVersion, ConfigMap, Condition } from './types';
import type { ReadResult } from './readResult';

export interface APIRequestCountUser {
  username?: string;
  userAgent?: string;
  requestCount?: number;
  byVerb?: Array<{ verb?: string; requestCount?: number }>;
}

export interface APIRequestCountNode {
  nodeName?: string;
  requestCount?: number;
  byUser?: APIRequestCountUser[];
}

export interface APIRequestCount {
  apiVersion?: string;
  kind?: string;
  metadata: { name: string; [key: string]: unknown };
  status?: {
    removedInRelease?: string;
    requestCount?: number;
    currentHour?: { requestCount?: number; byNode?: APIRequestCountNode[] };
    last24h?: Array<{ requestCount?: number; byNode?: APIRequestCountNode[] }>;
  };
}

export const API_REQUEST_COUNTS_PATH = '/apis/apiserver.openshift.io/v1/apirequestcounts';
export const ADMIN_GATES_PATH = '/api/v1/namespaces/openshift-config-managed/configmaps/admin-gates';
export const ADMIN_ACKS_PATH = '/api/v1/namespaces/openshift-config/configmaps/admin-acks';

export interface ApiCaller {
  username: string;
  userAgent: string;
  requestCount: number;
  /** `system:` users: usually cluster components that are updated with the cluster. */
  platform: boolean;
}

export interface RemovedApi {
  /** APIRequestCount name, `<resource>.<version>.<group>` (core: `<resource>.<version>`). */
  name: string;
  resource: string;
  version: string;
  /** "" for the core group. */
  group: string;
  removedInRelease: string;
  /** Requests in the last 24h. */
  requestCount: number;
  /** Non-platform callers first, then by request count. Platform callers are flagged, never dropped. */
  callers: ApiCaller[];
}

export interface AdminGate {
  key: string;
  description: string;
  /** null when admin-acks could not be read. */
  acknowledged: boolean | null;
}

export interface UpgradeTargetMinor {
  /** OpenShift minor, e.g. "4.19". */
  ocp: string;
  /** Kubernetes minor it ships, e.g. "1.32". */
  kube: string;
}

export type RemovalStatus = 'go' | 'no_go' | 'unknown';

export interface ApiRemovalVerdict {
  status: RemovalStatus;
  /** Plain-English reason for the status. */
  reason: string;
  current: string | null;
  target: UpgradeTargetMinor | null;
  /** Removed in the target (or earlier) and called in the last 24h. */
  inUse: RemovedApi[];
  /** Removed in the target (or earlier) with no requests in the last 24h. */
  unused: RemovedApi[];
  /** Admin gates that apply to updating from the current minor to the target. */
  gates: AdminGate[];
  /** What could not be read (empty when every read succeeded). */
  failures: string[];
  /** ClusterVersion Upgradeable=False: CVO refuses minor updates until it clears. */
  upgradeableBlocker: { reason: string; message: string; adminAck: boolean } | null;
  /** The target is current+1 but no update to that minor is offered on the channel yet. */
  targetNotOffered: boolean;
}

export interface ApiRemovalInputs {
  clusterVersion: ClusterVersion | null | undefined;
  apiRequestCounts: ReadResult<APIRequestCount[]>;
  adminGates: ReadResult<ConfigMap>;
  adminAcks: ReadResult<ConfigMap>;
  /** A target version or minor ("4.19" or "4.19.3"); defaults to `defaultTargetMinor` (lowest offered newer minor, else current + 1). */
  targetVersion?: string;
  /**
   * The cluster's running Kubernetes version (`/version` gitVersion, e.g.
   * "v1.33.4"). The target's Kubernetes minor is derived from it; without it
   * only the OpenShift 4.N → 1.(N+13) table is known. null = could not be read.
   */
  currentKubeVersion?: string | null;
}

type Minor = { major: number; minor: number };

export function parseMinor(version: string | undefined | null): Minor | null {
  const m = /^v?(\d+)\.(\d+)/.exec((version ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

const fmt = (m: Minor) => `${m.major}.${m.minor}`;

/** OpenShift 4.N ships Kubernetes 1.(N+13): 4.16→1.29, 4.19→1.32. Fallback only: unknown for any other major. */
export function kubeMinorForOcp(ocp: string): string | null {
  const m = parseMinor(ocp);
  if (!m || m.major !== 4) return null;
  return `1.${m.minor + 13}`;
}

/**
 * The Kubernetes minor a target OpenShift minor ships, from the cluster's own
 * running Kubernetes version: each OpenShift minor within a major moves
 * Kubernetes one minor, so target kube = running kube + (target OCP minor −
 * running OCP minor). This works for any OpenShift major (5.x included); the
 * 4.N table is used only when the running Kubernetes version is not known, and
 * nothing is guessed across an OpenShift major.
 */
export function targetKubeMinor(currentOcp: string, targetOcp: string, currentKube?: string | null): { current: string | null; target: string | null } {
  const cur = parseMinor(currentOcp);
  const tgt = parseMinor(targetOcp);
  const kube = parseMinor(currentKube);
  if (cur && tgt && kube && tgt.major === cur.major) {
    return { current: fmt(kube), target: fmt({ major: kube.major, minor: kube.minor + (tgt.minor - cur.minor) }) };
  }
  return { current: kubeMinorForOcp(currentOcp), target: kubeMinorForOcp(targetOcp) };
}

/** The installed version: the latest completed history entry, else the desired version. */
export function currentClusterVersion(cv: ClusterVersion | null | undefined): string | null {
  const completed = cv?.status?.history?.find((h) => h.state === 'Completed')?.version;
  return completed || cv?.status?.desired?.version || null;
}

/** Newer minors that the channel offers, from available and conditional updates. Ascending. */
export function offeredMinors(cv: ClusterVersion | null | undefined): string[] {
  const cur = parseMinor(currentClusterVersion(cv));
  if (!cur) return [];
  const minors = new Set<string>();
  const versions = [
    ...(cv?.status?.availableUpdates ?? []).map((u) => u.version),
    ...(cv?.status?.conditionalUpdates ?? []).map((u) => u.release?.version),
  ];
  for (const v of versions) {
    const m = parseMinor(v);
    if (m && m.major === cur.major && m.minor > cur.minor) minors.add(fmt(m));
  }
  return [...minors].sort((a, b) => (parseMinor(a)!.minor - parseMinor(b)!.minor));
}

/**
 * Minors a removal check can be run for: the next minor after current (even
 * when the channel does not offer it yet, which is normal on stable-4.N), plus
 * any newer minor listed in available or conditional updates. Ascending.
 */
export function targetMinorOptions(cv: ClusterVersion | null | undefined): string[] {
  const cur = parseMinor(currentClusterVersion(cv));
  if (!cur) return [];
  const minors = new Set<string>([fmt({ major: cur.major, minor: cur.minor + 1 }), ...offeredMinors(cv)]);
  return [...minors].sort((a, b) => (parseMinor(a)!.minor - parseMinor(b)!.minor));
}

/**
 * The target checked when none is picked: the lowest newer minor the channel
 * offers, else current + 1 (on stable-4.N only z-streams are offered until the
 * channel is switched, which is exactly when this check matters).
 */
export function defaultTargetMinor(cv: ClusterVersion | null | undefined): string | null {
  const cur = parseMinor(currentClusterVersion(cv));
  if (!cur) return null;
  return offeredMinors(cv)[0] ?? fmt({ major: cur.major, minor: cur.minor + 1 });
}

/** "next minor (not yet offered on your channel)" when the minor is current+1 and not offered. */
export function targetMinorLabel(cv: ClusterVersion | null | undefined, minor: string): string {
  return offeredMinors(cv).includes(minor) ? minor : `${minor} \u2014 next minor (not yet offered on your channel)`;
}

/** ClusterVersion Upgradeable=False, which makes CVO refuse a minor update. */
export function upgradeableBlockerOf(cv: ClusterVersion | null | undefined): ApiRemovalVerdict['upgradeableBlocker'] {
  const c = ((cv?.status?.conditions ?? []) as Condition[]).find((x) => x.type === 'Upgradeable');
  if (!c || c.status !== 'False') return null;
  const reason = c.reason || 'Unknown';
  return { reason, message: c.message || '', adminAck: reason === 'AdminAckRequired' };
}

export function parseApiRequestCountName(name: string): { resource: string; version: string; group: string } {
  const [resource = name, version = '', ...rest] = name.split('.');
  return { resource, version, group: rest.join('.') };
}

function aggregateCallers(arc: APIRequestCount): ApiCaller[] {
  // last24h holds the hourly buckets (including the current hour); fall back to
  // currentHour only when last24h is absent, so nothing is counted twice.
  const buckets = arc.status?.last24h?.length ? arc.status.last24h : arc.status?.currentHour ? [arc.status.currentHour] : [];
  const byCaller = new Map<string, ApiCaller>();
  for (const bucket of buckets) {
    for (const node of bucket.byNode ?? []) {
      for (const user of node.byUser ?? []) {
        const username = user.username || '(unknown user)';
        const userAgent = user.userAgent || '';
        const key = `${username}\u0000${userAgent}`;
        const entry = byCaller.get(key) ?? { username, userAgent, requestCount: 0, platform: username.startsWith('system:') };
        entry.requestCount += user.requestCount ?? 0;
        byCaller.set(key, entry);
      }
    }
  }
  return [...byCaller.values()]
    .filter((c) => c.requestCount > 0)
    .sort((a, b) => Number(a.platform) - Number(b.platform) || b.requestCount - a.requestCount || a.username.localeCompare(b.username));
}

/**
 * APIs removed after `currentKube` and no later than `targetKube`, split by
 * whether they were called in the last 24h. An API removed in the running
 * release or earlier is already gone and is not this update's problem.
 */
export function classifyRemovedApis(counts: APIRequestCount[], targetKube: string, currentKube?: string | null): { inUse: RemovedApi[]; unused: RemovedApi[] } {
  const target = parseMinor(targetKube);
  const current = parseMinor(currentKube);
  const inUse: RemovedApi[] = [];
  const unused: RemovedApi[] = [];
  if (!target) return { inUse, unused };
  for (const arc of counts) {
    const removed = parseMinor(arc.status?.removedInRelease);
    if (!removed) continue;
    if (removed.major > target.major || (removed.major === target.major && removed.minor > target.minor)) continue;
    if (current && (removed.major < current.major || (removed.major === current.major && removed.minor <= current.minor))) continue;
    const callers = aggregateCallers(arc);
    const requestCount = arc.status?.requestCount ?? callers.reduce((n, c) => n + c.requestCount, 0);
    const api: RemovedApi = {
      name: arc.metadata.name,
      ...parseApiRequestCountName(arc.metadata.name),
      removedInRelease: arc.status!.removedInRelease!,
      requestCount,
      callers,
    };
    (requestCount > 0 ? inUse : unused).push(api);
  }
  inUse.sort((a, b) => b.requestCount - a.requestCount || a.name.localeCompare(b.name));
  unused.sort((a, b) => a.name.localeCompare(b.name));
  return { inUse, unused };
}

/**
 * Gates that apply to an update from `current` to `target`. A gate key starts
 * `ack-<ocp minor>-` naming the minor it is evaluated on and usually ends
 * `-in-<ocp minor>` naming the release it protects (e.g.
 * `ack-4.18-kube-1.32-api-removals-in-4.19`). A gate applies when its prefix
 * is the current minor or one crossed on the way, or its `-in-` suffix is a
 * minor crossed up to the target. A key matching neither pattern is kept in
 * scope (conservative): an unrecognised gate is never dropped.
 */
export function applicableGates(gates: ConfigMap | null, acks: ConfigMap | null | 'unknown', current: string, target: string): AdminGate[] {
  const cur = parseMinor(current);
  const tgt = parseMinor(target);
  if (!cur || !tgt) return [];
  const out: AdminGate[] = [];
  for (const [key, description] of Object.entries(gates?.data ?? {})) {
    const from = parseMinor(/^ack-(\d+\.\d+)-/.exec(key)?.[1]);
    const into = parseMinor(/-in-(\d+\.\d+)$/.exec(key)?.[1]);
    const fromMatches = !!from && from.major === cur.major && from.minor >= cur.minor && from.minor < tgt.minor;
    const intoMatches = !!into && into.major === cur.major && into.minor > cur.minor && into.minor <= tgt.minor;
    const recognised = !!from || !!into;
    if (recognised && !fromMatches && !intoMatches) continue;
    out.push({ key, description, acknowledged: acks === 'unknown' ? null : acks?.data?.[key] === 'true' });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function computeApiRemovalVerdict(inputs: ApiRemovalInputs): ApiRemovalVerdict {
  const { clusterVersion, apiRequestCounts, adminGates, adminAcks, targetVersion, currentKubeVersion } = inputs;
  const current = currentClusterVersion(clusterVersion);
  const upgradeableBlocker = upgradeableBlockerOf(clusterVersion);
  const base: ApiRemovalVerdict = { status: 'unknown', reason: '', current, target: null, inUse: [], unused: [], gates: [], failures: [], upgradeableBlocker, targetNotOffered: false };

  if (!clusterVersion) return { ...base, reason: 'Could not check: the ClusterVersion could not be read, so the current version and target are unknown.' };
  const cur = parseMinor(current);
  if (!cur) return { ...base, reason: 'Could not check: the current cluster version is unknown.' };

  const targetMinor = parseMinor(targetVersion ?? defaultTargetMinor(clusterVersion));
  if (!targetMinor || targetMinor.major !== cur.major || targetMinor.minor <= cur.minor) {
    return { ...base, reason: `Could not check: ${targetVersion ?? 'the target'} is not a newer minor than ${fmt(cur)}.` };
  }
  const ocp = fmt(targetMinor);
  const kubes = targetKubeMinor(fmt(cur), ocp, currentKubeVersion);
  const kube = kubes.target;
  if (!kube) {
    return { ...base, reason: currentKubeVersion === null
      ? `Could not check: the cluster's Kubernetes version could not be read (/version), so the Kubernetes version shipped with ${ocp} is not known.`
      : `Could not check: the Kubernetes version shipped with ${ocp} is not known.` };
  }
  const target = { ocp, kube };
  const targetNotOffered = !offeredMinors(clusterVersion).includes(ocp);

  const failures: string[] = [];
  let inUse: RemovedApi[] = [];
  let unused: RemovedApi[] = [];
  if (apiRequestCounts.state === 'ok') {
    ({ inUse, unused } = classifyRemovedApis(apiRequestCounts.data, kube, kubes.current));
  } else if (apiRequestCounts.state === 'absent') {
    failures.push('APIRequestCount is not available on this cluster (it is an OpenShift API), so API usage could not be checked');
  } else {
    failures.push(`APIRequestCounts could not be read (${apiRequestCounts.reason})`);
  }

  // admin-gates always exists on OpenShift, so a 404 is not "no gates": it is unknown.
  // A missing admin-acks ConfigMap does mean nothing has been acknowledged.
  if (adminGates.state === 'error') failures.push(`the admin-gates ConfigMap could not be read (${adminGates.reason})`);
  if (adminGates.state === 'absent') failures.push('the admin-gates ConfigMap (openshift-config-managed/admin-gates) was not found');
  if (adminAcks.state === 'error') failures.push(`the admin-acks ConfigMap could not be read (${adminAcks.reason})`);
  const gates = adminGates.state !== 'ok'
    ? []
    : applicableGates(adminGates.data, adminAcks.state === 'ok' ? adminAcks.data : adminAcks.state === 'error' ? 'unknown' : null, fmt(cur), ocp);
  const pendingGates = gates.filter((g) => g.acknowledged === false);

  const result = { ...base, target, targetNotOffered, inUse, unused, gates, failures };
  const blockers: string[] = [];
  // CVO itself refuses a minor update while Upgradeable=False, whatever else could be read.
  if (upgradeableBlocker) {
    blockers.push(upgradeableBlocker.adminAck
      ? `the cluster requires an administrator acknowledgement (Upgradeable=False, AdminAckRequired)${upgradeableBlocker.message ? `: ${upgradeableBlocker.message.replace(/\.\s*$/, '')}` : ''}`
      : `the cluster reports Upgradeable=False (${upgradeableBlocker.reason})${upgradeableBlocker.message ? `: ${upgradeableBlocker.message.replace(/\.\s*$/, '')}` : ''}, so minor updates are refused`);
  }
  if (inUse.length) {
    const requests = inUse.reduce((n, a) => n + a.requestCount, 0);
    blockers.push(`${plural(inUse.length, 'API')} removed in Kubernetes ${kube} ${inUse.length === 1 ? 'was' : 'were'} called ${plural(requests, 'time')} in the last 24h`);
  }
  if (pendingGates.length) blockers.push(`${plural(pendingGates.length, 'admin acknowledgement')} for ${ocp} ${pendingGates.length === 1 ? 'is' : 'are'} not given`);

  // A proven blocker stays no_go even when another read failed: nothing that
  // read could have returned would turn it into a go.
  if (blockers.length) {
    const unread = failures.length ? ` Also could not check: ${failures.join('; ')}.` : '';
    return { ...result, status: 'no_go', reason: `${capitalize(blockers.join('; '))}.${unread}` };
  }
  if (failures.length) {
    return { ...result, status: 'unknown', reason: `Could not check: ${failures.join('; ')}. Nothing found so far blocks the update.` };
  }
  // Each intermediate release can publish its own admin gates once the cluster reaches it.
  const intermediateNote = targetMinor.minor > cur.minor + 1
    ? ` Only the admin gates published so far (for the step out of ${fmt(cur)}) are covered; each intermediate release can publish its own when the cluster reaches it.`
    : '';
  const gateNote = gates.length ? ` and ${plural(gates.length, 'admin gate')} for ${ocp} ${gates.length === 1 ? 'is' : 'are'} acknowledged` : ' and no admin acknowledgement is required';
  return {
    ...result,
    status: 'go',
    reason: `No API removed in Kubernetes ${kube} (OpenShift ${ocp}) was called in the last 24h${gateNote}. Callers that run less often than daily (weekly jobs, quarterly tools) will not appear in this window.${intermediateNote}`,
  };
}
