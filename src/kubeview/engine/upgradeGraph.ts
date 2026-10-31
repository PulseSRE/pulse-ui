/**
 * Upgrade graph model — the shape both Admin › Updates and the agent's
 * `upgrade_graph` component render. Built from ClusterVersion (plus the
 * ClusterOperators and MachineConfigPools when they are readable); the agent's
 * `get_cluster_updates` tool emits the same structure.
 *
 * Nothing here is invented: recommended means "listed in availableUpdates",
 * conditional means "listed in conditionalUpdates with Recommended != True",
 * blocked means "a minor-version target while Upgradeable=False", and the
 * duration estimate is the last completed update's actual duration.
 */

import type { ClusterOperator, ClusterVersion, Condition, MachineConfigPool } from './types';

export type UpgradeTargetState = 'recommended' | 'conditional' | 'blocked';

export interface UpgradeRisk {
  name: string;
  message: string;
  url?: string;
  matchingRules?: Array<Record<string, unknown>>;
}

export interface UpgradeTarget {
  version: string;
  image?: string;
  state: UpgradeTargetState;
  recommended: boolean;
  risks: UpgradeRisk[];
  channels?: string[];
  /** The conditional update's Recommended condition message, when known. */
  recommendation?: string;
}

export interface UpgradeHistoryEntry {
  version: string;
  state: string;
  startedTime?: string;
  completionTime?: string;
  verified?: boolean;
}

export interface UpgradePoolProgress {
  name: string;
  updated: number;
  total: number;
  degraded: boolean;
  updating?: boolean;
  paused?: boolean;
}

export interface UpgradeProgress {
  phase: 'idle' | 'progressing' | 'failing';
  message?: string;
  done?: number | null;
  total?: number | null;
  percent?: number | null;
  clusterOperators?: { updated: number; total: number; degraded: string[] } | null;
  pools?: UpgradePoolProgress[] | null;
  etaMinutes?: number | null;
  etaBasis?: string;
}

export interface UpgradeBlocker {
  type: string;
  reason?: string;
  message: string;
  link?: string;
}

export interface UpgradeModel {
  current: { version: string; image?: string; channel?: string };
  desired?: { version?: string; image?: string };
  /** The release the targets were computed from: desired while an update is in flight, else current. */
  updatesFrom?: string;
  channels?: string[];
  nodes: UpgradeTarget[];
  edges?: Array<{ from: string; to: string }>;
  history: UpgradeHistoryEntry[];
  progress: UpgradeProgress;
  blockers: UpgradeBlocker[];
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function parseVersion(v: string): number[] {
  const core = (v || '').split(/[-+]/)[0];
  return core.split('.').map((p) => parseInt(p, 10) || 0);
}

/** Ascending semver compare (pre-release suffixes sort before their release). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  const preA = a.includes('-');
  const preB = b.includes('-');
  if (preA !== preB) return preA ? -1 : 1;
  return a.localeCompare(b);
}

export function minorOf(v: string): string {
  const [maj, min] = parseVersion(v);
  return v ? `${maj}.${min}` : '';
}

// ---------------------------------------------------------------------------
// Progress parsing
// ---------------------------------------------------------------------------

const CVO_PROGRESS_RE = /(\d+)\s+of\s+(\d+)\s+done(?:\s*\((\d+)%\s*complete\))?/;

/** "Working towards 4.16.8: 512 of 863 done (59% complete)" → {done, total, percent}. */
export function parseCvoProgress(message: string | undefined): { done: number; total: number; percent: number } | null {
  const m = CVO_PROGRESS_RE.exec(message || '');
  if (!m) return null;
  const done = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  const percent = m[3] ? parseInt(m[3], 10) : total ? Math.round((done * 100) / total) : 0;
  return { done, total, percent };
}

function cond(conditions: Condition[] | undefined, type: string): Condition | undefined {
  return (conditions || []).find((c) => c.type === type);
}

export function durationMinutes(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 60000);
}

