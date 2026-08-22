import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { useInboxStore } from '../../store/inboxStore';
import { InboxResetButton } from './InboxResetButton';

type Preset = 'needs_attention' | 'agent_cleared' | 'my_items' | 'archived' | 'all';

const PRESETS: Array<{ id: Preset; label: string; countKey: string }> = [
  { id: 'needs_attention', label: 'Needs Attention', countKey: 'needs_attention' },
  { id: 'agent_cleared', label: 'Agent Cleared', countKey: 'agent_cleared' },
  { id: 'my_items', label: 'My Items', countKey: 'claimed' },
  { id: 'archived', label: 'Archived', countKey: 'archived' },
  { id: 'all', label: 'All', countKey: 'total' },
];

const SEVERITY_BADGES: Array<{ key: string; label: string; color: string }> = [
  { key: 'critical', label: 'Critical', color: 'bg-red-500/15 text-red-400' },
  { key: 'warning', label: 'Warning', color: 'bg-yellow-500/15 text-yellow-400' },
  { key: 'info', label: 'Info', color: 'bg-blue-500/15 text-blue-400' },
];

/**
 * The agent falls back to `user-<16 hex>` when it cannot resolve a real name —
 * a stable, unforgeable identity, and exactly the right thing to key data on.
 * It is not a thing to show a person. Observed live: the filter pill read
 * "My Items (user-5451b787f74974ba)", which tells the reader nothing they did
 * not already know and costs half the pill's width to say it.
 */
const OPAQUE_IDENTITY = /^user-[0-9a-f]{16}$/;

function myItemsLabel(currentUser: string | null | undefined): string {
  if (!currentUser || OPAQUE_IDENTITY.test(currentUser)) return 'My Items';
  return `My Items (${currentUser})`;
}

export function InboxHeader({
  onNewTask,
}: {
  onNewTask: () => void;
}) {
  const stats = useInboxStore((s) => s.stats);
  const activePreset = useInboxStore((s) => s.activePreset);
  const setPreset = useInboxStore((s) => s.setPreset);
  const currentUser = useInboxStore((s) => s.currentUser);

  const newCount = stats.new ?? 0;
  const totalOpen = stats.needs_attention ?? 0;

  const hasSeverityData = SEVERITY_BADGES.some((s) => (stats[s.key] ?? 0) > 0);

  return (
    <div className="px-4 py-3 border-b border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-200">Inbox</h1>
          {newCount > 0 && (
            <Badge variant="default" className="bg-violet-600 text-white text-xs">
              {newCount} new
            </Badge>
          )}
          {totalOpen > 0 && (
            <span className="text-xs text-slate-500">
              {totalOpen} open
              {(stats.unique_issues ?? 0) > 0 && (stats.unique_issues ?? 0) < totalOpen && (
                <> ({stats.unique_issues} unique)</>
              )}
            </span>
          )}
          {(stats.agent_reviewing ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-violet-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
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
        </div>
        <div className="flex items-center gap-2">
          <InboxResetButton />
          <Button size="sm" onClick={onNewTask}>
            <Plus className="w-4 h-4 mr-1" />
            New Task
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2" role="group" aria-label="Quick filters">
        {PRESETS.map((preset) => {
          const count = stats[preset.countKey] ?? 0;
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => setPreset(isActive ? null : preset.id)}
              aria-pressed={isActive}
              className={cn(
                'px-3 py-1.5 text-xs rounded-full transition-colors inline-flex items-center gap-1.5',
                isActive
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300',
              )}
            >
              {preset.id === 'my_items' ? myItemsLabel(currentUser) : preset.label}
              {count > 0 && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none',
                  isActive ? 'bg-white/20' : 'bg-slate-700 text-slate-300',
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
