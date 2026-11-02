import React from 'react';
import { AlertTriangle, CheckCircle, HelpCircle, Loader2, RefreshCw, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_CLASSES } from '../../engine/statusColors';
import { formatRelative } from '../../engine/format';
import {
  readinessVerdict, sortChecks,
  type ReadinessCheck, type ReadinessCheckId, type ReadinessStatus,
} from '../../engine/upgradeReadiness';

const BADGE: Record<ReadinessStatus, { label: string; tone: keyof typeof TONE_CLASSES }> = {
  blocker: { label: 'Blocker', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'warning' },
  checking: { label: 'Checking', tone: 'neutral' },
  passed: { label: 'Passed', tone: 'success' },
};

type Expansion = { label: string; content: React.ReactNode };

export interface UpgradeReadinessPanelProps {
  /** What readiness is judged for, e.g. "4.19.3" or "4.19 (next minor, not offered yet)". */
  targetLabel: string | null;
  checks: ReadinessCheck[];
  checkedAt: number | null;
  onRecheck: () => void;
  onAsk: () => void;
  /** Why Ask Pulse can't be used here (e.g. a remote cluster is active). */
  askDisabledReason?: string;
  /** The fix for a row: a button or link shown at the row's end. */
  actions?: Partial<Record<ReadinessCheckId, React.ReactNode>>;
  /** Detail a row can expand into, with the toggle's label (e.g. "See callers"). */
  expansions?: Partial<Record<ReadinessCheckId, Expansion>>;
}

function Row({ check, action, expansion }: { check: ReadinessCheck; action?: React.ReactNode; expansion?: Expansion }) {
  const [open, setOpen] = React.useState(false);
  const b = BADGE[check.status];
  return (
    <li
      className="px-4 py-3 border-b border-slate-800 last:border-b-0"
      data-testid={`readiness-${check.id}`}
      data-status={check.status}
      {...(check.status === 'unknown' ? { 'data-unknown': true } : {})}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cn('inline-flex justify-center min-w-16 px-2 py-0.5 rounded-sm text-xs font-semibold', TONE_CLASSES[b.tone].chip)}>{b.label}</span>
        <div className="flex-1 min-w-0 basis-80">
          <div className="text-sm font-medium text-slate-100">{check.label}</div>
          <div className="text-xs text-slate-400 mt-0.5 break-words">{check.detail}</div>
        </div>
        {expansion && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 min-h-8">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}{expansion.label}
          </button>
        )}
        {action}
      </div>
      {expansion && open && <div className="mt-3">{expansion.content}</div>}
    </li>
  );
}

/**
 * One readiness verdict above the update action: Blocker / Unknown / Passed
 * rows, each with its fix. Unknown never counts as passed; passed rows
 * collapse into one line.
 */
export function UpgradeReadinessPanel({ targetLabel, checks, checkedAt, onRecheck, onAsk, askDisabledReason, actions = {}, expansions = {} }: UpgradeReadinessPanelProps) {
  const verdict = readinessVerdict(checks);
  const sorted = sortChecks(checks);
  const open = sorted.filter((c) => c.status !== 'passed');
  const passed = sorted.filter((c) => c.status === 'passed');
  const target = targetLabel ? ` to ${targetLabel}` : '';
  const title = verdict.state === 'ready' ? `Ready to update${target}`
    : verdict.state === 'not_ready' ? `Not ready to update${target}`
    : verdict.state === 'checking' ? `Checking readiness${target ? ` for${target.slice(3)}` : ''}…`
    : `Could not check readiness${target ? ` for${target.slice(3)}` : ''}`;
  const tone = verdict.state === 'ready' ? 'success' : verdict.state === 'not_ready' ? 'danger' : verdict.state === 'unknown' ? 'warning' : 'neutral';
  const Icon = verdict.state === 'ready' ? CheckCircle : verdict.state === 'not_ready' ? AlertTriangle : verdict.state === 'checking' ? Loader2 : HelpCircle;
  const counts = [
    verdict.blockers ? `${verdict.blockers} blocker${verdict.blockers === 1 ? '' : 's'}` : null,
    verdict.unknown ? `${verdict.unknown} could not be checked` : null,
    verdict.checking ? `${verdict.checking} still checking` : null,
    `${verdict.passed} passed`,
    checkedAt ? `checked ${formatRelative(checkedAt)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section aria-labelledby="readiness-title" data-testid="upgrade-readiness" data-verdict={verdict.state} className={cn('rounded-lg border bg-slate-900 overflow-hidden', TONE_CLASSES[tone].cardBorder)}>
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-slate-800', TONE_CLASSES[tone].bg)}>
        <Icon className={cn('w-5 h-5 shrink-0', TONE_CLASSES[tone].text, verdict.state === 'checking' && 'animate-spin')} aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="readiness-title" className="text-base font-semibold text-slate-100">{title}</h2>
          <div className="text-xs text-slate-300" data-testid="readiness-counts">{counts}</div>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onRecheck} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 min-h-9">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />Recheck
          </button>
          <button type="button" onClick={onAsk} disabled={!!askDisabledReason} title={askDisabledReason} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-9">
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />Ask Pulse
          </button>
        </div>
      </div>
      {askDisabledReason && <p className="px-4 py-2 text-xs text-amber-300 border-b border-slate-800" data-testid="readiness-ask-disabled">{askDisabledReason}</p>}
      <ul aria-label="Readiness checks">
        {open.map((c) => <Row key={c.id} check={c} action={actions[c.id]} expansion={expansions[c.id]} />)}
        {passed.length > 0 && (
          <li className="px-4 py-3">
            <details>
              <summary className="cursor-pointer text-xs text-slate-300">
                {open.length > 0 ? `${passed.length} more check${passed.length === 1 ? '' : 's'} passed` : `All ${passed.length} checks passed`}: {passed.map((c) => c.summary || c.label).join(' · ')}
              </summary>
              <ul className="mt-2 rounded-md border border-slate-800">
                {passed.map((c) => <Row key={c.id} check={c} action={actions[c.id]} expansion={expansions[c.id]} />)}
              </ul>
            </details>
          </li>
        )}
      </ul>
    </section>
  );
}
