import { cn } from '@/lib/utils';
import { useInboxStore } from '../../store/inboxStore';

type Preset = 'needs_attention' | 'agent_cleared' | 'my_items' | 'archived' | 'all';

const PRESETS: Array<{ id: Preset; label: string; countKey: string }> = [
  { id: 'needs_attention', label: 'Needs Attention', countKey: 'needs_attention' },
  { id: 'agent_cleared', label: 'Agent Cleared', countKey: 'agent_cleared' },
  { id: 'my_items', label: 'My Items', countKey: 'claimed' },
  { id: 'archived', label: 'Archived', countKey: 'archived' },
  { id: 'all', label: 'All', countKey: 'total' },
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

/**
 * The quick filters for the Inbox list. They only filter the Inbox tab, so
 * they live inside it rather than above the tab list, where they read as if
 * they also filtered Approvals and Activity.
 */
export function InboxPresets({ className }: { className?: string }) {
  const stats = useInboxStore((s) => s.stats);
  const activePreset = useInboxStore((s) => s.activePreset);
  const setPreset = useInboxStore((s) => s.setPreset);
  const currentUser = useInboxStore((s) => s.currentUser);

  return (
    <div className={cn('flex items-center gap-2', className)} role="group" aria-label="Quick filters">
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
                ? 'bg-blue-600/20 text-blue-200'
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
  );
}
