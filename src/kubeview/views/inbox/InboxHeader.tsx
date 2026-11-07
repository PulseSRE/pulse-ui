import { Inbox, Plus } from 'lucide-react';
import { PageHeader } from '../../components/primitives/PageHeader';
import { cn } from '@/lib/utils';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { useInboxStore } from '../../store/inboxStore';
import { InboxResetButton } from './InboxResetButton';
import { AI_ACCENT } from '../../components/agent/aiTokens';

const SEVERITY_BADGES: Array<{ key: string; label: string; color: string }> = [
  { key: 'critical', label: 'Critical', color: 'bg-red-500/15 text-red-400' },
  { key: 'warning', label: 'Warning', color: 'bg-yellow-500/15 text-yellow-400' },
  { key: 'info', label: 'Info', color: 'bg-blue-500/15 text-blue-400' },
];

export function InboxHeader({
  onNewTask,
}: {
  onNewTask: () => void;
}) {
  const stats = useInboxStore((s) => s.stats);

  const newCount = stats.new ?? 0;
  const totalOpen = stats.needs_attention ?? 0;

  const hasSeverityData = SEVERITY_BADGES.some((s) => (stats[s.key] ?? 0) > 0);

  return (
    <div className="px-4 py-3 border-b border-slate-800">
      <PageHeader
        icon={<Inbox className="w-6 h-6 text-blue-400" />}
        title="Inbox"
        subtitle="Findings, tasks and approvals that need a person"
        meta={<>
          {newCount > 0 && (
            <Badge variant="default" className="bg-blue-600 text-white text-xs">
              {newCount} new
            </Badge>
          )}
          {/* The needs-attention count is on the "Needs Attention" filter in the
              Inbox tab; only the deduplicated figure, which says something new, is here. */}
          {(stats.unique_issues ?? 0) > 0 && (stats.unique_issues ?? 0) < totalOpen && (
            <span className="text-xs text-slate-500">{stats.unique_issues} unique issues</span>
          )}
          {(stats.agent_reviewing ?? 0) > 0 && (
            <div className={cn('flex items-center gap-1.5 text-xs', AI_ACCENT.text)}>
              <span className="relative flex h-2 w-2">
                <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', AI_ACCENT.dot)} />
                <span className={cn('relative inline-flex rounded-full h-2 w-2', AI_ACCENT.dot)} />
              </span>
              Agent processing {stats.agent_reviewing} item{stats.agent_reviewing !== 1 ? 's' : ''}...
            </div>
          )}
          {hasSeverityData && (
            <div className="flex items-center gap-1.5 ml-2">
              {SEVERITY_BADGES.map((sev) => {
                const count = stats[sev.key] ?? 0;
                if (count === 0) return null;
                return (
                  <span key={sev.key} className={cn('px-2 py-0.5 rounded-full text-xs font-medium', sev.color)}>
                    {count} {sev.label}
                  </span>
                );
              })}
            </div>
          )}
        </>}
        actions={<>
          <InboxResetButton />
          <Button size="sm" onClick={onNewTask}>
            <Plus className="w-4 h-4 mr-1" />
            New Task
          </Button>
        </>}
      />
    </div>
  );
}
