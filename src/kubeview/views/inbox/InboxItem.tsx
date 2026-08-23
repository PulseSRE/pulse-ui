import { useState } from 'react';
import {
  XCircle, AlertTriangle, Info, CheckCircle2,
  User, Pin, Eye, PauseCircle, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../../engine/formatters';
import { Card } from '../../components/primitives/Card';
import { Badge } from '../../components/primitives/Badge';
import { Dropdown } from '../../components/primitives/Dropdown';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { Tooltip } from '../../components/primitives/Tooltip';
import { InboxLifecycleBadge } from './InboxLifecycle';
import type { InboxItem as InboxItemType, InboxSeverity } from '../../engine/inboxApi';
import { useInboxStore } from '../../store/inboxStore';

const SEVERITY_ICON: Record<InboxSeverity, typeof XCircle> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<InboxSeverity, string> = {
  critical: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500',
};

const SEVERITY_ICON_COLOR: Record<InboxSeverity, string> = {
  critical: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-blue-500',
};

const SNOOZE_ITEMS = [
  { id: '4', label: '4 hours', onClick: () => {} },
  { id: '24', label: '24 hours', onClick: () => {} },
  { id: '72', label: '3 days', onClick: () => {} },
  { id: '168', label: '1 week', onClick: () => {} },
];

function getSourceLabel(createdBy: string): string {
  if (createdBy === 'system:monitor') return 'Monitor';
  if (createdBy === 'system:agent') return 'AI';
  if (createdBy?.startsWith('system:')) return 'Proactive';
  return 'Manual';
}

/**
 * One worded chip for the agent's relationship to this item.
 *
 * This used to be up to six same-sized colored dots (reviewing, cleared,
 * triaged, review-failed, pending-approval, archived) whose meanings lived
 * only in hover tooltips — color was the sole channel, and at a glance they
 * were indistinguishable. One state wins, it gets a word, and the detail
 * stays in the tooltip.
 */
function agentStateChip(item: InboxItemType): { label: string; cls: string; tooltip: string; pulse?: boolean } | null {
  const md = item.metadata || {};
  if (item.status === 'agent_reviewing') {
    return { label: 'Reviewing…', cls: 'bg-violet-900/40 text-violet-300 border-violet-700/40', tooltip: 'Agent is investigating', pulse: true };
  }
  if (item.status === 'agent_review_failed') {
    return { label: 'Review failed', cls: 'bg-red-900/40 text-red-300 border-red-700/40', tooltip: String(md.agent_error || 'Agent analysis failed') };
  }
  if (item.status === 'agent_cleared') {
    return { label: 'Cleared', cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/30', tooltip: String(md.dismiss_reason || 'Cleared by agent') };
  }
  if (md.has_pending_approval) {
    return { label: 'Approval waiting', cls: 'bg-orange-900/40 text-orange-300 border-orange-700/40', tooltip: 'A proposed fix is waiting on you' };
  }
  if (item.status === 'archived' && md.archived_reason) {
    return { label: 'Archived', cls: 'bg-slate-800 text-slate-400 border-slate-700', tooltip: String(md.archived_reason) };
  }
  if (md.triaged) {
    return { label: `Triaged · ${String(md.triage_urgency || 'can-wait')}`, cls: 'bg-violet-900/30 text-violet-300 border-violet-800/30', tooltip: `AI: ${String(md.triage_action || 'triaged')}` };
  }
  return null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** The math behind the rank, so line one can explain itself. */
function priorityTooltip(factors: Record<string, unknown>): string {
  const f = (k: string) => Number(factors[k] ?? 0);
  const lines = [
    `${String(factors.severity)} ×${f('severity_weight')} · ${String(factors.layer)} layer ×${f('layer_weight')}`,
    `confidence ${f('confidence')} · noise ${f('noise_score')} → base ${f('base')}`,
  ];
  const bonuses: string[] = [];
  if (f('age_bonus') > 0) bonuses.push(`age +${f('age_bonus')}`);
  if (f('novelty_bonus') > 0) bonuses.push(`novelty +${f('novelty_bonus')}`);
  if (f('due_bonus') > 0) bonuses.push(`due +${f('due_bonus')}`);
  if (bonuses.length) lines.push(bonuses.join(' · '));
  lines.push(`priority ${f('total')}`);
  return lines.join('\n');
}

export function InboxItem({
  item,
  focused,
}: {
  item: InboxItemType;
  focused?: boolean;
}) {
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);
  const acknowledge = useInboxStore((s) => s.acknowledge);
  const claim = useInboxStore((s) => s.claim);
  const snooze = useInboxStore((s) => s.snooze);
  const dismiss = useInboxStore((s) => s.dismiss);
  const pin = useInboxStore((s) => s.pin);

  const severity: InboxSeverity = (item.severity as InboxSeverity) || 'info';
  const SeverityIcon = SEVERITY_ICON[severity] || Info;
  const isPinned = item.pinned_by.length > 0;
  const stateChip = agentStateChip(item);
  const recurrence = Number(item.metadata?.recurrence_30d ?? 0);
  const sloImpact = (item.metadata?.slo_impact as Array<{ service: string; slo_type: string }> | undefined) ?? [];
  const priorityFactors = item.metadata?.priority_factors as Record<string, unknown> | undefined;

  const handleDismiss = () => {
    setConfirmDismiss(false);
    dismiss(item.id);
  };

  const onDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDismiss(true);
  };

  const snoozeItems = SNOOZE_ITEMS.map((opt) => ({
    ...opt,
    onClick: () => snooze(item.id, Number(opt.id)),
  }));

  return (
    <>
      <Card
        className={cn(
          'border-l-4',
          SEVERITY_COLOR[severity] || 'border-l-slate-600',
          focused && 'ring-1 ring-violet-500/60',
        )}
        onClick={() => setSelectedItem(item.id)}
      >
        <div className="px-4 py-3 flex items-start gap-3">
          <SeverityIcon className={cn('w-5 h-5 shrink-0 mt-0.5', SEVERITY_ICON_COLOR[severity])} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-200 truncate">{item.title}</span>
              {item.namespace && (
                <Badge variant="outline" className="text-xs">{item.namespace}</Badge>
              )}
              {stateChip && (
                <Tooltip content={stateChip.tooltip}>
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 whitespace-nowrap',
                      stateChip.cls,
                      stateChip.pulse && 'animate-pulse',
                    )}
                  >
                    {stateChip.label}
                  </span>
                </Tooltip>
              )}
              {recurrence >= 2 && (
                <Tooltip content={`This condition has come back — ${ordinal(recurrence)} visit in 30 days. Chronic work deserves a runbook, not another triage.`}>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-900/40 text-amber-300 border-amber-700/40 shrink-0 whitespace-nowrap">
                    {ordinal(recurrence)} in 30d
                  </span>
                </Tooltip>
              )}
              {sloImpact.length > 0 && (
                <Tooltip content={`Backs a registered SLO: ${sloImpact.map((s) => `${s.service} ${s.slo_type}`).join(', ')}`}>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-sky-900/40 text-sky-300 border-sky-700/40 shrink-0 whitespace-nowrap">
                    SLO · {String(sloImpact[0].service)}
                  </span>
                </Tooltip>
              )}
              {isPinned && (
                <Pin className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
              )}
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
              <span>{getSourceLabel(item.created_by)}</span>
              <span>·</span>
              <span>{formatRelativeTime(item.created_at * 1000)}</span>
              {item.claimed_by && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {item.claimed_by}
                  </span>
                </>
              )}
              <span>·</span>
              <Tooltip content="Green = done · Purple = current · Gray = upcoming" side="bottom">
                <span><InboxLifecycleBadge itemType={item.item_type} status={item.status} /></span>
              </Tooltip>
              {priorityFactors && (
                <>
                  <span>·</span>
                  {/* Why this rank. A queue whose line one can't explain itself
                      doesn't get trusted — the score's inputs are one hover away. */}
                  <Tooltip content={<span className="whitespace-pre-line">{priorityTooltip(priorityFactors)}</span>} side="bottom">
                    <span className="tabular-nums cursor-default">P {Number(priorityFactors.total ?? item.priority_score).toFixed(1)}</span>
                  </Tooltip>
                </>
              )}
            </div>
            {(item.status === 'resolved' || item.status === 'agent_cleared') && item.metadata?.dismiss_reason ? (
              <p className="text-xs text-emerald-500/70 mt-1 line-clamp-1">
                {String(item.metadata.dismiss_reason)}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {item.status === 'new' && (
              <Tooltip content="Acknowledge">
                <button
                  onClick={(e) => { e.stopPropagation(); acknowledge(item.id); }}
                  className="p-1.5 rounded-sm hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label="Acknowledge"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            {!item.claimed_by && (
              <Tooltip content="Claim">
                <button
                  onClick={(e) => { e.stopPropagation(); claim(item.id); }}
                  className="p-1.5 rounded-sm hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label="Claim"
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            <Tooltip content="Snooze">
              <Dropdown
                trigger={
                  <button
                    className="p-1.5 rounded-sm hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                    aria-label="Snooze"
                  >
                    <PauseCircle className="w-4 h-4" />
                  </button>
                }
                items={snoozeItems}
                align="right"
              />
            </Tooltip>
            <Tooltip content={isPinned ? 'Unpin' : 'Pin'}>
              <button
                onClick={(e) => { e.stopPropagation(); pin(item.id); }}
                className={cn(
                  'p-1.5 rounded-sm hover:bg-slate-800 transition-colors',
                  isPinned ? 'text-yellow-500' : 'text-slate-500 hover:text-slate-300',
                )}
                aria-label={isPinned ? 'Unpin' : 'Pin'}
              >
                <Pin className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content="Dismiss">
              <button
                onClick={onDismissClick}
                className="p-1.5 rounded-sm hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors"
                aria-label="Dismiss"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        onConfirm={handleDismiss}
        title="Dismiss critical item?"
        description={`"${item.title}" will be archived and automatically deleted after 30 days.`}
        variant="danger"
      />
    </>
  );
}
