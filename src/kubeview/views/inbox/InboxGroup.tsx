import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InboxItem } from './InboxItem';
import type { InboxGroup as InboxGroupType } from '../../engine/inboxApi';

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-yellow-500',
  info: 'bg-blue-500',
};

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
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
        <span className={cn('w-2 h-2 rounded-full', SEVERITY_DOT[group.top_severity] || 'bg-slate-500')} />
        <span className="text-sm font-medium text-slate-300 truncate">
          {group.correlation_key}
        </span>
        <span className="text-xs text-slate-500 ml-auto flex-shrink-0">
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
