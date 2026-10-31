/**
 * One status → tone → classes map.
 *
 * Before this, "warning" was amber on finding cards and yellow on inbox items
 * and StatusBadge, "pending" was blue on StatusBadge and amber in agent
 * tables, and "unknown" was slate in one place and amber in another — so the
 * same state read differently depending on which page showed it.
 *
 * Every word a status can arrive as maps to one of a small set of tones, and
 * each tone has one set of Tailwind classes. Warning is amber (not yellow):
 * amber is what the Badge primitive, StatCard and charts (CHART_COLORS.amber)
 * already used, and it keeps its contrast on the dark slate background where
 * yellow-300 text washes out.
 */

export type StatusTone =
  | 'danger' // critical, error, failed
  | 'warning' // warning, degraded-but-serving
  | 'progress' // pending, progressing, in flight
  | 'success' // healthy, running, succeeded
  | 'neutral' // unknown, not compared, no data
  | 'info' // informational
  | 'terminating'; // being deleted

export interface ToneClasses {
  /** Text colour on the dark background, e.g. a status word in a table. */
  text: string;
  /** Soft tinted background for chips and rows. */
  bg: string;
  /** Border matching `bg`. */
  border: string;
  /** Darker border to highlight a card in this tone. */
  cardBorder: string;
  /** Solid fill for dots, bars and progress fills. */
  solid: string;
  /** Strong border in the tone's mid shade, e.g. a tree node's outline. */
  accentBorder: string;
  /** Soft chip: text + bg + border (the Badge look). */
  chip: string;
  /** Hex for SVG/canvas consumers that cannot take a class. */
  hex: string;
}

export const TONE_CLASSES: Record<StatusTone, ToneClasses> = {
  danger: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    cardBorder: 'border-red-800',
    solid: 'bg-red-500',
    accentBorder: 'border-red-500',
    chip: 'bg-red-500/10 text-red-400 border border-red-500/20',
    hex: '#ef4444',
  },
  warning: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    cardBorder: 'border-amber-800',
    solid: 'bg-amber-500',
    accentBorder: 'border-amber-500',
    chip: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    hex: '#f59e0b',
  },
  progress: {
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    cardBorder: 'border-blue-800',
    solid: 'bg-blue-500',
    accentBorder: 'border-blue-500',
    chip: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    hex: '#3b82f6',
  },
  success: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    cardBorder: 'border-emerald-800',
    solid: 'bg-emerald-500',
    accentBorder: 'border-emerald-500',
    chip: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    hex: '#10b981',
  },
  neutral: {
    text: 'text-slate-400',
    bg: 'bg-slate-800',
    border: 'border-slate-700',
    cardBorder: 'border-slate-800',
    solid: 'bg-slate-500',
    accentBorder: 'border-slate-600',
    chip: 'bg-slate-800 text-slate-400 border border-slate-700',
    hex: '#64748b',
  },
  info: {
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/20',
    cardBorder: 'border-sky-800',
    solid: 'bg-sky-500',
    accentBorder: 'border-sky-500',
    chip: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
    hex: '#0ea5e9',
  },
  terminating: {
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    cardBorder: 'border-orange-800',
    solid: 'bg-orange-500',
    accentBorder: 'border-orange-500',
    chip: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    hex: '#f97316',
  },
};

const STATUS_TONE: Record<string, StatusTone> = {};
function assign(tone: StatusTone, words: string[]) {
  for (const w of words) STATUS_TONE[w] = tone;
}

assign('danger', [
  'critical', 'error', 'errors', 'failed', 'failure', 'fail', 'fatal',
  'crashloopbackoff', 'imagepullbackoff', 'errimagepull', 'oomkilled', 'evicted',
  'false', 'degraded', 'unavailable', 'not ready', 'notready', 'unhealthy',
  'down', 'lost', 'missing',
]);
assign('warning', ['warning', 'warn', 'at risk', 'at_risk', 'stale', 'outofsync', 'out of sync', 'suspended']);
assign('progress', [
  'pending', 'progressing', 'in progress', 'in_progress', 'running_check',
  'containercreating', 'podinitializing', 'updating', 'syncing', 'rolling',
  'investigating', 'queued', 'waiting', 'scheduling',
]);
assign('success', [
  'healthy', 'success', 'succeeded', 'successful', 'running', 'active',
  'available', 'true', 'ready', 'complete', 'completed', 'bound', 'ok', 'pass',
  'passed', 'resolved', 'synced', 'up', 'verified',
]);
assign('neutral', ['unknown', 'not-compared', 'not compared', 'not_compared', 'none', 'n/a', 'no data', 'normal']);
assign('info', ['info', 'information', 'informational', 'notice', 'low']);
assign('terminating', ['terminating', 'deleting']);

/** The tone a status word reads as. Case-insensitive; anything unrecognised is neutral. */
export function statusTone(status: string | null | undefined | boolean): StatusTone {
  if (status === null || status === undefined) return 'neutral';
  const key = String(status).trim().toLowerCase();
  return STATUS_TONE[key] ?? 'neutral';
}

/** Whether a status word is one this map knows (as opposed to falling back to neutral). */
export function isKnownStatus(status: string | null | undefined): boolean {
  return !!status && String(status).trim().toLowerCase() in STATUS_TONE;
}

/** Classes for a status word. */
export function statusClasses(status: string | null | undefined | boolean): ToneClasses {
  return TONE_CLASSES[statusTone(status)];
}
