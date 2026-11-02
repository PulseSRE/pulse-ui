/**
 * "Ask Pulse about this pod": a question box that opens the Pulse AI dock
 * with the resource attached as context, plus the hook that tells the dock
 * which resource the page is about, so a question typed straight into the dock
 * carries it too.
 *
 * The agent receives kind, namespace and name (it sanitises and prefixes
 * them to the question); it reads owners, events and findings itself, so the
 * card says the resource is attached, not more.
 */
import React from 'react';
import { MessageSquare } from 'lucide-react';
import { askPulse } from '../../engine/askPulse';
import type { ResourceContext } from '../../engine/agentClient';
import { useAgentStore } from '../../store/agentStore';
import { useFleetStore } from '../../store/fleetStore';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';

/** Tell the dock which resource this page is about while the page is mounted. */
export function usePageChatContext(context: ResourceContext | null): void {
  const kind = context?.kind;
  const name = context?.name;
  const namespace = context?.namespace;
  const gvr = context?.gvr;
  React.useEffect(() => {
    if (!kind || !name) return undefined;
    const ctx: ResourceContext = { kind, name, namespace, gvr };
    useAgentStore.getState().setPageContext(ctx);
    return () => {
      const cur = useAgentStore.getState().pageContext;
      // Only clear our own: the next page may already have set its context.
      if (cur && cur.kind === kind && cur.name === name && cur.namespace === namespace) {
        useAgentStore.getState().setPageContext(null);
      }
    };
  }, [kind, name, namespace, gvr]);
}

export function AskPulseCard({ context, placeholder }: { context: ResourceContext; placeholder?: string }) {
  const [text, setText] = React.useState('');
  const remote = useFleetStore((s) => s.activeClusterId) !== LOCAL_CLUSTER_ID;
  const id = `ask-pulse-${context.kind.toLowerCase()}`;
  const noun = context.kind.toLowerCase();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || remote) return;
    askPulse(q, context);
    setText('');
  };
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <MessageSquare className="h-4 w-4 text-violet-400" aria-hidden />
        Ask Pulse about this {noun}
      </h2>
      <p className="mt-1 text-xs text-slate-400" data-testid="ask-pulse-note">
        {remote
          ? 'Pulse AI answers about the local cluster only.'
          : `This ${noun} is attached as context; the answer opens in the Pulse AI panel.`}
      </p>
      <form onSubmit={submit} className="mt-2.5 flex gap-2">
        <label htmlFor={id} className="sr-only">Question for Pulse</label>
        <input
          id={id}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={remote}
          placeholder={placeholder ?? `Why is this ${noun} failing?`}
          className="min-h-[40px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={remote || !text.trim()}
          className="rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
