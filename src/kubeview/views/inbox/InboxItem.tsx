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

const TYPE_LABELS: Record<string, string> = {
  finding: 'Finding',
  task: 'Task',
  alert: 'Alert',
  assessment: 'Assessment',
};

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
  const hasApproval = !!item.metadata?.has_pending_approval;

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
          <SeverityIcon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', SEVERITY_ICON_COLOR[severity])} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-200 truncate">{item.title}</span>
              {item.namespace && (
                <Badge variant="outline" className="text-xs">{item.namespace}</Badge>
              )}
              {item.status === 'agent_reviewing' && (
                <Tooltip content="Agent is investigating">
                  <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse flex-shrink-0" />
                </Tooltip>
              )}
              {item.status === 'agent_cleared' && (
                <Tooltip content={String(item.metadata?.dismiss_reason || 'Cleared by agent')}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                </Tooltip>
              )}
              {item.status === 'agent_review_failed' && (
                <Tooltip content={String(item.metadata?.agent_error || 'Agent analysis failed')}>
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                </Tooltip>
              )}
              {item.status !== 'agent_reviewing' && item.status !== 'agent_cleared' && !!item.metadata?.triaged && (
                <Tooltip content={`AI: ${String(item.metadata.triage_action || 'triaged')} · ${String(item.metadata.triage_urgency || '')}`}>
                  <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
                </Tooltip>
              )}
              {hasApproval && (
                <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" title="Pending approval" />
              )}
              {isPinned && (
                <Pin className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
              )}
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
              <span>{TYPE_LABELS[item.item_type] || item.item_type}</span>
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
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {item.status === 'new' && (
              <Tooltip content="Acknowledge">
                <button
                  onClick={(e) => { e.stopPropagation(); acknowledge(item.id); }}
                  className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
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
                  className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
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
                    className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
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
                  'p-1.5 rounded hover:bg-slate-800 transition-colors',
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
                className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors"
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
        description={`"${item.title}" will be permanently removed from your inbox.`}
        variant="danger"
      />
    </>
  );
}
