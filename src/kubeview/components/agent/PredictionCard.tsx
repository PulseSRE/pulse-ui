import { HardDrive, Cpu, KeyRound, Package, Shield, Lightbulb, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Prediction } from '../../engine/monitorClient';

export type { Prediction };

export interface PredictionCardProps {
  prediction: Prediction;
  onPrevent?: (prediction: Prediction) => void;
  compact?: boolean;
}

const CATEGORY_ICONS: Record<string, typeof HardDrive> = {
  disk: HardDrive,
  cpu: Cpu,
  certs: KeyRound,
  workloads: Package,
};

function getCategoryIcon(category: string): typeof HardDrive {
  const lower = category.toLowerCase();
  return CATEGORY_ICONS[lower] || Shield;
}

function confidenceColor(confidence: number): { bar: string; text: string } {
  if (confidence > 0.8) return { bar: 'bg-emerald-500', text: 'text-emerald-400' };
  if (confidence > 0.5) return { bar: 'bg-amber-500', text: 'text-amber-400' };
  return { bar: 'bg-red-500', text: 'text-red-400' };
}

function formatEta(eta: string): string {
  // If eta is already human-readable, return as-is
  if (eta.startsWith('in ')) return eta;
  // Try to parse as a date
  const target = new Date(eta).getTime();
  if (isNaN(target)) return eta;
  const diff = target - Date.now();
  if (diff <= 0) return 'imminent';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

export function PredictionCard({ prediction, onPrevent, compact }: PredictionCardProps) {
  const Icon = getCategoryIcon(prediction.category);
  const colors = confidenceColor(prediction.confidence);
  const maxResources = 3;
  const visibleResources = prediction.resources.slice(0, maxResources);
  const remaining = prediction.resources.length - maxResources;

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-700 bg-slate-800',
        compact ? 'px-3 py-2' : 'p-4',
      )}
      data-testid={`prediction-card-${prediction.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={cn('rounded-md bg-slate-900 p-1.5 shrink-0', compact && 'p-1')}>
          <Icon className={cn('text-slate-300', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Title + category */}
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={cn('font-medium text-slate-100', compact ? 'text-xs' : 'text-sm')}>
              {prediction.title}
            </h4>
            <span className="text-xs text-slate-500">{prediction.category}</span>
          </div>

          {/* Detail - hidden in compact */}
          {!compact && (
            <p className="mt-1 text-sm text-slate-400">{prediction.detail}</p>
          )}

          {/* Confidence meter + ETA */}
          <div className={cn('flex items-center gap-3', compact ? 'mt-1.5' : 'mt-2')}>
            {/* Confidence bar */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className={cn('text-xs font-medium shrink-0', colors.text)}>
                {Math.round(prediction.confidence * 100)}%
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-slate-700 overflow-hidden" aria-label={`Confidence: ${Math.round(prediction.confidence * 100)}%`}>
                <div
                  className={cn('h-full rounded-full transition-all', colors.bar)}
                  style={{ width: `${prediction.confidence * 100}%` }}
                />
              </div>
            </div>
            {/* ETA */}
            <span className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatEta(prediction.eta)}
            </span>
          </div>

          {/* Resources */}
          {visibleResources.length > 0 && (
            <div className={cn('flex flex-wrap gap-1.5', compact ? 'mt-1' : 'mt-2')}>
              {visibleResources.map((r) => (
                <span
                  key={`${r.kind}-${r.namespace || ''}-${r.name}`}
                  className="inline-flex items-center rounded-sm bg-slate-900 px-1.5 py-0.5 text-xs font-mono text-slate-300"
                >
                  {r.kind}/{r.namespace ? `${r.namespace}/` : ''}{r.name}
                </span>
              ))}
              {remaining > 0 && (
                <span className="inline-flex items-center rounded-sm bg-slate-900 px-1.5 py-0.5 text-xs text-slate-500">
                  +{remaining} more
                </span>
              )}
            </div>
          )}

          {/* Recommended action tip */}
          {prediction.recommendedAction && !compact && (
            <div className="mt-2 flex items-start gap-1.5 rounded-sm bg-blue-950/30 border border-blue-900/50 px-2.5 py-1.5">
              <Lightbulb className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="text-xs text-blue-300">{prediction.recommendedAction}</span>
            </div>
          )}

          {/* Prevent button */}
          {onPrevent && (
            <div className={cn(compact ? 'mt-1.5' : 'mt-3')}>
              <button
                onClick={() => onPrevent(prediction)}
                className={cn(
                  'flex items-center gap-1 rounded-sm bg-blue-700 text-white transition-colors hover:bg-blue-600',
                  compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
                )}
              >
                Prevent Now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
