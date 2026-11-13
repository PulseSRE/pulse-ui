/**
 * "Silence…" on an Inbox item or episode that came from a firing alert or a
 * monitor finding.
 *
 * It does not write anything itself. It asks Pulse to run `propose_silence`
 * for that item, so the narrowest matchers are computed from the alerts firing
 * now, and the create goes through the chat confirmation card with its "what
 * it would hide" preview and the person's own token (JTBD K2, W4). Only ids
 * travel, in the prompt and as page context; the agent looks the item up
 * itself.
 *
 * Disabled, with the reason, in observe mode (nothing is changed from this
 * browser) and while a remote cluster is selected (silences are created in
 * the Alertmanager of the cluster Pulse's agent runs on).
 */
import React from 'react';
import { BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { askPulse } from '../../engine/askPulse';
import type { ResourceContext } from '../../engine/agentClient';
import type { InboxItem } from '../../engine/inboxApi';
import { useIsRemoteCluster } from '../../components/agent/AskPulseButton';
import { useTrustStore } from '../../store/trustStore';

export const SILENCE_OBSERVE_REASON = 'Observe mode: Pulse does not change the cluster from this browser. Switch the trust level to silence alerts.';
export const SILENCE_REMOTE_REASON = "Silences are created in the Alertmanager of the cluster Pulse's agent runs on. Switch to that cluster to silence this.";

/** True for an item raised by the monitor (a finding) or by a firing alert. */
export function isSilenceable(item: Pick<InboxItem, 'finding_id' | 'correlation_key' | 'metadata'>): boolean {
  if (item.finding_id) return true;
  if ((item.correlation_key ?? '').startsWith('alerts:')) return true;
  return typeof item.metadata?.alertname === 'string' && item.metadata.alertname !== '';
}

/** The question sent to Pulse: ids only, never cluster text such as the item's title. */
export function silencePrompt(id: string, what: 'Inbox item' | 'monitor finding'): string {
  return (
    `Propose a silence for ${what} ${id}: call propose_silence with finding_id="${id}" and show me what it would ` +
    'hide and what it would not. Then create it with create_silence only after I confirm it.'
  );
}

/** Why "Silence…" cannot be used right now, or undefined. */
export function useSilenceBlockedReason(): string | undefined {
  const observe = useTrustStore((s) => s.trustLevel === 0);
  const remote = useIsRemoteCluster();
  if (observe) return SILENCE_OBSERVE_REASON;
  if (remote) return SILENCE_REMOTE_REASON;
  return undefined;
}

export function SilenceButton({ id, what, context, onAsked, showReason, className }: {
  /** The Inbox item id, or the monitor finding id `propose_silence` looks up. */
  id: string;
  what: 'Inbox item' | 'monitor finding';
  /** Page context for the agent (resource plus finding / investigation ids). */
  context?: ResourceContext;
  /** After the question is sent (e.g. close the drawer). */
  onAsked?: () => void;
  /** Show why it is disabled as text beside it, not only on hover. */
  showReason?: boolean;
  className?: string;
}) {
  const blocked = useSilenceBlockedReason();
  const reasonId = React.useId();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!!blocked}
        aria-describedby={blocked ? reasonId : undefined}
        title={blocked ?? 'Ask Pulse to propose the narrowest silence for this; you review what it hides and confirm before anything is created'}
        onClick={() => {
          if (blocked) return;
          askPulse(silencePrompt(id, what), context);
          onAsked?.();
        }}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
        Silence…
      </button>
      {blocked && <span id={reasonId} className={showReason ? 'text-xs text-slate-400' : 'sr-only'}>{blocked}</span>}
    </span>
  );
}
