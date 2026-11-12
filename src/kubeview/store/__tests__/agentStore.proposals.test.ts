// @vitest-environment jsdom
/**
 * Write proposals: in a protected namespace the agent offers a write instead
 * of running it, and it runs only when the person approves it as its own
 * message (pulse-agent API_CONTRACT `write_proposal`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Ev = Record<string, unknown>;

let lastMockHandlers: Set<(e: Ev) => void> | null = null;
const sent: unknown[] = [];
let socketOpen = true;
vi.mock('../../engine/agentClient', () => ({
  AgentClient: class MockAgentClient {
    connected = false;
    private handlers = new Set<(e: Ev) => void>();
    constructor() { lastMockHandlers = this.handlers; }
    on(handler: (e: Ev) => void) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
    connect() { this.connected = true; for (const h of this.handlers) h({ type: 'connected' }); }
    disconnect() { this.connected = false; }
    send() {}
    confirm() {}
    clear() {}
    switchMode() {}
    approveProposal(id: string, nonce: string) { if (!socketOpen) return false; sent.push({ type: 'approve_proposal', id, nonce }); return true; }
    rejectProposal(id: string) { sent.push({ type: 'reject_proposal', id }); }
  },
}));

function emit(event: Ev) {
  if (lastMockHandlers) for (const h of lastMockHandlers) h(event);
}

import { useAgentStore } from '../agentStore';
import { registerCluster, resetConnections, setActiveClusterId } from '../../engine/clusterConnection';

const PROPOSAL = {
  type: 'write_proposal',
  id: 'p_1',
  nonce: 'n1',
  tool: 'restart_deployment',
  input: { namespace: 'production', name: 'payments-api' },
  namespace: 'production',
  expiresAt: Date.now() + 900_000,
};

describe('agentStore write proposals', () => {
  beforeEach(() => {
    useAgentStore.getState().disconnect();
    useAgentStore.setState({ messages: [], streaming: false, pendingConfirm: null, pendingProposals: [], error: null });
    sent.length = 0;
    socketOpen = true;
    resetConnections();
    useAgentStore.getState().connect();
  });

  it('keeps a proposal after the turn that made it ends', () => {
    useAgentStore.setState({ streaming: true });
    emit(PROPOSAL);
    emit({ type: 'done', full_response: 'I proposed a restart.' });
    const [p] = useAgentStore.getState().pendingProposals;
    expect(p).toMatchObject({ id: 'p_1', tool: 'restart_deployment', namespace: 'production', clusterId: 'local' });
    expect(useAgentStore.getState().streaming).toBe(false);
    expect(sent).toEqual([]); // nothing is approved on its own
  });

  it('approving sends the id and nonce and starts the turn that runs it', () => {
    emit(PROPOSAL);
    useAgentStore.getState().answerProposal('p_1', true);
    expect(sent).toEqual([{ type: 'approve_proposal', id: 'p_1', nonce: 'n1' }]);
    const s = useAgentStore.getState();
    expect(s.pendingProposals).toEqual([]);
    expect(s.streaming).toBe(true);
    expect(s.messages.at(-1)).toMatchObject({ role: 'user', content: 'Approved: restart_deployment in production' });
  });

  it('declining sends a reject and starts no turn', () => {
    emit(PROPOSAL);
    useAgentStore.getState().answerProposal('p_1', false);
    expect(sent).toEqual([{ type: 'reject_proposal', id: 'p_1' }]);
    expect(useAgentStore.getState().pendingProposals).toEqual([]);
    expect(useAgentStore.getState().streaming).toBe(false);
  });

  it('an approval the agent no longer holds ends the wait and says nothing ran', () => {
    emit(PROPOSAL);
    useAgentStore.getState().answerProposal('p_1', true);
    emit({ type: 'proposal_resolved', id: 'p_1', status: 'expired', message: 'This proposal expired. Nothing ran.' });
    expect(useAgentStore.getState().streaming).toBe(false);
    expect(useAgentStore.getState().error).toBe('This proposal expired. Nothing ran.');
  });

  it('an applied proposal leaves the checking turn streaming', () => {
    emit(PROPOSAL);
    useAgentStore.getState().answerProposal('p_1', true);
    emit({ type: 'proposal_resolved', id: 'p_1', status: 'applied', message: 'restarted' });
    expect(useAgentStore.getState().streaming).toBe(true);
    expect(useAgentStore.getState().error).toBeNull();
  });

  it('does not approve while another answer is streaming', () => {
    emit(PROPOSAL);
    useAgentStore.setState({ streaming: true });
    useAgentStore.getState().answerProposal('p_1', true);
    expect(sent).toEqual([]);
    expect(useAgentStore.getState().pendingProposals).toHaveLength(1);
  });

  it('does not approve when the socket is closed', () => {
    emit(PROPOSAL);
    socketOpen = false;
    useAgentStore.getState().answerProposal('p_1', true);
    expect(useAgentStore.getState().streaming).toBe(false);
    expect(useAgentStore.getState().error).toMatch(/Nothing ran/);
  });

  it('does not approve after a cluster switch', () => {
    registerCluster({ id: 'prod-east', name: 'Prod East', connectionType: 'acm-proxy', target: 'prod-east' });
    emit(PROPOSAL);
    setActiveClusterId('prod-east');
    useAgentStore.getState().answerProposal('p_1', true);
    expect(sent).toEqual([]);
    expect(useAgentStore.getState().error).toMatch(/restart_deployment was not run/);
    resetConnections();
  });

  it('drops proposals when the connection goes, since the agent holds them per connection', () => {
    emit(PROPOSAL);
    emit({ type: 'disconnected' });
    expect(useAgentStore.getState().pendingProposals).toEqual([]);
  });
});
