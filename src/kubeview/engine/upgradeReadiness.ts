/**
 * Update readiness: one verdict for "can this cluster take the update now",
 * built from checks that each say Blocker, Unknown or Passed.
 *
 * The rules are the honesty rules every other admin page follows: a read
 * that failed or has not answered is Unknown (with the reason), never a pass;
 * a check that was not run says so. A blocker does not stop the update (that
 * is the admin's call), it says what is likely to go wrong.
 *
 * Every function here is pure. The reads come in as `Loadable` values so a
 * caller cannot hand over "[]" for "could not read".
 */

import type { ClusterOperator, ClusterVersion, Condition, ConfigMap, MachineConfigPool, Node, Pod } from './types';
import { isNotFound, errorReason, type ReadResult } from './readResult';
import { getBlockingPdbs, type BlockingPdb, type PdbLike } from './upgradeHealth';
import { parseCertExpiry, type TlsSecretLike } from './certExpiry';
import { isPending, type CertificateSigningRequest } from './csr';
import { upgradeableBlockerOf, type APIRequestCount, type ApiRemovalVerdict, type RemovedApi } from './upgradeApiRemovals';
import { formatDurationMs } from './format';

export type Loadable<T> = ReadResult<T> | { state: 'loading' };

/** A react-query result as a Loadable: an error is never "no items", a 404 is "absent". */
export function toLoadable<T>(data: T | undefined, error: unknown, loading: boolean): Loadable<T> {
  if (error) return isNotFound(error) ? { state: 'absent' } : { state: 'error', reason: errorReason(error) };
  if (loading || data === undefined) return { state: 'loading' };
  return { state: 'ok', data };
}

export type ReadinessStatus = 'blocker' | 'unknown' | 'checking' | 'passed';

export type ReadinessCheckId =
  | 'removed-apis' | 'admin-ack' | 'upgradeable' | 'pdbs' | 'alerts' | 'csrs'
  | 'cp-certs' | 'etcd-health' | 'etcd-backup' | 'nodes' | 'operators' | 'channel';

export interface ReadinessCheck {
  id: ReadinessCheckId;
  label: string;
  status: ReadinessStatus;
  /** What was found, in a sentence. */
  detail: string;
  /** A few words for the collapsed "N more checks passed" line. */
  summary?: string;
  /** PDBs that will block a drain (the `pdbs` check). */
  blockingPdbs?: BlockingPdb[];
}

export interface ReadinessVerdict {
  state: 'ready' | 'not_ready' | 'unknown' | 'checking';
  blockers: number;
  unknown: number;
  checking: number;
  passed: number;
}

const unread = <T>(id: ReadinessCheckId, label: string, r: Loadable<T>, what: string): ReadinessCheck | null => {
  if (r.state === 'loading') return { id, label, status: 'checking', detail: 'Checking…' };
  if (r.state === 'error') return { id, label, status: 'unknown', detail: `Could not check: ${r.reason}` };
  if (r.state === 'absent') return { id, label, status: 'unknown', detail: `Could not check: ${what} is not served by this cluster` };
  return null;
};

const cond = (conds: Condition[] | undefined, type: string) => (conds || []).find((c) => c.type === type);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Nodes, operators, channel
// ---------------------------------------------------------------------------

export function checkNodes(nodes: Loadable<Node[]>): ReadinessCheck {
  const label = 'Nodes ready';
  const u = unread('nodes', label, nodes, 'the Node API');
  if (u || nodes.state !== 'ok') return u!;
  const all = nodes.data;
  if (all.length === 0) return { id: 'nodes', label, status: 'unknown', detail: 'Could not check: no nodes were returned' };
  const notReady = all.filter((n) => cond(n.status?.conditions, 'Ready')?.status !== 'True');
  const ready = all.length - notReady.length;
  if (notReady.length === 0) return { id: 'nodes', label, status: 'passed', detail: `${ready}/${all.length} nodes are Ready`, summary: `nodes ready ${ready}/${all.length}` };
  return {
    id: 'nodes', label, status: 'blocker',
    detail: `${ready}/${all.length} nodes are Ready. Not ready: ${notReady.slice(0, 3).map((n) => n.metadata.name).join(', ')}${notReady.length > 3 ? ` and ${notReady.length - 3} more` : ''}. A node that is not Ready can stall its pool's rollout.`,
  };
}

