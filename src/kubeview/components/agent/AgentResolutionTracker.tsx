import { CheckCircle, Loader2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResolutionTrackerSpec } from '../../engine/agentComponents';

const STATUS_CONFIG = {
  done: { Icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'completed' },
  running: { Icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/15', label: 'in progress' },
  pending: { Icon: Circle, color: 'text-slate-500', bg: 'bg-slate-500/15', label: 'pending' },
} as const;

export function AgentResolutionTracker({ spec }: { spec: ResolutionTrackerSpec }) {
  if (!spec.steps || spec.steps.length === 0) {
    return (
      <div className="my-2 border border-slate-700 rounded-lg p-4 text-center text-xs text-slate-500">
        No resolution steps yet
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
        {spec.steps.map((step, i) => {
          const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
          const { Icon } = config;
          return (
            <div key={i} role="listitem" className="px-3 py-2.5 flex gap-3">
              <div className={cn('flex items-center justify-center w-5 h-5 rounded-full shrink-0 mt-0.5', config.bg)}>
                <Icon
                  className={cn('h-3 w-3', config.color, step.status === 'running' && 'animate-spin')}
                  aria-label={config.label}
                />
              </div>
              <div className="flex-1 min-w-0" aria-live={step.status === 'running' ? 'polite' : undefined}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{step.title}</span>
                  {step.timestamp && (
                    <span className="text-[10px] text-slate-500">{step.timestamp}</span>
                  )}
                </div>
                {step.detail && (
                  <div className="text-xs text-slate-400 mt-0.5">{step.detail}</div>
                )}
                {step.output && (
                  <pre className="mt-1 p-2 bg-slate-950 rounded-sm text-[11px] text-slate-300 font-mono overflow-x-auto max-h-32 whitespace-pre-wrap">
                    {step.output}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
