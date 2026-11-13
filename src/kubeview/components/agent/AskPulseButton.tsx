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
 * button is disabled and says so in the shared wording. An entry whose data
 * already comes from the local cluster or the agent (an Inbox item, an
 * episode, a readiness gate, a UI error) passes `localData`: it sends only
 * local data to the local agent, so it stays usable while a remote cluster
 * is selected.
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
  /**
   * The question is built only from local-cluster or agent data, so the
   * remote-cluster gate does not apply. Never set it for a prompt built from
   * what the page read from the active cluster.
   */
  localData?: boolean;
}

export function useIsRemoteCluster(): boolean {
  return useFleetStore((s) => s.activeClusterId) !== LOCAL_CLUSTER_ID;
}

/**
 * Why an AI entry cannot be used right now, or undefined. For controls that
 * send to Pulse AI but are not an "Ask Pulse" button (a step's Execute), so
 * they are gated exactly like one.
 */
export function useAskPulseBlockedReason(localData?: boolean): string | undefined {
  return useIsRemoteCluster() && !localData ? PULSE_AI_LOCAL_ONLY : undefined;
}

export function AskPulseButton({ prompt, context, onAsk, localData, disabledReason, ...rest }: AskPulseButtonProps) {
  const remote = useIsRemoteCluster() && !localData;
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
export function AskPulsePrompts({ prompts, context, suffix, headingLevel = 2, className }: {
  /** A question, or a question with the resource it is about (overrides `context`). */
  prompts: Array<string | { text: string; context?: ResourceContext }>;
  context?: ResourceContext;
  suffix?: AskPulseSuffix;
  /** The heading level that fits where the group sits on the page. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const remote = useIsRemoteCluster();
  const headingId = React.useId();
  if (prompts.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-ai-entry="ask-pulse-prompts" className={cn('rounded-lg bg-slate-900 p-3', AI_ACCENT.border, 'border', className)}>
      <Heading id={headingId} className={cn('mb-2 flex items-center gap-1.5 text-xs font-medium', AI_ACCENT.text)}>
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
        {askPulseLabel(suffix)}
      </Heading>
      <AskPulseChips prompts={prompts} context={context} />
      {remote && <p className="mt-2 text-xs text-slate-400">{PULSE_AI_LOCAL_ONLY}</p>}
    </section>
  );
}

/**
 * The suggested-question chips alone, for a card that already has its own
 * "Ask Pulse" heading (the detail page's question box). Disabled on a remote
 * cluster; the caller shows the shared wording.
 */
export function AskPulseChips({ prompts, context, className }: {
  prompts: Array<string | { text: string; context?: ResourceContext }>;
  context?: ResourceContext;
  className?: string;
}) {
  const remote = useIsRemoteCluster();
  if (prompts.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {prompts.map((item) => {
        const p = typeof item === 'string' ? item : item.text;
        const ctx = typeof item === 'string' ? context : item.context ?? context;
        return (
        <button
          key={p}
          type="button"
          disabled={remote}
          title={remote ? PULSE_AI_LOCAL_ONLY : undefined}
          onClick={() => { if (!remote) askPulse(p, ctx); }}
          className={cn('rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50', AI_ACCENT.border, AI_ACCENT.text, AI_ACCENT.bgHover)}
        >
          {p}
        </button>
        );
      })}
    </div>
  );
}