export function checkOperators(operators: Loadable<ClusterOperator[]>): ReadinessCheck {
  const label = 'Platform operators healthy';
  const u = unread('operators', label, operators, 'the ClusterOperator API');
  if (u || operators.state !== 'ok') return u!;
  const all = operators.data;
  if (all.length === 0) return { id: 'operators', label, status: 'unknown', detail: 'Could not check: no ClusterOperators were returned' };
  const unhealthy = all.flatMap((o) => {
    const c = o.status?.conditions;
    if (cond(c, 'Degraded')?.status === 'True') return [`${o.metadata.name} (Degraded)`];
    if (cond(c, 'Available')?.status !== 'True') return [`${o.metadata.name} (not Available)`];
    return [];
  });
  const healthy = all.length - unhealthy.length;
  if (unhealthy.length === 0) return { id: 'operators', label, status: 'passed', detail: `${healthy}/${all.length} platform operators are Available and not Degraded`, summary: `platform operators ${healthy}/${all.length} healthy` };
  return {
    id: 'operators', label, status: 'blocker',
    detail: `${healthy}/${all.length} platform operators healthy. ${unhealthy.slice(0, 3).join(', ')}${unhealthy.length > 3 ? ` and ${unhealthy.length - 3} more` : ''}. The update waits on every operator, so an unhealthy one is likely to stall it.`,
  };
}

export function checkChannel(clusterVersion: ClusterVersion | null | undefined, loading = false): ReadinessCheck {
  const label = 'Update channel';
  if (!clusterVersion && loading) return { id: 'channel', label, status: 'checking', detail: 'Checking\u2026' };
  if (!clusterVersion) return { id: 'channel', label, status: 'unknown', detail: 'Could not check: the ClusterVersion could not be read' };
  const channel = clusterVersion.spec?.channel || '';
  if (!channel) return { id: 'channel', label, status: 'blocker', detail: 'No update channel is set, so the cluster is offered no updates' };
  if (channel.startsWith('candidate-')) {
    return { id: 'channel', label, status: 'blocker', detail: `Channel ${channel}: candidate releases are not supported for production clusters` };
  }
  return { id: 'channel', label, status: 'passed', detail: `Channel ${channel}`, summary: `channel ${channel}` };
}

// ---------------------------------------------------------------------------
// Alerts, CSRs, certificates
// ---------------------------------------------------------------------------

export interface FiringAlert { labels: Record<string, string>; annotations?: Record<string, string>; state: string }

export function checkCriticalAlerts(alerts: Loadable<FiringAlert[]>): ReadinessCheck {
  const label = 'Critical alerts';
  const u = unread('alerts', label, alerts, 'Alertmanager');
  if (u || alerts.state !== 'ok') return u!;
  const critical = alerts.data.filter((a) => a.state === 'firing' && a.labels?.severity === 'critical');
  if (critical.length === 0) return { id: 'alerts', label, status: 'passed', detail: 'No critical alert is firing', summary: 'no critical alerts firing' };
  const names = [...new Set(critical.map((a) => a.labels.alertname || 'unnamed'))];
  return {
    id: 'alerts', label, status: 'blocker',
    // Read from Prometheus, which does not know about Alertmanager silences.
    detail: `${plural(critical.length, 'critical alert')} firing: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}. Silenced alerts are counted too.`,
  };
}

export function checkPendingCsrs(csrs: Loadable<CertificateSigningRequest[]>): ReadinessCheck {
  const label = 'Certificate requests';
  const u = unread('csrs', label, csrs, 'the CertificateSigningRequest API');
  if (u || csrs.state !== 'ok') return u!;
  const pending = csrs.data.filter(isPending);
  if (pending.length === 0) return { id: 'csrs', label, status: 'passed', detail: 'No certificate signing request is waiting for approval', summary: 'no pending certificate requests' };
  return {
    id: 'csrs', label, status: 'blocker',
    detail: `${plural(pending.length, 'certificate signing request')} ${pending.length === 1 ? 'is' : 'are'} pending approval. Nodes that reboot during the update can wait on them before they rejoin or serve logs.`,
  };
}

