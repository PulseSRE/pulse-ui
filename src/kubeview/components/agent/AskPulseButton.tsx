/**
 * The one "ask the AI" button: label "Ask Pulse" (plus an allowed suffix),
 * the AI icon and the violet AI style.
 *
 * It sends `prompt` to the Pulse AI panel with `context` (kind, name,
 * namespace) attached, so the agent knows which resource the question is
 * about. An entry with its own route (a backend investigation, a step
 * runner) passes `onAsk` instead and keeps that behaviour.
 *
 * Pulse AI reads the local cluster only, so with a remote cluster active the
 * button is disabled and says so in the shared wording.
 */
import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { askPulse } from '../../engine/askPulse';
import type { ResourceContext } from '../../engine/agentClient';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { useFleetStore } from '../../store/fleetStore';
import { PULSE_AI_LOCAL_ONLY } from '../feedback/localOnlyCopy';
import { AskPulseButtonBase, askPulseLabel, type AskPulseButtonBaseProps, type AskPulseSuffix } from './AskPulseButtonBase';
import { AI_ACCENT } from './aiTokens';

export { askPulseLabel, type AskPulseSuffix } from './AskPulseButtonBase';

export interface AskPulseButtonProps extends Omit<AskPulseButtonBaseProps, 'onClick'> {
  /** The question. A function is called on click, for prompts built from current state. */
  prompt?: string | (() => string);
  /** The resource the question is about; passed to the agent with the question. */
  context?: ResourceContext;
  /** Replaces sending `prompt` for entries with their own route. */
  onAsk?: () => void;
}

export function useIsRemoteCluster(): boolean {
  return useFleetStore((s) => s.activeClusterId) !== LOCAL_CLUSTER_ID;
}

export function AskPulseButton({ prompt, context, onAsk, disabledReason, ...rest }: AskPulseButtonProps) {
  const remote = useIsRemoteCluster();
  const reason = remote ? PULSE_AI_LOCAL_ONLY : disabledReason;
  const onClick = () => {
    if (remote) return;
    if (onAsk) {
      onAsk();
      return;
    }
    const text = typeof prompt === 'function' ? prompt() : prompt;
    if (text?.trim()) askPulse(text, context);
  };
  return <AskPulseButtonBase {...rest} disabledReason={reason} onClick={onClick} />;
}

/**
 * A row of suggested questions under one "Ask Pulse" heading: the
 * prompt-chip form of the same entry point. Each chip sends its text with
 * `context`; on a remote cluster the chips are disabled with the shared
 * wording.
 */
export function AskPulsePrompts({ prompts, context, suffix, className }: {
  prompts: string[];
  context?: ResourceContext;
  suffix?: AskPulseSuffix;
  className?: string;
}) {
  const remote = useIsRemoteCluster();
  const headingId = React.useId();
  if (prompts.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-ai-entry="ask-pulse-prompts" className={cn('rounded-lg bg-slate-900 p-3', AI_ACCENT.border, 'border', className)}>
      <h2 id={headingId} className={cn('mb-2 flex items-center gap-1.5 text-xs font-medium', AI_ACCENT.text)}>
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
        {askPulseLabel(suffix)}
      </h2>
      <div className="flex flex-wrap gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={remote}
            title={remote ? PULSE_AI_LOCAL_ONLY : undefined}
            onClick={() => { if (!remote) askPulse(p, context); }}
            className={cn('rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50', AI_ACCENT.border, AI_ACCENT.text, AI_ACCENT.bgHover)}
          >
            {p}
          </button>
        ))}
      </div>
      {remote && <p className="mt-2 text-xs text-slate-400">{PULSE_AI_LOCAL_ONLY}</p>}
    </section>
  );
}
