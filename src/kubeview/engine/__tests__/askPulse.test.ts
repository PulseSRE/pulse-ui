import { describe, it, expect, vi, beforeEach } from 'vitest';

const connectAndSend = vi.fn();
const sendMessage = vi.fn();
const expandAISidebar = vi.fn();
const setAISidebarMode = vi.fn();

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(() => ({}), {
    getState: () => ({ connectAndSend, sendMessage }),
  }),
}));

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(() => ({}), {
    getState: () => ({ expandAISidebar, setAISidebarMode }),
  }),
}));

import { askPulse } from '../askPulse';

/**
 * One chat surface.
 *
 * The episode card and the resource detail page each embedded their own chat
 * while the Pulse AI sidebar sat open beside them with its own input — two
 * conversations about the same thing, each with its own connection state, and
 * nothing on screen to say which to use. Both now route here.
 */
describe('askPulse', () => {
  beforeEach(() => {
    connectAndSend.mockClear();
    sendMessage.mockClear();
    expandAISidebar.mockClear();
    setAISidebarMode.mockClear();
  });

  it('opens the sidebar and puts it in chat mode', () => {
    askPulse('why is this unhealthy?');
    expect(expandAISidebar).toHaveBeenCalled();
    expect(setAISidebarMode).toHaveBeenCalledWith('chat');
  });

  it('connects before sending rather than dropping the message', () => {
    // sendMessage sets "Agent not connected — try again in a moment" and
    // discards the text. With the sidebar collapsed the socket is often down,
    // which is exactly when this is called.
    askPulse('why is this unhealthy?');
    expect(connectAndSend).toHaveBeenCalledWith('why is this unhealthy?', undefined);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('carries the resource context so the agent knows what is being asked about', () => {
    const ctx = { kind: 'Pod', name: 'api-7f9', namespace: 'prod', gvr: 'v1/pods' };
    askPulse('what changed recently?', ctx);
    expect(connectAndSend).toHaveBeenCalledWith('what changed recently?', ctx);
  });
});
