/**
 * GitOpsSetupWizard — full-screen modal wizard that takes users from
 * "I want GitOps" to "my first app is syncing" in 4 steps.
 */

import React, { useEffect, useCallback } from 'react';
import { X, CheckCircle2, ArrowRight, Circle } from 'lucide-react';
import { useGitOpsSetupStore, type WizardStep } from '../../store/gitopsSetupStore';
import { OperatorInstallStep } from './steps/OperatorInstallStep';
import { GitProviderStep } from './steps/GitProviderStep';
import { SelectResourcesStep } from './steps/SelectResourcesStep';
import { CreateApplicationStep } from './steps/CreateApplicationStep';
import { VerificationStep } from './steps/VerificationStep';
import { cn } from '@/lib/utils';

const STEPS: { id: WizardStep; label: string; description: string }[] = [
  { id: 'operator', label: 'Install Operator', description: 'OpenShift GitOps (ArgoCD)' },
  { id: 'git-config', label: 'Configure Git', description: 'Repository, token, branch' },
  { id: 'select-resources', label: 'Select Resources', description: 'Choose what to export' },
  { id: 'first-app', label: 'Create Application', description: 'First ArgoCD app' },
  { id: 'done', label: 'Verification', description: 'Confirm everything works' },
];

export function GitOpsSetupWizard() {
  const { wizardOpen, currentStep, completedSteps, closeWizard, setStep } = useGitOpsSetupStore();

  // Escape to close
  useEffect(() => {
    if (!wizardOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWizard();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [wizardOpen, closeWizard]);

  const goToStep = useCallback(
    (step: WizardStep) => {
      setStep(step);
    },
    [setStep],
  );

  const advanceToNext = useCallback(() => {
    const currentIdx = STEPS.findIndex((s) => s.id === currentStep);
    if (currentIdx < STEPS.length - 1) {
      setStep(STEPS[currentIdx + 1].id);
    }
  }, [currentStep, setStep]);

  if (!wizardOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="GitOps Setup Wizard">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={closeWizard} />

      {/* Modal */}
      <div className="relative m-auto flex w-full max-w-4xl h-[80vh] bg-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
        {/* Left sidebar — step list */}
        <div className="w-64 border-r border-slate-700 p-6 flex flex-col">
          <h2 className="text-lg font-semibold text-slate-100 mb-6">Set Up GitOps</h2>
          <nav className="space-y-1 flex-1">
            {STEPS.map((step, i) => {
              const isCompleted = completedSteps.includes(step.id);
              const isCurrent = currentStep === step.id;
              const canClick = isCompleted || isCurrent;

              return (
                <button
                  key={step.id}
                  onClick={() => canClick && goToStep(step.id)}
                  disabled={!canClick}
                  className={cn(
                    'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors',
                    isCurrent
                      ? 'bg-slate-800 text-slate-100'
                      : canClick
                        ? 'hover:bg-slate-800/50 text-slate-400'
                        : 'text-slate-600 cursor-not-allowed',
                  )}
                >
                  <div className="mt-0.5">
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : isCurrent ? (
                      <ArrowRight className="w-5 h-5 text-blue-400" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{step.description}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="text-xs text-slate-600 mt-4">
            Press Esc to close
          </div>
        </div>

        {/* Right content — active step */}
        <div className="flex-1 flex flex-col overflow-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
            <h3 className="text-sm font-medium text-slate-300">
              Step {STEPS.findIndex((s) => s.id === currentStep) + 1} of {STEPS.length}
            </h3>
            <button
              onClick={closeWizard}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded transition-colors"
              aria-label="Close wizard"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {currentStep === 'operator' && <OperatorInstallStep onComplete={advanceToNext} />}
            {currentStep === 'git-config' && <GitProviderStep onComplete={advanceToNext} />}
            {currentStep === 'select-resources' && <SelectResourcesStep onComplete={advanceToNext} />}
            {currentStep === 'first-app' && <CreateApplicationStep onComplete={advanceToNext} />}
            {currentStep === 'done' && (
              <VerificationStep onClose={closeWizard} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
