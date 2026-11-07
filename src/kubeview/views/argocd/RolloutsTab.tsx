import React from 'react';
import {
  CheckCircle, XCircle, RefreshCw, Pause, HelpCircle,
  ArrowRight, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Rollout } from '../../engine/types';
import type { K8sResource } from '../../engine/renderers';
import { Card } from '../../components/primitives/Card';
import { CanaryProgress } from './CanaryProgress';
import { statusClasses } from '../../engine/statusColors';

interface RolloutsTabProps {
  rollouts: K8sResource[];
  go: (path: string, title: string) => void;
}

// Icons per phase; colours come from the one status map (engine/statusColors).
const PHASE_ICONS: Record<string, React.ElementType> = {
  Healthy: CheckCircle,
  Paused: Pause,
  Degraded: XCircle,
  Progressing: RefreshCw,
};

function getStrategyType(rollout: Rollout): string {
  if (rollout.spec?.strategy?.canary) return 'Canary';
  if (rollout.spec?.strategy?.blueGreen) return 'BlueGreen';
  return 'Unknown';
}

const STRATEGY_COLORS: Record<string, string> = {
  Canary: 'bg-indigo-900/50 text-indigo-300',
  BlueGreen: 'bg-cyan-900/50 text-cyan-300',
  Unknown: 'bg-slate-800 text-slate-400',
};

export function RolloutsTab({ rollouts, go }: RolloutsTabProps) {
  const [expandedRollout, setExpandedRollout] = React.useState<string | null>(null);

  if (rollouts.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <HelpCircle className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">No Argo Rollouts found</p>
          <p className="text-faint text-xs mt-1">
            Create a Rollout resource to manage canary or blue-green deployments
          </p>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <div className="divide-y divide-slate-800">
        {rollouts.map((raw) => {
          const rollout = raw as Rollout;
          const phase = rollout.status?.phase || 'Unknown';
          const strategy = getStrategyType(rollout);
          const PhaseIcon = PHASE_ICONS[phase] || HelpCircle;
          const phaseColor = statusClasses(phase).text;
          const desiredReplicas = rollout.spec?.replicas ?? 1;
          const readyReplicas = rollout.status?.readyReplicas ?? 0;
          const currentStep = rollout.status?.currentStepIndex;
          const totalSteps = rollout.spec?.strategy?.canary?.steps?.length;
          const key = `${rollout.metadata.namespace}/${rollout.metadata.name}`;
          const isExpanded = expandedRollout === key;

          return (
            <div key={rollout.metadata.uid || key}>
              <button
                type="button"
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer w-full text-left"
                onClick={() => setExpandedRollout(isExpanded ? null : key)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <PhaseIcon className={cn('w-5 h-5 shrink-0', phaseColor)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          go(
                            `/r/argoproj.io~v1alpha1~rollouts/${rollout.metadata.namespace}/${rollout.metadata.name}`,
                            rollout.metadata.name
                          );
                        }}
                        className="text-sm font-medium text-slate-200 hover:text-blue-400 transition-colors"
                      >
                        {rollout.metadata.name}
                      </button>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', STRATEGY_COLORS[strategy])}>
                        {strategy}
                      </span>
                      <span className={cn(
                        'text-xs px-1.5 py-0.5 rounded-sm',
                        phase === 'Healthy' ? 'bg-emerald-900/50 text-emerald-300' :
                        phase === 'Paused' ? 'bg-amber-900/50 text-amber-300' :
                        phase === 'Degraded' ? 'bg-red-900/50 text-red-300' :
                        phase === 'Progressing' ? 'bg-blue-900/50 text-blue-300' :
                        'bg-slate-800 text-slate-400'
                      )}>
                        {phase}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-faint">{rollout.metadata.namespace}</span>
                      {strategy === 'Canary' && currentStep !== undefined && totalSteps && (
                        <span className="text-xs text-faint">
                          Step {currentStep}/{totalSteps}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-faint">
                    {readyReplicas}/{desiredReplicas} ready
                  </span>
                  <ChevronDown className={cn(
                    'w-3.5 h-3.5 text-slate-600 transition-transform',
                    isExpanded && 'rotate-180'
                  )} />
                </div>
              </button>

              {isExpanded && strategy === 'Canary' && (
                <div className="px-4 pb-4 border-t border-slate-800/50 bg-slate-800/10">
                  <CanaryProgress rollout={rollout} />
                </div>
              )}

              {isExpanded && strategy === 'BlueGreen' && (
                <div className="px-4 pb-4 border-t border-slate-800/50 bg-slate-800/10">
                  <div className="pt-3 space-y-2">
                    <div className="text-xs text-faint">Blue-Green Details</div>
                    <div className="flex gap-4 text-xs">
                      <div>
                        <span className="text-faint">Active Service: </span>
                        <span className="text-emerald-400 font-mono">
                          {rollout.spec?.strategy?.blueGreen?.activeService || '—'}
                        </span>
                      </div>
                      {rollout.spec?.strategy?.blueGreen?.previewService && (
                        <div>
                          <span className="text-faint">Preview Service: </span>
                          <span className="text-blue-400 font-mono">
                            {rollout.spec.strategy.blueGreen.previewService}
                          </span>
                        </div>
                      )}
                    </div>
                    {rollout.status?.blueGreen && (
                      <div className="flex gap-4 text-xs">
                        {rollout.status.blueGreen.activeSelector && (
                          <div>
                            <span className="text-faint">Active RS: </span>
                            <span className="text-slate-400 font-mono">
                              {rollout.status.blueGreen.activeSelector.slice(0, 10)}
                            </span>
                          </div>
                        )}
                        {rollout.status.blueGreen.previewSelector && (
                          <div>
                            <span className="text-faint">Preview RS: </span>
                            <span className="text-slate-400 font-mono">
                              {rollout.status.blueGreen.previewSelector.slice(0, 10)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
