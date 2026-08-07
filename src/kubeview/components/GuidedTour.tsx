import { useState, useEffect, useCallback } from 'react';
import { HeartPulse, Siren, Bot, Shield, Sparkles, ChevronRight, ChevronLeft, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const STORAGE_KEY = 'openshiftpulse-tour-completed';

interface TourStep {
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to Pulse',
    description: 'Your cluster health at a glance. The Posture Bar shows if everything is OK.',
    icon: HeartPulse,
    iconColor: 'text-rose-400',
    iconBg: 'bg-rose-500/15',
  },
  {
    title: 'Incident Center',
    description: 'All alerts, findings, and auto-fix results in one place. The Active tab shows what needs attention now.',
    icon: Siren,
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/15',
  },
  {
    title: 'AI Agent',
    description: 'Press Cmd+J to open the AI dock. Ask questions about your cluster in natural language.',
    icon: Bot,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/15',
  },
  {
    title: 'Pulse Agent',
    description: 'Control what the agent can do automatically in Pulse Agent. Start at Level 1 (observe only).',
    icon: Shield,
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/15',
  },
  {
    title: "You're Ready",
    description: 'Navigate with Cmd+K, browse resources with Cmd+B. Your cluster is in good hands.',
    icon: Sparkles,
    iconColor: 'text-violet-400',
    iconBg: 'bg-violet-500/15',
  },
];

export function GuidedTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, dismiss]);

  if (!visible) return null;

  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  const isFirst = step === 0;
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={dismiss}
    >
      <div
        className="relative mx-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          aria-label="Close tour"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Content */}
        <div className="flex flex-col items-center px-6 pb-5 pt-8 text-center">
          <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${current.iconBg}`}>
            <Icon className={`h-7 w-7 ${current.iconColor}`} />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-white">{current.title}</h2>
          <p className="text-sm leading-relaxed text-slate-400">{current.description}</p>
        </div>

        {/* Footer: dots + nav */}
        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
          <button
            onClick={dismiss}
            className="text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            Skip tour
          </button>

          {/* Progress dots */}
          <div className="flex gap-1.5">
            {TOUR_STEPS.map((_, i) => (
              <span
                key={i}
                className={`block h-1.5 rounded-full transition-all ${
                  i === step ? 'w-4 bg-blue-500' : 'w-1.5 bg-slate-700'
                }`}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div className="flex gap-1.5">
            {!isFirst && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Previous step"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {isLast ? (
              <button
                onClick={dismiss}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
              >
                Get Started
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Next step"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
