import { cn } from '@/lib/utils';
import type { BlastRadiusSpec } from '../../engine/agentComponents';

const STATUS_STYLES = {
  degraded: { text: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-800' },
  healthy: { text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-800' },
  retrying: { text: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-800' },
  paused: { text: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-700' },
} as const;

export function AgentBlastRadius({ spec }: { spec: BlastRadiusSpec }) {
  if (!spec.items || spec.items.length === 0) {
    return (
      <div className="my-2 border border-slate-700 rounded-lg p-4 text-center text-xs text-slate-500">
        No downstream dependencies detected
      </div>
    );
  }

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden min-w-0">
      {spec.title && (
        <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700 text-xs font-semibold text-slate-200 tracking-wide">
          {spec.title}
        </div>
      )}
      <div role="list" className="divide-y divide-slate-800/60">
        {spec.items.map((item, i) => {
          const style = STATUS_STYLES[item.status] || STATUS_STYLES.healthy;
          return (
            <div
              key={i}
              role="listitem"
              aria-label={`${item.kind_abbrev} ${item.name}: ${item.status} — ${item.status_detail}`}
              className="px-3 py-2.5 flex items-center gap-3"
            >
              <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-sm border', style.bg, style.text, style.border)}>
                {item.kind_abbrev}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200 truncate">{item.name}</span>
                  <span className={cn('text-[10px] px-1 rounded-sm', style.bg, style.text)}>
                    {item.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{item.relationship}</div>
              </div>
              <span className="text-xs text-slate-400 shrink-0">{item.status_detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
