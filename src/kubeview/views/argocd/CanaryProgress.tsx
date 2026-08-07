import React from 'react';
import { CheckCircle, Circle, Pause, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Rollout } from '../../engine/types/argoRollouts';

export function CanaryProgress({ rollout }: { rollout: Rollout }) {
  const strategy = rollout.spec?.strategy;
  const status = rollout.status;
  const isCanary = !!strategy?.canary;
  const isPaused = status?.phase === 'Paused';
  const currentStep = status?.currentStepIndex ?? 0;

  if (!isCanary) {
    // Blue-Green summary
    const activeService = strategy?.blueGreen?.activeService || '—';
    const previewService = strategy?.blueGreen?.previewService || '—';
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="text-xs text-slate-500 font-medium">Blue-Green Strategy</div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-emerald-400">Active: {activeService}</span>
          <span className="text-blue-400">Preview: {previewService}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>Stable: {status?.stableRS || '—'}</span>
          <span>Ready: {status?.availableReplicas ?? 0}/{rollout.spec?.replicas ?? 0}</span>
        </div>
      </div>
    );
  }

  // Canary steps
  const steps = strategy.canary?.steps || [];
  const canaryWeight = status?.canaryWeight ?? 0;

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500 font-medium">Canary Progress</div>
        {isPaused && (
          <span className="text-xs px-1.5 py-0.5 rounded-sm bg-amber-900/50 text-amber-300 flex items-center gap-1">
            <Pause className="w-2.5 h-2.5" /> Paused
          </span>
        )}
      </div>

      {/* Traffic weight bar */}
      <div>
        <div className="flex items-center justify-between mb-1 text-xs">
          <span className="text-emerald-400">Stable {100 - canaryWeight}%</span>
          <span className="text-blue-400">Canary {canaryWeight}%</span>
        </div>
        <div className="h-2 bg-emerald-900/50 rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${100 - canaryWeight}%` }} />
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${canaryWeight}%` }} />
        </div>
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-slate-500">Steps ({currentStep}/{steps.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {steps.map((step, i) => {
              const done = i < currentStep;
              const active = i === currentStep;
              const label = step.setWeight != null ? `${step.setWeight}%`
                : step.pause ? (step.pause.duration ? `pause ${step.pause.duration}` : 'pause')
                : step.analysis ? 'analysis'
                : step.experiment ? 'experiment'
                : `step ${i + 1}`;
              return (
                <span
                  key={i}
                  className={cn('inline-flex items-center gap-1 px-2 py-1 text-xs rounded-sm',
                    done ? 'bg-emerald-900/40 text-emerald-300' :
                    active ? 'bg-blue-900/50 text-blue-300 ring-1 ring-blue-500' :
                    'bg-slate-800 text-slate-500'
                  )}
                >
                  {done ? <CheckCircle className="w-2.5 h-2.5" /> :
                   active ? <ArrowRight className="w-2.5 h-2.5" /> :
                   <Circle className="w-2.5 h-2.5" />}
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Replica info */}
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span>Stable RS: {status?.stableRS || '—'}</span>
        <span>Available: {status?.availableReplicas ?? 0}/{rollout.spec?.replicas ?? 0}</span>
      </div>
    </div>
  );
}
