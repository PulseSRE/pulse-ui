import React from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import type { ResourceProjection } from './useCapacityProjections';

const LABELS: Record<string, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk', pods: 'Pods' };

export function ExhaustionCard({ projection }: { projection: ResourceProjection }) {
  const { resource, currentRatio, projectedRatio, daysUntilExhaustion, growthPerDay } = projection;
  const pct = currentRatio !== null ? Math.round(currentRatio * 100) : null;
  // No Prometheus data is "No data", never a green "Stable".
  const noData = daysUntilExhaustion === null && (currentRatio === null || projectedRatio === null);
  const isStable = daysUntilExhaustion === null && !noData;
  const isCritical = daysUntilExhaustion !== null && daysUntilExhaustion <= 14;
  const isWarning = daysUntilExhaustion !== null && daysUntilExhaustion > 14 && daysUntilExhaustion <= 30;

  const borderColor = isCritical ? 'border-red-800' : isWarning ? 'border-amber-800' : '';

  return (
    <Card className={cn('p-3', borderColor)}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{LABELS[resource]}</span>
        {isCritical && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
      </div>

      {/* Days until exhaustion */}
      <div className={cn('text-xl font-bold',
        isCritical ? 'text-red-400' :
        isWarning ? 'text-amber-400' :
        isStable ? 'text-emerald-400' :
        noData ? 'text-slate-500' :
        'text-slate-100'
      )}>
        {daysUntilExhaustion !== null ? `${daysUntilExhaustion}d` : noData ? 'No data' : 'Stable'}
      </div>

      {/* Current usage + trend */}
      <div className="flex items-center gap-1.5 mt-1">
        {pct !== null && <span className="text-xs text-slate-500">{pct}% used</span>}
        {growthPerDay !== null && (
          <span className={cn('flex items-center gap-0.5 text-xs',
            growthPerDay > 0.005 ? 'text-red-400' : growthPerDay > 0 ? 'text-amber-400' : 'text-emerald-400'
          )}>
            {growthPerDay > 0 ? <TrendingUp className="w-3 h-3" /> :
             growthPerDay < 0 ? <TrendingDown className="w-3 h-3" /> :
             <Minus className="w-3 h-3" />}
            {Math.abs(growthPerDay * 100).toFixed(2)}%/d
          </span>
        )}
      </div>
    </Card>
  );
}
