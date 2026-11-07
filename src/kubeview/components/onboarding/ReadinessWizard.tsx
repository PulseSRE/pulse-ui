import React from 'react';
import { CheckCircle2, ArrowRight, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReadinessScore } from './ReadinessScore';
import { WaiverDialog } from './WaiverDialog';
import { CategoryStep } from './steps/CategoryStep';
import type { ReadinessCategory, CategoryView, Waiver } from './types';
import type { WaiverStorage } from '../../engine/readiness/waivers';

interface ReadinessWizardProps {
  score: number;
  categories: CategoryView[];
  /** Save a waiver; the dialog stays open, showing the error, if this throws. */
  onWaive: (gateId: string, reason: string, expiresAt: number | null) => void | Promise<void>;
  onReVerify: (gateId: string) => void;
  /** Waivers in force, keyed by gate id, for showing who waived what and when. */
  waivers?: Record<string, Waiver>;
  /** Where waivers are kept; told to the person waiving. */
  waiverStorage?: WaiverStorage;
  /** Why the waiver list could not be loaded, if it could not. */
  waiverLoadError?: string;
  onUnwaive?: (gateId: string) => void | Promise<void>;
  onSwitchToChecklist: () => void;
}

const STEP_ORDER: ReadinessCategory[] = [
  'prerequisites', 'security', 'reliability', 'observability', 'operations', 'gitops',
];

/** 6-step wizard with non-linear sidebar navigation — modeled on GitOpsSetupWizard. */
export function ReadinessWizard({ score, categories, onWaive, onReVerify, onSwitchToChecklist, waivers, waiverStorage, waiverLoadError, onUnwaive }: ReadinessWizardProps) {
  const [activeStep, setActiveStep] = React.useState<ReadinessCategory>('prerequisites');
  const [waiverTarget, setWaiverTarget] = React.useState<string | null>(null);

  const activeCategory = categories.find((c) => c.id === activeStep);

  const waiverGate = waiverTarget
    ? categories.flatMap((c) => c.gates).find((g) => g.id === waiverTarget)
    : null;

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* Left sidebar */}
      <div className="w-60 shrink-0 space-y-4">
        <ReadinessScore score={score} categories={categories} />

        <nav className="space-y-1">
          {STEP_ORDER.map((stepId) => {
            const cat = categories.find((c) => c.id === stepId);
            if (!cat) return null;

            const allPassed = cat.summary.passed === cat.summary.total;
            const isCurrent = activeStep === stepId;

            return (
              <button
                key={stepId}
                onClick={() => setActiveStep(stepId)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors',
                  isCurrent
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200',
                )}
              >
                {allPassed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : isCurrent ? (
                  <ArrowRight className="w-4 h-4 text-blue-400 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-slate-600 shrink-0" />
                )}
                <span className="truncate">{cat.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          onClick={onSwitchToChecklist}
          className="w-full text-xs text-slate-500 hover:text-slate-300 transition-colors mt-4"
        >
          Switch to checklist view
        </button>
      </div>

      {/* Right content */}
      <div className="flex-1 min-w-0">
        {activeCategory && (
          <CategoryStep
            category={activeCategory}
            onReVerify={onReVerify}
            onWaive={(gateId) => setWaiverTarget(gateId)}
            waivers={waivers}
            onUnwaive={onUnwaive}
          />
        )}

        {/* Step navigation */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-slate-800">
          <button
            onClick={() => {
              const idx = STEP_ORDER.indexOf(activeStep);
              if (idx > 0) setActiveStep(STEP_ORDER[idx - 1]);
            }}
            disabled={activeStep === STEP_ORDER[0]}
            className={cn(
              'px-4 py-2 text-sm rounded-lg transition-colors',
              activeStep === STEP_ORDER[0]
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-300 bg-slate-800 hover:bg-slate-700',
            )}
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            {STEP_ORDER.indexOf(activeStep) + 1} / {STEP_ORDER.length}
          </span>
          <button
            onClick={() => {
              const idx = STEP_ORDER.indexOf(activeStep);
              if (idx < STEP_ORDER.length - 1) setActiveStep(STEP_ORDER[idx + 1]);
            }}
            disabled={activeStep === STEP_ORDER[STEP_ORDER.length - 1]}
            className={cn(
              'px-4 py-2 text-sm rounded-lg font-medium transition-colors',
              activeStep === STEP_ORDER[STEP_ORDER.length - 1]
                ? 'text-slate-600 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white',
            )}
          >
            Next
          </button>
        </div>
      </div>

      {/* Waiver modal */}
      <WaiverDialog
        gateTitle={waiverGate?.title || ''}
        open={waiverTarget !== null}
        onClose={() => setWaiverTarget(null)}
        storage={waiverStorage}
        loadError={waiverLoadError}
        onConfirm={async (reason, expiresAt) => {
          if (!waiverTarget) return;
          await onWaive(waiverTarget, reason, expiresAt ?? null);
          setWaiverTarget(null);
        }}
      />
    </div>
  );
}
