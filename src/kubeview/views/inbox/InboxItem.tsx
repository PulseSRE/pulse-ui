import { useState } from 'react';
import {
  XCircle, AlertTriangle, Info, CheckCircle2, Clock,
  User, Pin, Eye, PauseCircle, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../../engine/formatters';
import { Card } from '../../components/primitives/Card';
import { Badge } from '../../components/primitives/Badge';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import {
  acknowledgeInboxItem,
  claimInboxItem,
  dismissInboxItem,
  pinInboxItem,
  snoozeInboxItem,
} from '../../engine/inboxApi';
import type { InboxItem as InboxItemType } from '../../engine/inboxApi';
import { useInboxStore } from '../../store/inboxStore';
import { useUIStore } from '../../store/uiStore';

const SEVERITY_ICON: Record<string, typeof XCircle> = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500',
};

const SEVERITY_ICON_COLOR: Record<string, string> = {
  critical: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-blue-500',
};

const SNOOZE_OPTIONS = [
  { label: '4 hours', hours: 4 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
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
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);
  const refresh = useInboxStore((s) => s.refresh);
  const addToast = useUIStore((s) => s.addToast);

  const severity = item.severity || 'info';
  const SeverityIcon = SEVERITY_ICON[severity] || Info;
  const isPinned = item.pinned_by.length > 0;
  const hasApproval = !!item.metadata?.has_pending_approval;

  const handleAck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await acknowledgeInboxItem(item.id);
      refresh();
    } catch {
      addToast({ type: 'error', title: 'Failed to acknowledge' });
    }
  };

  const handleClaim = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await claimInboxItem(item.id);
      refresh();
    } catch {
      addToast({ type: 'error', title: 'Failed to claim' });
    }
  };

  const handleSnooze = async (hours: number) => {
    setSnoozeOpen(false);
    try {
      await snoozeInboxItem(item.id, hours);
      refresh();
    } catch {
      addToast({ type: 'error', title: 'Failed to snooze' });
    }
  };

  const handleDismiss = async () => {
    setConfirmDismiss(false);
    try {
      await dismissInboxItem(item.id);
      refresh();
    } catch {
      addToast({ type: 'error', title: 'Failed to dismiss' });
    }
  };

  const handlePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await pinInboxItem(item.id);
      refresh();
    } catch {
      addToast({ type: 'error', title: 'Failed to pin' });
    }
  };

  const onDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (severity === 'critical') {
      setConfirmDismiss(true);
    } else {
      handleDismiss();
    }
  };

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
              {item.status !== 'new' && (
                <>
                  <span>·</span>
                  <Badge variant="outline" className="text-xs capitalize">{item.status.replace('_', ' ')}</Badge>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {item.status === 'new' && (
              <button
                onClick={handleAck}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                title="Acknowledge"
              >
                <Eye className="w-4 h-4" />
              </button>
            )}
            {!item.claimed_by && (
              <button
                onClick={handleClaim}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                title="Claim"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
            )}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setSnoozeOpen(!snoozeOpen); }}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                title="Snooze"
              >
                <PauseCircle className="w-4 h-4" />
              </button>
              {snoozeOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-lg py-1 min-w-[120px]">
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.hours}
                      onClick={(e) => { e.stopPropagation(); handleSnooze(opt.hours); }}
                      className="block w-full text-left px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handlePin}
              className={cn(
                'p-1.5 rounded hover:bg-slate-800 transition-colors',
                isPinned ? 'text-yellow-500' : 'text-slate-500 hover:text-slate-300',
              )}
              title={isPinned ? 'Unpin' : 'Pin'}
            >
              <Pin className="w-4 h-4" />
            </button>
            <button
              onClick={onDismissClick}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors"
              title="Dismiss"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        onConfirm={handleDismiss}
        title="Dismiss critical item?"
        description={`"${item.title}" is critical severity. This will permanently remove it from your inbox.`}
        variant="danger"
      />
    </>
  );
}
