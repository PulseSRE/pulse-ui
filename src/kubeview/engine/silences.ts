/**
 * Alertmanager silences: matchers, the safety rules, the request, and the
 * "Pulse suggests a silence" heuristic.
 *
 * The safety rules mirror the agent's (`sre_agent/silences.py`), so a silence
 * the chat path would refuse is refused here too: no empty or all-matching
 * matcher set (at least one positive matcher must name something specific),
 * and never Watchdog.
 *
 * Writes go to `/api/alertmanager/api/v2/silences`, the same path and the same
 * per-user RBAC as the Silences form (the operator's proxy forwards the
 * user's token to alertmanager-main's kube-rbac-proxy).
 */
import type { Node } from './types';

export interface Matcher {
  name: string;
  value: string;
  isRegex: boolean;
  /** false for != and !~ */
  isEqual: boolean;
}

export function matcherOp(m: { isRegex: boolean; isEqual?: boolean }): string {
  const negative = m.isEqual === false;
  return m.isRegex ? (negative ? '!~' : '=~') : (negative ? '!=' : '=');
}

export function formatMatcher(m: Matcher): string {
  return `${m.name}${matcherOp(m)}"${m.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function formatMatchers(ms: Matcher[]): string {
  return ms.map(formatMatcher).join(', ');
}

const MATCHER_RE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*"((?:[^"\\]|\\.)*)"\s*/;

/** Parse `name="v", name=~"re", ...` (braces optional). Throws with the reason. */
export function parseMatchers(text: string): Matcher[] {
  let s = text.trim();
  if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1);
  const out: Matcher[] = [];
  while (s.length > 0) {
    const m = MATCHER_RE.exec(s);
    if (!m) throw new Error(`Could not read the matchers at "${s.slice(0, 40)}". Use name="value", name!="value", name=~"regex" or name!~"regex", separated by commas.`);
    const [, name, op, raw] = m;
    out.push({ name, value: raw.replace(/\\(.)/g, '$1'), isRegex: op.includes('~'), isEqual: !op.startsWith('!') });
    s = s.slice(m[0].length);
    if (s.length > 0) {
      if (s[0] !== ',') throw new Error(`Expected a comma after ${name}${op}"${raw}"`);
      s = s.slice(1);
    }
  }
  return out;
}

const MAX_REGEX_LEN = 200;
const MAX_MATCH_VALUE_LEN = 1024;
/** A group containing a quantifier, itself quantified: (a+)+, (x*)*. */
/**
 * Any repeated group: (a+)+, and overlapping alternations such as (a|a)*b or
 * (\w|\w)*Z, which backtrack exponentially with no nested quantifier. Same rule
 * as the agent's _QUANTIFIED_GROUP_RE.
 */
const QUANTIFIED_GROUP = /\)\s*[*+?{]/;
const ANCHOR_LABELS = new Set(['alertname', 'node', 'pod', 'deployment', 'statefulset', 'daemonset', 'job_name', 'persistentvolumeclaim']);
const PLATFORM_NS = /^(openshift|kube)(-.*)?$/;
/** Watchdog's label set on OpenShift's platform Prometheus. */
export const WATCHDOG_LABELS: Record<string, string> = {
  alertname: 'Watchdog', namespace: 'openshift-monitoring', severity: 'none', prometheus: 'openshift-monitoring/k8s',
};
/** The agent's defaults (silence_max_hidden_alerts / _fraction / fraction_min_alerts). */
export const SILENCE_LIMITS = { maxHidden: 10, maxFraction: 0.25, fractionMinAlerts: 3 };

export function regexProblem(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_LEN) return `is longer than ${MAX_REGEX_LEN} characters`;
  if (QUANTIFIED_GROUP.test(pattern)) return 'repeats a group, such as (a|a)* or (a+)+, which can take exponential time to match; list the values instead';
  try { new RegExp(pattern); } catch { return 'does not compile'; }
  return null;
}

function fullMatch(pattern: string, value: string): boolean | null {
  if (regexProblem(pattern)) return null;
  try {
    return new RegExp(`^(?:${pattern})$`).test(value.slice(0, MAX_MATCH_VALUE_LEN));
  } catch {
    return null;
  }
}

export function matcherMatches(m: Matcher, value: string): boolean {
  const v = value.slice(0, MAX_MATCH_VALUE_LEN);
  const hit = m.isRegex ? fullMatch(m.value, v) === true : v === m.value;
  return m.isEqual ? hit : !hit;
}

/** Alertmanager's rule: every matcher holds; an absent label is the empty string. */
export function labelsMatch(labels: Record<string, string>, ms: Matcher[]): boolean {
  return ms.every((m) => matcherMatches(m, labels[m.name] ?? ''));
}

/** A positive equality on an alert name, a resource, or an application namespace. */
function isAnchor(m: Matcher): boolean {
  if (!m.isEqual || m.isRegex || !m.value) return false;
  if (ANCHOR_LABELS.has(m.name)) return true;
  return m.name === 'namespace' && !PLATFORM_NS.test(m.value);
}

/**
 * Why these matchers may not be used, or null. The same rules as the
 * agent's sre_agent/silences.py, so the chat path and this dialog agree.
 */
export function matcherProblem(ms: Matcher[]): string | null {
  if (ms.length === 0) return 'A silence needs at least one matcher; an empty set would mute every alert.';
  for (const m of ms) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(m.name)) return `"${m.name}" is not a valid label name.`;
    if (m.isRegex) {
      const p = regexProblem(m.value);
      if (p) return `The regex for ${m.name} ${p}.`;
    }
  }
  if (!ms.some(isAnchor)) {
    return 'These matchers are too broad: at least one must be an exact (=) match on alertname or on a resource (node, pod, deployment, statefulset, daemonset, job_name, persistentvolumeclaim), or on a namespace outside openshift-*/kube-*. severity, prometheus or a regex alone would mute whole classes of alerts.';
  }
  if (labelsMatch(WATCHDOG_LABELS, ms)) {
    return 'Watchdog cannot be silenced: it is the always-firing alert that tells the external pager Alertmanager is alive.';
  }
  return null;
}

/** Why a silence hiding these firing alerts is refused (a firing Watchdog, or too many of them), or null. */
export function hiddenProblem(hidden: AlertForSilence[], firing: AlertForSilence[], limits = SILENCE_LIMITS): string | null {
  if (hidden.some((a) => a.labels.alertname === 'Watchdog')) return 'Watchdog cannot be silenced, and these matchers would hide the Watchdog firing now.';
  if (hidden.length > limits.maxHidden) return `These matchers would hide ${hidden.length} alerts firing now, more than the ${limits.maxHidden} a silence may hide. Narrow them.`;
  if (firing.length && hidden.length >= limits.fractionMinAlerts && hidden.length / firing.length > limits.maxFraction) {
    return `These matchers would hide ${hidden.length} of the ${firing.length} alerts firing now, more than ${Math.round(limits.maxFraction * 100)}% of them. Narrow them.`;
  }
  return null;
}

export interface SilenceBody {
  matchers: Matcher[];
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
}

export function buildSilenceBody(ms: Matcher[], minutes: number, createdBy: string, comment: string, now = new Date()): SilenceBody {
  return {
    matchers: ms.map((m) => ({ name: m.name, value: m.value, isRegex: m.isRegex, isEqual: m.isEqual })),
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
    createdBy,
    comment,
  };
}

export class SilenceWriteError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SilenceWriteError';
  }
}

async function failure(res: Response, verb: string): Promise<SilenceWriteError> {
  const text = (await res.text().catch(() => '')).trim().slice(0, 300);
  if (res.status === 403) {
    return new SilenceWriteError(403, `Alertmanager refused to ${verb} the silence (403): your account needs the monitoring-alertmanager-edit role in openshift-monitoring.${text ? ` ${text}` : ''}`);
  }
  return new SilenceWriteError(res.status, text || `Alertmanager returned ${res.status} ${res.statusText}`.trim());
}

/** POST the silence; returns its id. */
export async function createSilence(body: SilenceBody): Promise<string> {
  const res = await fetch('/api/alertmanager/api/v2/silences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, 'create');
  const data = await res.json().catch(() => null);
  const id = data?.silenceID;
  if (!id) throw new SilenceWriteError(502, 'Alertmanager did not return a silence id, so it is not known whether the silence was created. Check Alerts › Silences.');
  return String(id);
}

export async function expireSilence(id: string): Promise<void> {
  const res = await fetch(`/api/alertmanager/api/v2/silence/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'expire');
}

