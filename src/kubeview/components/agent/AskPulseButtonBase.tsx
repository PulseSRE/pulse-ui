/**
 * The look and label of every "ask the AI" entry point, without the stores.
 *
 * Use `AskPulseButton` (same folder), which adds the local-cluster gate and
 * sends the question. This base exists for the one caller that must not
 * import the stores: ErrorBoundary.
 */
import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AI_ACCENT } from './aiTokens';

/**
 * The label is always "Ask Pulse". A suffix is allowed only where the entry
 * does something other than open a question: it asks why, asks Pulse to fix
 * or investigate, or names what the question is about.
 */
export type AskPulseSuffix = 'why' | 'to fix' | 'to investigate' | `about this ${string}`;

export function askPulseLabel(suffix?: AskPulseSuffix): string {
  return suffix ? `Ask Pulse ${suffix}` : 'Ask Pulse';
}

export interface AskPulseButtonBaseProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'disabled' | 'type'> {
  suffix?: AskPulseSuffix;
  size?: 'sm' | 'md';
  /** Why the button cannot be used; set means disabled, and the reason is announced and shown on hover. */
  disabledReason?: string;
  /** Show the disabled reason as visible text next to the button rather than only on hover. */
  showReason?: boolean;
  busy?: boolean;
}

const SIZE = {
  sm: 'gap-1 px-2.5 py-1 text-xs',
  md: 'gap-1.5 px-3 py-1.5 text-sm',
} as const;

export function AskPulseButtonBase({
  suffix, size = 'sm', disabledReason, showReason, busy, className, title, ...rest
}: AskPulseButtonBaseProps) {
  const reasonId = React.useId();
  const disabled = Boolean(disabledReason) || Boolean(busy);
  const button = (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-describedby={disabledReason ? reasonId : undefined}
      title={disabledReason ?? title}
      data-ai-entry="ask-pulse"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        AI_ACCENT.button,
        SIZE[size],
        className,
      )}
    >
      <Sparkles aria-hidden="true" className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      {askPulseLabel(suffix)}
    </button>
  );
  if (!disabledReason) return button;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {button}
      <span id={reasonId} className={showReason ? 'text-xs text-slate-400' : 'sr-only'}>{disabledReason}</span>
    </span>
  );
}
