import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InboxItem } from './InboxItem';
import type { InboxGroup as InboxGroupType } from '../../engine/inboxApi';
import { statusClasses } from '../../engine/statusColors';


export function InboxGroup({
  group,
  focusedItemId,
}: {
  group: InboxGroupType;
  focusedItemId?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
        <span className={cn('w-2 h-2 rounded-full', statusClasses(group.top_severity).solid)} />
        <span className="text-sm font-medium text-slate-300 truncate">
          {group.correlation_key}
        </span>
        <span className="text-xs text-faint ml-auto shrink-0">
          {group.count} items
        </span>
      </button>

      {expanded && (
        <div className="space-y-1 pl-4">
          {group.items.map((item) => (
            <InboxItem
              key={item.id}
              item={item}
              focused={item.id === focusedItemId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
