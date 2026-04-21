import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { useInboxStore } from '../../store/inboxStore';

type Preset = 'active_incidents' | 'needs_approval' | 'my_items' | 'unclaimed';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'active_incidents', label: 'Active Incidents' },
  { id: 'needs_approval', label: 'Needs Approval' },
  { id: 'my_items', label: 'My Items' },
  { id: 'unclaimed', label: 'Unclaimed' },
];

export function InboxHeader({
  onNewTask,
}: {
  onNewTask: () => void;
}) {
  const stats = useInboxStore((s) => s.stats);
  const activePreset = useInboxStore((s) => s.activePreset);
  const setPreset = useInboxStore((s) => s.setPreset);

  const newCount = stats.new ?? 0;
  const totalOpen = (stats.total ?? 0) - (stats.resolved ?? 0) - (stats.archived ?? 0);

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
            <span className="text-xs text-slate-500">{totalOpen} open</span>
          )}
        </div>
        <Button size="sm" onClick={onNewTask}>
          <Plus className="w-4 h-4 mr-1" />
          New Task
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setPreset(activePreset === preset.id ? null : preset.id)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-full transition-colors',
              activePreset === preset.id
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