/** The most recent Completed update and how long it took, for the duration estimate. */
export function lastCompletedDuration(history: UpgradeHistoryEntry[]): { version: string; minutes: number } | null {
  for (const h of history) {
    if (h.state !== 'Completed') continue;
    const minutes = durationMinutes(h.startedTime, h.completionTime);
    if (minutes != null) return { version: h.version, minutes };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/**
 * Channel choices. ClusterVersion's status.desired.channels is what the release
 * itself says it belongs to, so when present it is authoritative. Otherwise:
 * the current and next minor for stable/fast/candidate (the next minor is how a
 * minor update becomes available), and eus only for even minors.
 */
export function channelOptions(version: string, currentChannel: string, desiredChannels?: string[]): string[] {
  let options: string[];
  if (desiredChannels && desiredChannels.length > 0) {
    options = [...desiredChannels];
  } else {
    const [maj, min] = parseVersion(version);
    options = [];
    if (version) {
      for (const m of [min, min + 1]) {
        for (const p of ['stable', 'fast', 'candidate']) options.push(`${p}-${maj}.${m}`);
        if (m % 2 === 0) options.push(`eus-${maj}.${m}`);
      }
    }
  }
  if (currentChannel && !options.includes(currentChannel)) options.unshift(currentChannel);
  return options;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface AvailableUpdateLike {
  version: string;
  image?: string;
  channels?: string[];
}

export function buildUpgradeModel(params: {
  clusterVersion: ClusterVersion | null | undefined;
  /** Overrides status.availableUpdates (the page already holds them). */
  availableUpdates?: AvailableUpdateLike[];
  /** Used when history has no Completed entry. */
  fallbackVersion?: string;
  /** null = could not be read; undefined = not supplied. */
  operators?: ClusterOperator[] | null;
  pools?: MachineConfigPool[] | null;
}): UpgradeModel {
  const cv = params.clusterVersion;
  const status = cv?.status;
  const conditions = status?.conditions || [];
  const historyRaw = status?.history || [];
  const completed = historyRaw.find((h) => h.state === 'Completed');
  const currentVersion = completed?.version || status?.desired?.version || params.fallbackVersion || '';
  // While an update is in flight CVO computes availableUpdates/conditionalUpdates
  // from the release it is reconciling (status.desired), not the running one.
  const inFlight = cond(conditions, 'Progressing')?.status === 'True';
  const updatesFrom = inFlight && status?.desired?.version ? status.desired.version : currentVersion;
  const currentMinor = parseVersion(updatesFrom);

  const upgradeable = cond(conditions, 'Upgradeable');
  const upgradeableFalse = upgradeable?.status === 'False';
  const isBlocked = (v: string) => {
    if (!upgradeableFalse || !updatesFrom) return false;
    const [maj, min] = parseVersion(v);
    return maj > currentMinor[0] || (maj === currentMinor[0] && min > currentMinor[1]);
  };

  const nodes: UpgradeTarget[] = [];
  const available = params.availableUpdates ?? (status?.availableUpdates as AvailableUpdateLike[] | undefined) ?? [];
  for (const u of available) {
    if (!u?.version) continue;
    nodes.push({
      version: u.version,
      image: u.image,
      state: isBlocked(u.version) ? 'blocked' : 'recommended',
      recommended: true,
      risks: [],
      channels: u.channels,
    });
  }
  for (const cu of status?.conditionalUpdates || []) {
    const version = cu.release?.version;
    if (!version || nodes.some((n) => n.version === version)) continue;
    const rec = cond(cu.conditions, 'Recommended');
    const recommended = rec?.status === 'True';
    nodes.push({
      version,
      image: cu.release?.image,
      state: isBlocked(version) ? 'blocked' : recommended ? 'recommended' : 'conditional',
      recommended,
      risks: (cu.risks || []).map((r) => ({
        name: r.name || 'UnnamedRisk',
        message: r.message || '',
        url: r.url,
        matchingRules: r.matchingRules as Array<Record<string, unknown>> | undefined,
      })),
      recommendation: rec?.message,
    });
  }
  nodes.sort((a, b) => compareVersions(b.version, a.version));

  const progressing = cond(conditions, 'Progressing');
  const failing = cond(conditions, 'Failing');
  const isProgressing = progressing?.status === 'True';
  const parsed = isProgressing ? parseCvoProgress(progressing?.message) : null;
  const target = status?.desired?.version || '';

  let clusterOperators: UpgradeProgress['clusterOperators'];
  if (params.operators === null) clusterOperators = null;
  else if (params.operators) {
    let updated = 0;
    const degraded: string[] = [];
    for (const co of params.operators) {
      const v = co.status?.versions?.find((x) => x.name === 'operator')?.version;
      if (v && v === target) updated++;
      if (cond(co.status?.conditions, 'Degraded')?.status === 'True') degraded.push(co.metadata.name);
    }
    clusterOperators = { updated, total: params.operators.length, degraded };
  }

  let pools: UpgradeProgress['pools'];
  if (params.pools === null) pools = null;
  else if (params.pools) {
    pools = params.pools.map((p) => ({
      name: p.metadata.name,
      updated: p.status?.updatedMachineCount ?? 0,
      total: p.status?.machineCount ?? 0,
      degraded: cond(p.status?.conditions, 'Degraded')?.status === 'True' || (p.status?.degradedMachineCount ?? 0) > 0,
      updating: cond(p.status?.conditions, 'Updating')?.status === 'True',
      paused: !!p.spec?.paused,
    }));
  }

  const history: UpgradeHistoryEntry[] = historyRaw.map((h) => ({
    version: h.version,
    state: h.state,
    startedTime: h.startedTime,
    completionTime: h.completionTime,
    verified: (h as { verified?: boolean }).verified,
  }));
  const last = lastCompletedDuration(history);
  const etaMinutes = isProgressing && parsed && last ? Math.max(0, Math.round((last.minutes * (100 - parsed.percent)) / 100)) : null;

  const blockers: UpgradeBlocker[] = [];
  if (upgradeableFalse) {
    blockers.push({ type: 'upgradeable', reason: upgradeable?.reason, message: upgradeable?.message || 'Upgradeable=False' });
  }
  if (failing?.status === 'True') {
    blockers.push({ type: 'failing', reason: failing.reason, message: failing.message || 'Failing=True' });
  }
  for (const p of pools || []) {
    const link = `/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/${p.name}`;
    if (p.degraded) blockers.push({ type: 'pool', reason: 'Degraded', message: `MachineConfigPool ${p.name} is degraded`, link });
    else if (p.paused && isProgressing && p.updated < p.total) {
      blockers.push({ type: 'pool', reason: 'Paused', message: `MachineConfigPool ${p.name} is paused; its nodes will not update`, link });
    }
  }

  return {
    current: { version: currentVersion, image: completed?.image || status?.desired?.image, channel: cv?.spec?.channel },
    desired: status?.desired ? { version: status.desired.version, image: status.desired.image } : undefined,
    updatesFrom,
    channels: (status?.desired as { channels?: string[] } | undefined)?.channels,
    nodes,
    edges: nodes.map((n) => ({ from: updatesFrom, to: n.version })),
    history,
    progress: {
      phase: failing?.status === 'True' ? 'failing' : isProgressing ? 'progressing' : 'idle',
      message: isProgressing ? progressing?.message : undefined,
      done: parsed?.done ?? null,
      total: parsed?.total ?? null,
      percent: parsed?.percent ?? null,
      clusterOperators,
      pools,
      etaMinutes,
      etaBasis: etaMinutes != null ? 'last completed update duration' : undefined,
    },
    blockers,
  };
}

/**
 * The merge patch that starts an update. Version and image always travel
 * together (a version alone can no-op against a stale image). A conditional
 * target also names each of its risks in spec.desiredUpdate.acceptRisks
 * (ClusterUpdateAcceptRisks); entries already accepted are kept, since a merge
 * patch replaces the list.
 */
export function desiredUpdatePatch(
  target: Pick<UpgradeTarget, 'version' | 'image' | 'state' | 'risks'>,
  existingAccepted: Array<{ name?: string }> = [],
): { spec: { desiredUpdate: { version: string; image: string; acceptRisks?: Array<{ name: string }> } } } {
  if (!target.image) {
    throw new Error(`No image digest available for ${target.version} — refusing to patch desiredUpdate with version only, which can silently no-op against a stale image.`);
  }
  const desiredUpdate: { version: string; image: string; acceptRisks?: Array<{ name: string }> } = {
    version: target.version,
    image: target.image,
  };
  if (target.state === 'conditional' && target.risks.length > 0) {
    const names = new Set<string>();
    for (const r of existingAccepted) if (r?.name) names.add(r.name);
    for (const r of target.risks) names.add(r.name);
    desiredUpdate.acceptRisks = [...names].map((name) => ({ name }));
  }
  return { spec: { desiredUpdate } };
}
