import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEGRADED_MESSAGES } from '../../engine/degradedMode';
import type { DegradedReason } from '../../engine/degradedMode';

interface DegradedBannerProps {
  reason: DegradedReason;
  onRetry?: () => void;
  className?: string;
  collapsible?: boolean;
}

export function DegradedBanner({ reason, onRetry, className, collapsible = false }: DegradedBannerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const info = DEGRADED_MESSAGES[reason];

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-amber-200">{info.title}</span>
          {collapsible && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="rounded-sm p-0.5 text-amber-400 transition-colors hover:bg-amber-500/20"
              aria-label={collapsed ? 'Expand details' : 'Collapse details'}
            >
              {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
          )}
        </div>
        {!collapsed && <p className="mt-0.5 text-amber-300/80">{info.description}</p>}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}
