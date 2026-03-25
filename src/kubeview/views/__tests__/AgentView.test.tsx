// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSendMessage = vi.fn();
const mockSwitchMode = vi.fn();
const mockClearChat = vi.fn();
const mockConfirmAction = vi.fn();

let mockState: Record<string, any> = {};

function resetMockState(overrides: Record<string, any> = {}) {
  mockState = {
    connected: true,
    mode: 'sre',
    messages: [],
    streaming: false,
    streamingText: '',
    thinkingText: '',
    activeTools: [],
    pendingConfirm: null,
    error: null,
    connect: mockConnect,
    disconnect: mockDisconnect,
    sendMessage: mockSendMessage,
    switchMode: mockSwitchMode,
    clearChat: mockClearChat,
    confirmAction: mockConfirmAction,
    ...overrides,
  };
}

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector?: (s: any) => any) => {
    if (typeof selector === 'function') return selector(mockState);
    return mockState;
  },
}));

vi.mock('../../components/primitives/Panel', () => ({
  Panel: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

import AgentView from '../AgentView';

function renderView() {
  return render(
    <MemoryRouter>
      <AgentView />
    </MemoryRouter>
  );
}

describe('AgentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockState();
  });

  it('renders with SRE mode header', () => {
    renderView();
    expect(screen.getAllByText('SRE Agent').length).toBeGreaterThan(0);
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('shows quick prompts when no messages', () => {
    renderView();
    expect(screen.getAllByText('Check cluster health').length).toBeGreaterThan(0);
  });

  it('calls connect on mount', () => {
    renderView();
    expect(mockConnect).toHaveBeenCalled();
  });

  it('sends message on Enter', () => {
    renderView();
    const inputs = screen.getAllByLabelText('Message to agent');
    fireEvent.change(inputs[0], { target: { value: 'Check health' } });
    fireEvent.keyDown(inputs[0], { key: 'Enter' });
    expect(mockSendMessage).toHaveBeenCalledWith('Check health');
  });

  it('shows mode toggle buttons', () => {
    renderView();
    expect(screen.getAllByText('SRE Agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Security Scanner').length).toBeGreaterThan(0);
  });

  it('switches mode on button click', () => {
    renderView();
    // The toggle buttons — find the one that's not active (Security Scanner in header toggle)
    const buttons = screen.getAllByText('Security Scanner');
    fireEvent.click(buttons[0]);
    expect(mockSwitchMode).toHaveBeenCalledWith('security');
  });

  it('shows clear button', () => {
    renderView();
    const clearBtns = screen.getAllByTitle('Clear chat');
    fireEvent.click(clearBtns[0]);
    expect(mockClearChat).toHaveBeenCalled();
  });

  it('shows error message', () => {
    resetMockState({ error: 'Connection failed' });
    renderView();
    expect(screen.getByText('Connection failed')).toBeTruthy();
  });

  it('shows streaming indicator', () => {
    resetMockState({ streaming: true });
    renderView();
    expect(screen.getByText('Thinking...')).toBeTruthy();
  });

  it('shows thinking text during streaming', () => {
    resetMockState({ streaming: true, thinkingText: 'Let me check the cluster...' });
    renderView();
    expect(screen.getByText(/Let me check/)).toBeTruthy();
  });

  it('shows active tool during streaming', () => {
    resetMockState({ streaming: true, activeTools: ['list_pods'] });
    renderView();
    expect(screen.getByText(/list_pods/)).toBeTruthy();
  });

  it('renders user and assistant messages', () => {
    resetMockState({
      messages: [
        { id: '1', role: 'user', content: 'Check health', timestamp: Date.now() },
        { id: '2', role: 'assistant', content: 'All nodes are ready.', timestamp: Date.now() },
      ],
    });
    renderView();
    expect(screen.getByText('Check health')).toBeTruthy();
    expect(screen.getByText('All nodes are ready.')).toBeTruthy();
  });

  it('shows disconnected state', () => {
    resetMockState({ connected: false });
    renderView();
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('shows confirmation dialog', () => {
    resetMockState({
      pendingConfirm: {
        tool: 'scale_deployment',
        input: { namespace: 'default', name: 'nginx', replicas: 3 },
      },
    });
    renderView();
    expect(screen.getByText('Confirm write operation')).toBeTruthy();
    expect(screen.getByText(/Scale deployment/)).toBeTruthy();
  });

  it('calls confirmAction on approve', () => {
    resetMockState({
      pendingConfirm: { tool: 'delete_pod', input: { namespace: 'default', pod_name: 'test' } },
    });
    renderView();
    const approveButtons = screen.getAllByText('Approve');
    fireEvent.click(approveButtons[0]);
    expect(mockConfirmAction).toHaveBeenCalledWith(true);
  });

  it('calls confirmAction on deny', () => {
    resetMockState({
      pendingConfirm: { tool: 'delete_pod', input: { namespace: 'default', pod_name: 'test' } },
    });
    renderView();
    const denyButtons = screen.getAllByText('Deny');
    fireEvent.click(denyButtons[0]);
    expect(mockConfirmAction).toHaveBeenCalledWith(false);
  });

  it('disables input while streaming', () => {
    resetMockState({ streaming: true });
    renderView();
    const inputs = screen.getAllByLabelText('Message to agent');
    const disabled = inputs.find((el) => el.hasAttribute('disabled'));
    expect(disabled).toBeTruthy();
  });

  it('shows quick prompt buttons that send messages', () => {
    renderView();
    const buttons = screen.getAllByText('Check cluster health');
    fireEvent.click(buttons[0]);
    expect(mockSendMessage).toHaveBeenCalledWith('Check cluster health');
  });
});
