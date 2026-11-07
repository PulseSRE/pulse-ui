import React from 'react';
import { cn } from '@/lib/utils';
import type { CategoryView } from './types';

interface ReadinessScoreProps {
  score: number;
  categories: CategoryView[];
  className?: string;
}

/** Circular progress ring + per-category horizontal bars. */
export function ReadinessScore({ score, categories, className }: ReadinessScoreProps) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const scoreColor =
    score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const strokeColor =
    score >= 80 ? 'stroke-emerald-500' : score >= 50 ? 'stroke-amber-500' : 'stroke-red-500';

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      {/* Circular gauge */}
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="8"
            className="stroke-slate-800"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn('transition-all duration-700', strokeColor)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-3xl font-bold', scoreColor)}>{score}</span>
          <span className="text-xs text-faint">/ 100</span>
        </div>
      </div>

      {/* Category bars */}
      <div className="w-full space-y-2">
        {categories.map((cat) => {
          const total = cat.summary.total;
          const passed = cat.summary.passed;
          const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

          return (
            <div key={cat.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{cat.label}</span>
                <span className="text-faint">
                  {passed}/{total}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    pct === 100
                      ? 'bg-emerald-500'
                      : pct >= 50
                        ? 'bg-amber-500'
                        : 'bg-red-500',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