/** Namespaces whose TLS secrets are the control plane's own certificates. */
export const CONTROL_PLANE_CERT_NAMESPACES = [
  'openshift-kube-apiserver',
  'openshift-kube-apiserver-operator',
  'openshift-kube-controller-manager',
  'openshift-kube-scheduler',
  'openshift-etcd',
] as const;

export function checkControlPlaneCerts(secrets: Loadable<TlsSecretLike[]>, hosted: boolean): ReadinessCheck {
  const label = 'Control-plane certificates';
  if (hosted) return { id: 'cp-certs', label, status: 'passed', detail: 'The control plane is managed by the hosting provider', summary: 'control-plane certificates managed by the hosting provider' };
  const u = unread('cp-certs', label, secrets, 'the Secret API');
  if (u || secrets.state !== 'ok') return u!;
  const infos = secrets.data.map(parseCertExpiry);
  const known = infos.filter((i) => i.daysUntilExpiry !== null).sort((a, b) => a.daysUntilExpiry! - b.daysUntilExpiry!);
  const unparsed = infos.length - known.length;
  if (infos.length === 0) return { id: 'cp-certs', label, status: 'unknown', detail: 'Could not check: no TLS secrets were returned from the control-plane namespaces' };
  if (known.length === 0) return { id: 'cp-certs', label, status: 'unknown', detail: `Could not check: none of the ${infos.length} control-plane certificates could be parsed` };
  const first = known[0];
  const days = first.daysUntilExpiry!;
  const where = `${first.namespace}/${first.name}`;
  const unparsedNote = unparsed ? ` (${plural(unparsed, 'certificate')} could not be parsed and ${unparsed === 1 ? 'is' : 'are'} not counted)` : '';
  if (days < 0) return { id: 'cp-certs', label, status: 'blocker', detail: `${where} expired ${Math.abs(days)} days ago${unparsedNote}` };
  if (days < 1) return { id: 'cp-certs', label, status: 'blocker', detail: `${where} expires within a day; the platform normally rotates it well before that, so rotation may be failing${unparsedNote}` };
  return {
    id: 'cp-certs', label, status: 'passed',
    detail: `Earliest expiry: ${where} in ${days} days. The platform rotates these automatically${unparsedNote}`,
    summary: `control-plane certificates valid for ${days} days`,
  };
}

// ---------------------------------------------------------------------------
// etcd
// ---------------------------------------------------------------------------

export function checkEtcdHealth(operators: Loadable<ClusterOperator[]>, etcdPods: Loadable<Pod[]>, hosted: boolean): ReadinessCheck {
  const label = 'etcd members';
  if (hosted) return { id: 'etcd-health', label, status: 'passed', detail: 'etcd is managed by the hosting provider', summary: 'etcd managed by the hosting provider' };
  const u = unread('etcd-health', label, operators, 'the ClusterOperator API');
  if (u || operators.state !== 'ok') return u!;
  const co = operators.data.find((o) => o.metadata.name === 'etcd');
  if (!co) return { id: 'etcd-health', label, status: 'unknown', detail: 'Could not check: there is no etcd ClusterOperator' };
  const degraded = cond(co.status?.conditions, 'Degraded');
  const available = cond(co.status?.conditions, 'Available');
  if (degraded?.status === 'True') return { id: 'etcd-health', label, status: 'blocker', detail: `The etcd operator is Degraded${degraded.message ? `: ${degraded.message}` : ''}` };
  if (available?.status !== 'True') return { id: 'etcd-health', label, status: 'blocker', detail: `The etcd operator is not Available${available?.message ? `: ${available.message}` : ''}` };
  if (etcdPods.state === 'loading') return { id: 'etcd-health', label, status: 'checking', detail: 'Checking…' };
  if (etcdPods.state !== 'ok') {
    const why = etcdPods.state === 'error' ? etcdPods.reason : 'the pod list was not found';
    return { id: 'etcd-health', label, status: 'unknown', detail: `The etcd operator is Available and not Degraded, but the etcd pods could not be read (${why}), so member health is unknown` };
  }
  const members = etcdPods.data;
  if (members.length === 0) return { id: 'etcd-health', label, status: 'unknown', detail: 'Could not check: no etcd member pods (app=etcd) were found in openshift-etcd' };
  const ready = members.filter((p) => cond(p.status?.conditions as Condition[] | undefined, 'Ready')?.status === 'True').length;
  const total = members.length;
  if (ready <= total / 2) return { id: 'etcd-health', label, status: 'blocker', detail: `Only ${ready}/${total} etcd member pods are ready: quorum is at risk` };
  if (ready < total) return { id: 'etcd-health', label, status: 'blocker', detail: `${ready}/${total} etcd member pods are ready. The update restarts members one at a time, so with one already down it can lose quorum` };
  return { id: 'etcd-health', label, status: 'passed', detail: `${ready}/${total} etcd member pods are ready, and the etcd operator is Available and not Degraded`, summary: `etcd ${ready}/${total} members healthy` };
}

