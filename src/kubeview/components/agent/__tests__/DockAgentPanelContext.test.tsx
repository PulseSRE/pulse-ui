// @vitest-environment jsdom
/**
 * A question typed into the dock on a Pod or Deployment page goes with that
 * resource as context; the dock says which resource it is.
 */
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DockAgentPanel } from '../DockAgentPanel';
import { useFleetStore } from '../../../store/fleetStore';

// Stub scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

/* ---- Mocks ---- */

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const sendMessage = vi.fn();
let pageContext: Record<string, string> | null = null;
function agentState() {
  return {
    connected: true, mode: 'auto', messages: [], streaming: false, streamingText: '', thinkingText: '',
    activeTools: [], streamingComponents: [], pendingConfirm: null, error: null, feedbackToast: null,
    connect: vi.fn(), sendMessage, confirmAction: vi.fn(), cancelQuery: vi.fn(), clearChat: vi.fn(),
    pageContext,
  };
}
vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(agentState()),
    { getState: () => agentState(), setState: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
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

function renderPanel(path = '/r/v1~pods/shop/web-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as never;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <DockAgentPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ask(text: string) {
  const box = screen.getByPlaceholderText('Ask Pulse…');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

describe('DockAgentPanel page context', () => {
  beforeEach(() => { sendMessage.mockClear(); pageContext = null; });
  afterEach(() => { cleanup(); useFleetStore.setState({ activeClusterId: 'local' }); });

  it('sends the page resource as context and names it above the input', () => {
    pageContext = { kind: 'Pod', name: 'web-1', namespace: 'shop', gvr: 'v1/pods' };
    renderPanel();
    expect(screen.getByTestId('dock-page-context').textContent).toBe('Asking about Pod shop/web-1');
    ask('why is it crashing?');
    expect(sendMessage).toHaveBeenCalledWith('why is it crashing?', { kind: 'Pod', name: 'web-1', namespace: 'shop', gvr: 'v1/pods' });
  });

  it('sends no context when the page set none', () => {
    renderPanel('/workloads');
    expect(screen.queryByTestId('dock-page-context')).toBeNull();
    ask('hello');
    expect(sendMessage).toHaveBeenCalledWith('hello', undefined);
  });

  it('a custom view still wins over a page context', () => {
    pageContext = { kind: 'Pod', name: 'web-1', namespace: 'shop' };
    renderPanel('/custom/my-view');
    ask('add a chart');
    expect(sendMessage).toHaveBeenCalledWith('add a chart', { kind: 'custom_view', name: '', viewId: 'my-view' });
  });

  it('on a remote cluster the page context is not attached or shown', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    pageContext = { kind: 'Pod', name: 'web-1', namespace: 'shop' };
    renderPanel();
    expect(screen.queryByTestId('dock-page-context')).toBeNull();
    ask('why?');
    expect(sendMessage).toHaveBeenCalledWith('why?', undefined);
  });
});
