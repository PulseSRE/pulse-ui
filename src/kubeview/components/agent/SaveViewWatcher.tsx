/**
 * SaveViewWatcher — watches for view creation opportunities:
 * 1. Agent sends view_spec event → show save toast immediately
 * 2. Agent response has components → show "Save as View" toast
 */

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useCustomViewStore } from '../../store/customViewStore';
import { useUIStore } from '../../store/uiStore';
import type { ViewSpec } from '../../engine/agentComponents';

export function SaveViewWatcher() {
  const pendingViewSpec = useAgentStore((s) => s.pendingViewSpec);
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const lastHandledViewSpec = useRef<string | null>(null);
  const lastHandledMsgId = useRef<string | null>(null);

  // Watch for view_spec events (from create_dashboard tool)
  useEffect(() => {
    if (!pendingViewSpec || pendingViewSpec.id === lastHandledViewSpec.current) return;
    lastHandledViewSpec.current = pendingViewSpec.id;

    useUIStore.getState().addToast({
      type: 'success',
      title: `View ready: "${pendingViewSpec.title}"`,
      detail: `${pendingViewSpec.layout.length} widgets`,
      duration: 0,
      action: {
        label: 'Save View',
        onClick: () => {
          useCustomViewStore.getState().saveView(pendingViewSpec);
          useAgentStore.setState({ pendingViewSpec: null });
        },
      },
    });
  }, [pendingViewSpec]);

  // Watch for assistant messages with components — offer to save as view
  useEffect(() => {
    if (streaming) return; // Wait until stream is done
    if (messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    if (!lastMsg.components || lastMsg.components.length === 0) return;
    if (lastMsg.id === lastHandledMsgId.current) return;
    lastHandledMsgId.current = lastMsg.id;

    // Don't show if we already showed a view_spec toast for this turn
    if (pendingViewSpec) return;

    // Only show if there are 2+ components (single component has the + button)
    if (lastMsg.components.length < 2) return;

    const components = lastMsg.components;
    useUIStore.getState().addToast({
      type: 'success',
      title: 'Save as View?',
      detail: `${components.length} widgets generated — save them as a reusable view`,
      duration: 15000,
      action: {
        label: 'Save View',
        onClick: () => {
          const view: ViewSpec = {
            id: `cv-${Date.now().toString(36)}`,
            title: `View — ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(Date.now())}`,
            layout: components,
            generatedAt: Date.now(),
          };
          useCustomViewStore.getState().saveView(view);
        },
      },
    });
  }, [messages, streaming, pendingViewSpec]);

  return null;
}
