/**
 * AIBranding — shared visual identity for all AI surfaces.
 *
 * Every AI-powered component uses these tokens so users see one
 * intelligence layer, not 5 separate features.
 */

import { Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';

/* ---------------------------------------------------------------------------
 * Color tokens
 * --------------------------------------------------------------------------- */

export const AI_ACCENT = {
  text: 'text-violet-400',
  textHover: 'hover:text-violet-300',
  bg: 'bg-violet-500/15',
  bgHover: 'hover:bg-violet-500/25',
  border: 'border-violet-500/30',
  borderActive: 'border-violet-500/60',
  ring: 'ring-violet-500/20',
  dot: 'bg-violet-400',
} as const;

/** Glow border class for AI-powered elements */
export const aiGlowClass = 'ring-1 ring-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.15)]';

/** Active accent for dock/tab borders when agent tab is selected */
export const aiActiveClass = 'border-b-2 border-violet-400 text-violet-400';

/* ---------------------------------------------------------------------------
 * Components
 * --------------------------------------------------------------------------- */

interface AIIconProps {
  className?: string;
  size?: number;
  /** Show pulse animation when agent is streaming */
  pulseWhenStreaming?: boolean;
}

/** Consistent AI icon — Sparkles with optional streaming pulse */
export function AIIcon({ className, size = 16, pulseWhenStreaming = false }: AIIconProps) {
  const streaming = useAgentStore((s) => s.streaming);
  const shouldPulse = pulseWhenStreaming && streaming;

  if (shouldPulse) {
    return <Loader2 aria-label="AI processing" role="img" className={cn('animate-spin', AI_ACCENT.text, className)} style={{ width: size, height: size }} />;
  }

  return <Sparkles aria-hidden="true" className={cn(AI_ACCENT.text, className)} style={{ width: size, height: size }} />;
}

/** Standalone AIIcon that doesn't depend on agent store (for static contexts) */
export function AIIconStatic({ className, size = 16 }: { className?: string; size?: number }) {
  return <Sparkles aria-hidden="true" className={cn(AI_ACCENT.text, className)} style={{ width: size, height: size }} />;
}

/** Small "AI" badge pill */
export function AIBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider',
        AI_ACCENT.bg,
        AI_ACCENT.text,
        className,
      )}
    >
      <Sparkles className="h-2.5 w-2.5" />
      AI
    </span>
  );
}

/** Prompt pill button — violet-accented clickable prompt suggestion */
export function PromptPill({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={() => {
        onClick();
        // Track suggestion click
        import('../../engine/sessionTracker').then(({ trackSuggestionClick }) => {
          const text = typeof children === 'string' ? children : '';
          trackSuggestionClick(window.location.pathname, text);
        }).catch(() => {});
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
        AI_ACCENT.border,
        AI_ACCENT.text,
        AI_ACCENT.bgHover,
        className,
      )}
    >
      <Sparkles className="h-3 w-3" />
      {children}
    </button>
  );
}
