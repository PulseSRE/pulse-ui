/**
 * AIOnboarding — first-run capability card for AI features.
 * Shows once, then persists dismissal via onboardingStore.
 */

import { Bot, Shield, BarChart3, Wrench, X } from 'lucide-react';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useUIStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { useTrustStore } from '../../store/trustStore';
import { AIIconStatic, AI_ACCENT, aiGlowClass, AIBadge } from './AIBranding';
import { cn } from '@/lib/utils';

const capabilities = [
  { icon: Bot, label: 'Diagnose issues', description: 'Ask why a pod is failing or a node is under pressure' },
  { icon: Shield, label: 'Security scanning', description: 'Audit RBAC, SCCs, images, network policies, and secrets' },
  { icon: BarChart3, label: 'Generate dashboards', description: 'Create custom views from natural language queries' },
  { icon: Wrench, label: 'Take actions', description: 'Scale, restart, rollback, cordon — with confirmation gates' },
];

interface AIOnboardingProps {
  /** Compact mode shows a single-line banner instead of full card */
  compact?: boolean;
  className?: string;
}

export function AIOnboarding({ compact = false, className }: AIOnboardingProps) {
  const { aiOnboardingSeen, dismissOnboarding } = useOnboardingStore();
  const expandAISidebar = useUIStore((s) => s.expandAISidebar);
  const setAISidebarMode = useUIStore((s) => s.setAISidebarMode);
  const connectAndSend = useAgentStore((s) => s.connectAndSend);
  const setTrustLevel = useTrustStore((s) => s.setTrustLevel);

  if (aiOnboardingSeen) return null;

  const tryIt = () => {
    setTrustLevel(1);
    connectAndSend('Give me a safe read-only cluster health summary and top 3 risks.');
    expandAISidebar(); setAISidebarMode('chat');
    dismissOnboarding();
  };

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3 rounded-lg border p-3', AI_ACCENT.border, AI_ACCENT.bg, className)}>
        <AIIconStatic size={16} />
        <span className="flex-1 text-sm text-slate-300">
          Pulse AI starts in confirmation mode. Review recommendations first, then raise trust as confidence grows.
        </span>
        <button onClick={tryIt} className={cn('text-xs font-medium px-3 py-1 rounded-full', AI_ACCENT.text, AI_ACCENT.border, 'border', AI_ACCENT.bgHover)}>
          Try it
        </button>
        <button onClick={dismissOnboarding} className="text-faint hover:text-slate-300 transition-colors" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border p-6', AI_ACCENT.border, aiGlowClass, className)}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-full', AI_ACCENT.bg)}>
            <AIIconStatic size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-100">Pulse AI</h3>
              <AIBadge />
            </div>
            <p className="text-sm text-slate-400">An AI assistant that understands your cluster in real-time</p>
          </div>
        </div>
        <button onClick={dismissOnboarding} className="text-faint hover:text-slate-300 transition-colors" aria-label="Dismiss">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        {capabilities.map(({ icon: Icon, label, description }) => (
          <div key={label} className="flex items-start gap-3 rounded-lg bg-slate-800/50 p-3">
            <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', AI_ACCENT.text)} />
            <div>
              <div className="text-sm font-medium text-slate-200">{label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={tryIt}
          className={cn('rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors bg-violet-600 hover:bg-violet-500')}
        >
          Try it now
        </button>
        <span className="text-xs text-faint">
          Start in confirm mode, verify actions in history, then increase trust when ready.
        </span>
      </div>
    </div>
  );
}