/** operator.openshift.io/v1alpha1 EtcdBackup: a one-time backup (also what a periodic Backup schedule creates). */
export interface EtcdBackupLike {
  metadata: { name: string; creationTimestamp?: string };
  spec?: { pvcName?: string };
  status?: { conditions?: Condition[]; backupJob?: { namespace?: string; name?: string } };
}

/** config.openshift.io/v1alpha1 Backup: the periodic schedule. */
export interface BackupScheduleLike {
  metadata: { name: string };
  spec?: { etcd?: { schedule?: string; pvcName?: string } };
}

export const ETCD_BACKUPS_PATH = '/apis/operator.openshift.io/v1alpha1/etcdbackups';
export const BACKUP_SCHEDULES_PATH = '/apis/config.openshift.io/v1alpha1/backups';
export const BACKUP_FRESH_HOURS = 24;

const condTrue = (b: EtcdBackupLike, name: string) => (b.status?.conditions || []).find((c) => (c.type === name || c.reason === name) && c.status === 'True');

export function etcdBackupOutcome(b: EtcdBackupLike): { state: 'completed' | 'failed' | 'skipped' | 'pending'; at?: string; message?: string } {
  const done = condTrue(b, 'BackupCompleted');
  if (done) return { state: 'completed', at: done.lastTransitionTime || b.metadata.creationTimestamp, message: done.message };
  const failed = condTrue(b, 'BackupFailed');
  if (failed) return { state: 'failed', at: failed.lastTransitionTime, message: failed.message };
  const skipped = condTrue(b, 'BackupSkipped');
  if (skipped) return { state: 'skipped', at: skipped.lastTransitionTime, message: skipped.message };
  return { state: 'pending', at: b.metadata.creationTimestamp };
}

export const NO_BACKUP_API_DETAIL = "No Backup resource (API not enabled); a cluster-backup.sh CronJob can't be detected here. Take a backup on a control-plane node with cluster-backup.sh before updating.";

export function checkEtcdBackup(backups: Loadable<EtcdBackupLike[]>, schedules: Loadable<BackupScheduleLike[]>, hosted: boolean, now = Date.now()): ReadinessCheck {
  const id = 'etcd-backup';
  const label = 'etcd backup';
  if (hosted) return { id, label, status: 'passed', detail: 'etcd backups are managed by the hosting provider', summary: 'etcd backups managed by the hosting provider' };
  if (backups.state === 'loading') return { id, label, status: 'checking', detail: 'Checking…' };
  if (backups.state === 'error') return { id, label, status: 'unknown', detail: `Could not check: ${backups.reason}. Confirm a recent etcd backup exists before updating.` };
  const scheduleNote = schedules.state === 'ok' && schedules.data.length > 0
    ? ` A Backup schedule is configured (${schedules.data.map((s) => `${s.metadata.name}: ${s.spec?.etcd?.schedule || 'platform default'}`).join(', ')}).`
    : '';
  if (backups.state === 'absent') return { id, label, status: 'unknown', detail: NO_BACKUP_API_DETAIL };
  const sorted = [...backups.data].sort((a, b) => (b.metadata.creationTimestamp || '').localeCompare(a.metadata.creationTimestamp || ''));
  if (sorted.length === 0) {
    return { id, label, status: 'unknown', detail: `No EtcdBackup has been recorded; a cluster-backup.sh CronJob can't be detected here.${scheduleNote}` };
  }
  const latest = sorted[0];
  const latestOutcome = etcdBackupOutcome(latest);
  const lastDone = sorted.map((b) => ({ b, o: etcdBackupOutcome(b) })).find((x) => x.o.state === 'completed');
  const age = lastDone?.o.at ? now - new Date(lastDone.o.at).getTime() : null;
  if (latestOutcome.state === 'pending') {
    return { id, label, status: 'unknown', detail: `Backup ${latest.metadata.name} has not finished yet.${lastDone && age !== null ? ` The last completed backup was ${formatDurationMs(age)} ago.` : ''}` };
  }
  if (latestOutcome.state === 'failed') {
    return { id, label, status: 'blocker', detail: `The latest etcd backup (${latest.metadata.name}) failed${latestOutcome.message ? `: ${latestOutcome.message}` : ''}` };
  }
  if (!lastDone || age === null) {
    return { id, label, status: 'unknown', detail: `No EtcdBackup has completed; a cluster-backup.sh CronJob can't be detected here.${scheduleNote}` };
  }
  if (age > BACKUP_FRESH_HOURS * 3600_000) {
    return { id, label, status: 'blocker', detail: `The last completed etcd backup (${lastDone.b.metadata.name}) is ${formatDurationMs(age)} old, so a restore would lose everything since then.${scheduleNote}` };
  }
  return { id, label, status: 'passed', detail: `Backup ${lastDone.b.metadata.name} completed ${formatDurationMs(age)} ago.${scheduleNote}`, summary: `etcd backup ${formatDurationMs(age)} ago` };
}

