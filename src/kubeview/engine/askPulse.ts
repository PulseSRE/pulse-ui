import type { ResourceContext } from './agentClient';
import { useAgentStore } from '../store/agentStore';
import { useUIStore } from '../store/uiStore';

/**
 * Put a question to Pulse AI in the one place Pulse AI lives.
 *
 * Screens used to embed their own chat panels — the episode card had one, the
 * resource detail page had another — while the Pulse AI sidebar sat open
 * alongside with its own input. Two inputs, two conversations, two connection
 * states, and nothing on screen to say which one to use.
 *
 * The sidebar is the surface that survives navigation: an answer about a cause
 * is still there after you follow it into the Timeline or a pod. An embedded
 * panel dies with the view that owns it, which is the wrong lifetime for a
 * diagnosis.
 *
 * `connectAndSend`, never `sendMessage`: if the sidebar was collapsed the
 * socket may not be up, and `sendMessage` sets "Agent not connected — try
 * again in a moment" and discards the text rather than waiting for it.
 */
export function askPulse(prompt: string, context?: ResourceContext): void {
  useUIStore.getState().expandAISidebar();
  useUIStore.getState().setAISidebarMode('chat');
  useAgentStore.getState().connectAndSend(prompt, context);
}