// ---- "Pulse suggests a silence" ------------------------------------------------

export interface AlertForSilence {
  labels: Record<string, string>;
  state: string;
  activeAt?: string;
  /** Already muted by an active silence: not counted in the share a new silence may hide (as the agent counts). */
  silenced?: boolean;
}

export interface SilenceSuggestion {
  key: string;
  node: string;
  alertnames: string[];
  matchers: Matcher[];
  /** When the node was cordoned, from its unschedulable taint; null when not recorded. */
  cordonedAt: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Planned maintenance: a cordoned node whose firing alerts are about that
 * node. Each such node yields one suggestion that names exactly the alerts
 * firing on it now (by name), so other alerts on the node and every other
 * node stay visible.
 */
export function suggestSilences(alerts: AlertForSilence[], nodes: Node[]): SilenceSuggestion[] {
  const out: SilenceSuggestion[] = [];
  for (const node of nodes) {
    if (!node.spec?.unschedulable) continue;
    const name = node.metadata?.name;
    if (!name) continue;
    const onNode = alerts.filter((a) => a.state === 'firing' && a.labels.node === name && a.labels.alertname && a.labels.alertname !== 'Watchdog');
    const alertnames = [...new Set(onNode.map((a) => a.labels.alertname))].sort();
    if (alertnames.length === 0) continue;
    const matchers: Matcher[] = [
      { name: 'node', value: name, isRegex: false, isEqual: true },
      alertnames.length === 1
        ? { name: 'alertname', value: alertnames[0], isRegex: false, isEqual: true }
        : { name: 'alertname', value: alertnames.map(escapeRegex).join('|'), isRegex: true, isEqual: true },
    ];
    const taint = (node.spec?.taints || []).find((t) => t.key === 'node.kubernetes.io/unschedulable');
    out.push({ key: `${name}|${alertnames.join(',')}`, node: name, alertnames, matchers, cordonedAt: taint?.timeAdded ?? null });
  }
  return out;
}

/** Minutes that cover a due time (plus 5 minutes, in 15-minute steps), else 2 hours. */
export function minutesToCover(dueEpochSeconds: number | null | undefined, nowMs = Date.now()): number {
  if (!dueEpochSeconds || dueEpochSeconds * 1000 <= nowMs) return 120;
  const minutes = Math.ceil((dueEpochSeconds * 1000 - nowMs) / 60_000) + 5;
  return Math.min(7 * 24 * 60, Math.max(30, Math.ceil(minutes / 15) * 15));
}

export function describeMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  if (minutes > 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes} minutes`;
}
