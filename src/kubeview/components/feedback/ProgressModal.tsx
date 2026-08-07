import { useEffect, useRef } from 'react';
import { Circle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgressStep {
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  detail?: string;
}

interface ProgressModalProps {
  open: boolean;
  title: string;
  steps: ProgressStep[];
  progress: number; // 0-100
  onCancel?: () => void;
  onBackground?: () => void;
}

function StepIcon({ status }: { status: ProgressStep['status'] }) {
  switch (status) {
    case 'pending':
      return <Circle className="h-5 w-5 text-slate-500" />;
    case 'running':
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    case 'complete':
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />;
  }
}

export function ProgressModal({
  open,
  title,
  steps,
  progress,
  onCancel,
  onBackground,
}: ProgressModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Trap focus within dialog
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = dialogRef.current?.querySelectorAll(
        'button:not([disabled])'
      );
      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);

    return () => {
      document.removeEventListener('keydown', handleTab);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg bg-slate-800 shadow-xl"
        role="dialog"
        aria-labelledby="progress-title"
      >
        {/* Header with progress bar */}
        <div className="border-b border-slate-700 p-6 pb-4">
          <h2 id="progress-title" className="mb-4 text-lg font-semibold text-slate-100">
            {title}
          </h2>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-right text-sm text-slate-400">
              {Math.round(progress)}%
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="max-h-[400px] overflow-y-auto p-6">
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="shrink-0 pt-0.5">
                  <StepIcon status={step.status} />
                </div>
                <div className="flex-1 space-y-1">
                  <div
                    className={cn(
                      'font-medium',
                      step.status === 'complete' && 'text-slate-100',
                      step.status === 'running' && 'text-blue-400',
                      step.status === 'error' && 'text-red-400',
                      step.status === 'pending' && 'text-slate-400'
                    )}
                  >
                    {step.label}
                  </div>
                  {step.detail && (
                    <div className="text-sm text-slate-400">{step.detail}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-slate-700 p-4">
          {onBackground && (
            <button
              onClick={onBackground}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
            >
              Run in Background
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