// ---------------------------------------------------------------------------
// PodDisruptionBudgets
// ---------------------------------------------------------------------------

function matches(selector: Record<string, string> | undefined, labels: Record<string, string>): boolean {
  const entries = Object.entries(selector || {});
  return entries.length > 0 && entries.every(([k, v]) => labels[k] === v);
}

/**
 * Nodes an update will drain now: every node, except one whose every matching
 * MachineConfigPool is paused. A node no pool claims is counted (conservative),
 * and when pools could not be read, every node is.
 */
export function nodesThatWillDrain(nodes: Node[], pools: MachineConfigPool[] | null): string[] {
  return nodes
    .filter((n) => {
      if (!pools) return true;
      const labels = n.metadata.labels || {};
      const mine = pools.filter((p) => matches(p.spec?.nodeSelector?.matchLabels as Record<string, string> | undefined, labels));
      return mine.length === 0 || mine.some((p) => !p.spec?.paused);
    })
    .map((n) => n.metadata.name);
}

export function checkDrainPdbs(pdbs: Loadable<PdbLike[]>, pods: Loadable<Pod[]>, nodes: Loadable<Node[]>, pools: MachineConfigPool[] | null): ReadinessCheck {
  const id = 'pdbs';
  const label = 'PodDisruptionBudgets';
  const reads: Array<[Loadable<unknown>, string]> = [[pdbs, 'PodDisruptionBudgets'], [pods, 'Pods'], [nodes, 'Nodes']];
  const failed = reads.filter(([r]) => r.state === 'error' || r.state === 'absent');
  if (failed.length) {
    return { id, label, status: 'unknown', detail: `Could not check: ${failed.map(([r, what]) => `${what}: ${r.state === 'error' ? r.reason : 'not served'}`).join('; ')}` };
  }
  if (pdbs.state !== 'ok' || pods.state !== 'ok' || nodes.state !== 'ok') {
    return { id, label, status: 'checking', detail: `Checking\u2026 (reading ${reads.filter(([r]) => r.state === 'loading').map(([, what]) => what).join(', ')})` };
  }
  const draining = nodesThatWillDrain(nodes.data, pools).map((name) => ({ name }));
  const blocking = getBlockingPdbs(pdbs.data, pods.data as never, draining);
  const paused = (pools || []).filter((p) => p.spec?.paused).map((p) => p.metadata.name);
  const poolNote = !pools ? ' MachineConfigPools could not be read, so every node is assumed to drain.'
    : paused.length ? ` Nodes in paused pool${paused.length === 1 ? '' : 's'} ${paused.join(', ')} are not counted: their nodes will drain when unpaused.` : '';
  if (blocking.length === 0) {
    return {
      id, label, status: 'passed',
      detail: `No PodDisruptionBudget with 0 disruptions allowed covers a pod on a node that will drain now.${poolNote}`,
      summary: paused.length ? `no PDB blocks a drain now (${paused.join(', ')} paused)` : 'no PDB blocks a node drain',
    };
  }
  const first = blocking[0];
  const pod = first.blockedPods[0];
  const req = first.minAvailable !== undefined
    ? `requires ${first.minAvailable} available${first.currentHealthy !== undefined ? ` (${first.currentHealthy} healthy)` : ''}`
    : first.maxUnavailable !== undefined ? `allows ${first.maxUnavailable} unavailable` : 'allows 0 disruptions';
  return {
    id, label, status: 'blocker', blockingPdbs: blocking,
    detail: `${first.namespace}/${first.name} ${req}, so pod ${pod.name} on ${pod.nodeName} cannot be evicted when its node drains${blocking.length > 1 ? `; ${blocking.length - 1} more PDB${blocking.length > 2 ? 's' : ''} also block` : ''}.${poolNote}`,
  };
}

