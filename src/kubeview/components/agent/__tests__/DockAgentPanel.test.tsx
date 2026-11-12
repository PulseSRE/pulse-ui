// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DockAgentPanel } from '../DockAgentPanel';

// Stub scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

/* ---- Mocks ---- */

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector: any) => {
      const state = {
        connected: true,
        mode: 'auto',
        messages: [],
        streaming: false,
        streamingText: '',
        thinkingText: '',
        activeTools: [],
        streamingComponents: [],
        pendingConfirm: null,
        pendingProposals: [],
        error: null,
        feedbackToast: null,
        connect: vi.fn(),
        sendMessage: vi.fn(),
        confirmAction: vi.fn(),
        cancelQuery: vi.fn(),
        clearChat: vi.fn(),
      };
      return typeof selector === 'function' ? selector(state) : state;
    },
    {
      getState: () => ({
        connected: true,
        mode: 'auto',
        messages: [],
        streaming: false,
        streamingText: '',
        thinkingText: '',
        activeTools: [],
        streamingComponents: [],
        pendingConfirm: null,
        pendingProposals: [],
        error: null,
        feedbackToast: null,
        connect: vi.fn(),
        sendMessage: vi.fn(),
        confirmAction: vi.fn(),
        cancelQuery: vi.fn(),
        clearChat: vi.fn(),
      }),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('../../../store/trustStore', () => ({
  useTrustStore: (selector: any) => {
    const state = { trustLevel: 2 };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../../hooks/useSmartPrompts', () => ({
  useSmartPrompts: () => [],
}));

vi.mock('../../../store/monitorStore', () => ({
  useMonitorStore: (selector: any) => {
    const state = { connected: false, findings: [] };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

vi.mock('../../../store/customViewStore', () => ({
  useCustomViewStore: {
    getState: () => ({
      createAndAddWidget: vi.fn(),
    }),
  },
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      enterViewBuilder: vi.fn(),
    }),
  },
}));

vi.mock('../MessageBubble', () => ({
  MessageBubble: () => null,
}));

vi.mock('../AgentComponentRenderer', () => ({
  AgentComponentRenderer: () => null,
}));

vi.mock('../ConfirmationCard', () => ({
  ConfirmationCard: () => null,
}));

vi.mock('../../feedback/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('../AIBranding', () => ({
  PromptPill: () => null,
}));

/* ---- Helpers ---- */

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DockAgentPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DockAgentPanel — Chat History', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the history toggle button', () => {
    renderPanel();
    const btn = screen.getByTestId('chat-history-toggle');
    expect(btn).toBeTruthy();
  });

  it('toggles the history panel on click', async () => {
    // Mock fetch for sessions
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    }) as any;

    renderPanel();
    const btn = screen.getByTestId('chat-history-toggle');

    // Panel should not be visible initially
    expect(screen.queryByTestId('chat-history-panel')).toBeNull();

    // Click to open
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('chat-history-panel')).toBeTruthy();
    });

    // Click again to close
    fireEvent.click(btn);
    expect(screen.queryByTestId('chat-history-panel')).toBeNull();
  });

  it('shows session list when panel is open', async () => {
    const mockSessions = [
      {
        id: 'sess-1',
        title: 'Debug crashloop',
        agent_mode: 'sre',
        message_count: 5,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: mockSessions }),
    }) as any;

    renderPanel();
    fireEvent.click(screen.getByTestId('chat-history-toggle'));

    await waitFor(() => {
      expect(screen.getByText('Debug crashloop')).toBeTruthy();
      expect(screen.getByText(/5 msgs/)).toBeTruthy();
    });
  });

  it('shows New Chat button in history panel', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    }) as any;

    renderPanel();
    fireEvent.click(screen.getByTestId('chat-history-toggle'));

    await waitFor(() => {
      expect(screen.getByText('New Chat')).toBeTruthy();
    });
  });

  it('closes panel via close button', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    }) as any;

    renderPanel();
    fireEvent.click(screen.getByTestId('chat-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-history-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Close history panel'));
    expect(screen.queryByTestId('chat-history-panel')).toBeNull();
  });
});
