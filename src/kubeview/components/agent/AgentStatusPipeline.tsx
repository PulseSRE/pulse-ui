import React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle } from 'lucide-react';
import type { StatusPipelineSpec } from '../../engine/agentComponents';

export function AgentStatusPipeline({ spec }: { spec: StatusPipelineSpec }) {
  const { steps, current } = spec;

  return (
    <div className="flex items-center gap-0 w-full py-2" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={steps.length - 1}>
      {steps.map((step, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div
                className={cn(
                  'flex-1 h-0.5 min-w-[12px]',
                  isDone ? 'bg-emerald-500' : 'bg-slate-700',
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors',
                  isDone && 'bg-emerald-500/20 border-emerald-500 text-emerald-400',
                  isActive && 'bg-blue-500/20 border-blue-500 text-blue-400 ring-2 ring-blue-500/30',
                  !isDone && !isActive && 'bg-slate-800 border-slate-600 text-faint',
                )}
              >
                {isDone ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] leading-tight text-center max-w-[72px]',
                  isDone && 'text-emerald-400',
                  isActive && 'text-blue-400 font-semibold',
                  !isDone && !isActive && 'text-faint',
                )}
              >
                {step}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