// ---------------------------------------------------------------------------
// Removed APIs, admin acknowledgement, Upgradeable
// ---------------------------------------------------------------------------

export interface RemovalReads {
  apiRequestCounts: ReadResult<APIRequestCount[]>;
  adminGates: ReadResult<ConfigMap>;
  adminAcks: ReadResult<ConfigMap>;
}

function apiName(api: RemovedApi) {
  return `${api.resource}.${api.version}${api.group ? `.${api.group}` : ''}`;
}

/**
 * `minorTarget` is the version the removal verdict was computed for, or null
 * when the update picked is a z-stream (no API is removed within a minor).
 */
export function checkRemovedApis(reads: RemovalReads | null, verdict: ApiRemovalVerdict | null, minorTarget: string | null, patchTarget?: string): ReadinessCheck {
  const id = 'removed-apis';
  const label = 'Removed APIs in use';
  if (!minorTarget) {
    return { id, label, status: 'passed', detail: `${patchTarget ?? 'This'} is a z-stream update, which removes no API`, summary: 'no API removed in a z-stream update' };
  }
  if (!reads || !verdict) return { id, label, status: 'checking', detail: 'Checking…' };
  if (!verdict.target) return { id, label, status: 'unknown', detail: verdict.reason };
  const arc = reads.apiRequestCounts;
  if (arc.state === 'error') return { id, label, status: 'unknown', detail: `Could not check: APIRequestCounts could not be read (${arc.reason})` };
  if (arc.state === 'absent') return { id, label, status: 'unknown', detail: 'Could not check: APIRequestCount is not available on this cluster' };
  const { inUse, target } = verdict;
  if (inUse.length === 0) {
    return { id, label, status: 'passed', detail: `No API removed in Kubernetes ${target.kube} (OpenShift ${target.ocp}) was called in the last 24h`, summary: 'no removed APIs in use' };
  }
  const api = inUse[0];
  const caller = api.callers[0];
  return {
    id, label, status: 'blocker',
    detail: `${apiName(api)} is removed in Kubernetes ${api.removedInRelease} and was called ${api.requestCount.toLocaleString()} times in 24h${caller ? ` by ${caller.username}` : ''}${inUse.length > 1 ? `; ${inUse.length - 1} more removed API${inUse.length > 2 ? 's are' : ' is'} in use` : ''}`,
  };
}

