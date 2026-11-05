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

function fullMatch(pattern: string, value: string): boolean | null {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return null;
  }
}

export function matcherMatches(m: Matcher, value: string): boolean {
  const hit = m.isRegex ? fullMatch(m.value, value) === true : value === m.value;
  return m.isEqual ? hit : !hit;
}

/** Alertmanager's rule: every matcher holds; an absent label is the empty string. */
export function labelsMatch(labels: Record<string, string>, ms: Matcher[]): boolean {
  return ms.every((m) => matcherMatches(m, labels[m.name] ?? ''));
}

const PROBES = ['x', 'pulse-probe-7f3a9c', 'Z9_q.r/s:t'];

function isNarrow(m: Matcher): boolean {
  if (!m.isEqual) return false;
  if (!m.isRegex) return m.value !== '';
  if (fullMatch(m.value, '') !== false) return false;
  return !PROBES.every((p) => fullMatch(m.value, p) === true);
}

/** Why these matchers may not be used, or null when they are acceptable. */
export function matcherProblem(ms: Matcher[]): string | null {
  if (ms.length === 0) return 'A silence needs at least one matcher; an empty set would mute every alert.';
  for (const m of ms) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(m.name)) return `"${m.name}" is not a valid label name.`;
    if (m.isRegex && fullMatch(m.value, '') === null) return `The regex for ${m.name} does not compile.`;
  }
  if (!ms.some(isNarrow)) {
    return 'These matchers would match every alert: at least one must be a positive matcher (= or =~) that names something specific.';
  }
  if (ms.some((m) => m.name === 'alertname' && m.isEqual && matcherMatches(m, 'Watchdog'))) {
    return 'Watchdog cannot be silenced: it is the always-firing alert that tells the external pager Alertmanager is alive.';
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