export function checkAdminAck(reads: RemovalReads | null, verdict: ApiRemovalVerdict | null, clusterVersion?: ClusterVersion | null): ReadinessCheck {
  const id = 'admin-ack';
  const label = 'Admin acknowledgement';
  // The cluster itself says an acknowledgement is missing: that is a blocker
  // whatever admin-gates/admin-acks say or whether they could be read (the
  // removed-API verdict is no_go for the same reason).
  const cvo = upgradeableBlockerOf(clusterVersion ?? null);
  if (cvo?.adminAck) {
    return { id, label, status: 'blocker', detail: `The cluster reports Upgradeable=False (AdminAckRequired)${cvo.message ? `: ${cvo.message}` : ''}. It will not take a minor update until the acknowledgement is given.` };
  }
  if (!reads || !verdict) return { id, label, status: 'checking', detail: 'Checking…' };
  if (!verdict.target) return { id, label, status: 'unknown', detail: verdict.reason };
  const g = reads.adminGates;
  if (g.state === 'error') return { id, label, status: 'unknown', detail: `Could not check: the admin-gates ConfigMap could not be read (${g.reason})` };
  if (g.state === 'absent') return { id, label, status: 'unknown', detail: 'Could not check: the admin-gates ConfigMap (openshift-config-managed/admin-gates) was not found' };
  const gates = verdict.gates;
  const pending = gates.filter((x) => x.acknowledged === false);
  if (pending.length) return { id, label, status: 'blocker', detail: `${plural(pending.length, 'admin gate')} for ${verdict.target.ocp} ${pending.length === 1 ? 'is' : 'are'} not acknowledged: ${pending.map((x) => x.key).join(', ')}` };
  if (gates.some((x) => x.acknowledged === null)) {
    const why = reads.adminAcks.state === 'error' ? reads.adminAcks.reason : 'admin-acks could not be read';
    return { id, label, status: 'unknown', detail: `Could not check whether ${gates.map((x) => x.key).join(', ')} ${gates.length === 1 ? 'is' : 'are'} acknowledged (${why})` };
  }
  if (gates.length === 0) return { id, label, status: 'passed', detail: `No admin acknowledgement is required for ${verdict.target.ocp}`, summary: 'no admin acknowledgement required' };
  return { id, label, status: 'passed', detail: `${gates.map((x) => x.key).join(', ')} acknowledged`, summary: 'admin acknowledgement given' };
}

/** CVO refuses a minor update while Upgradeable=False; AdminAckRequired is the admin-ack row's job. */
export function checkUpgradeable(clusterVersion: ClusterVersion | null | undefined, loading = false): ReadinessCheck | null {
  if (!clusterVersion) {
    return loading
      ? { id: 'upgradeable', label: 'Cluster upgradeable', status: 'checking', detail: 'Checking\u2026' }
      : { id: 'upgradeable', label: 'Cluster upgradeable', status: 'unknown', detail: 'Could not check: the ClusterVersion could not be read' };
  }
  const c = cond(clusterVersion?.status?.conditions as Condition[] | undefined, 'Upgradeable');
  if (c?.status === 'False' && c.reason === 'AdminAckRequired') return null;
  if (c?.status === 'False') {
    return { id: 'upgradeable', label: 'Cluster upgradeable', status: 'blocker', detail: `The cluster reports Upgradeable=False (${c.reason || 'no reason'})${c.message ? `: ${c.message}` : ''}. Minor updates are refused until it clears.` };
  }
  return { id: 'upgradeable', label: 'Cluster upgradeable', status: 'passed', detail: 'The cluster does not report Upgradeable=False', summary: 'cluster upgradeable' };
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export function readinessVerdict(checks: ReadinessCheck[]): ReadinessVerdict {
  const count = (s: ReadinessStatus) => checks.filter((c) => c.status === s).length;
  const blockers = count('blocker');
  const unknown = count('unknown');
  const checking = count('checking');
  const passed = count('passed');
  const state = blockers ? 'not_ready' : checking ? 'checking' : unknown ? 'unknown' : 'ready';
  return { state, blockers, unknown, checking, passed };
}

const STATUS_ORDER: Record<ReadinessStatus, number> = { blocker: 0, unknown: 1, checking: 2, passed: 3 };

export function sortChecks(checks: ReadinessCheck[]): ReadinessCheck[] {
  return [...checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/** Plain-text readiness result, for the chat context. */
export function readinessText(target: string, verdict: ReadinessVerdict, checks: ReadinessCheck[]): string {
  const head = verdict.state === 'ready' ? `Ready to update to ${target}`
    : verdict.state === 'not_ready' ? `Not ready to update to ${target}: ${plural(verdict.blockers, 'blocker')}, ${verdict.unknown} could not be checked`
    : verdict.state === 'checking' ? `Readiness for ${target} is still being checked`
    : `Could not check readiness for ${target}: ${verdict.unknown} check${verdict.unknown === 1 ? '' : 's'} could not be completed`;
  const word: Record<ReadinessStatus, string> = { blocker: 'Blocker', unknown: 'Unknown', checking: 'Checking', passed: 'Passed' };
  return [head, ...sortChecks(checks).map((c) => `- ${word[c.status]}: ${c.label}: ${c.detail}`)].join('\n');
}
