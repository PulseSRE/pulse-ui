// @vitest-environment jsdom
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AmbientInsight, clearInsightCache } from '../AmbientInsight';
import type { AgentEvent } from '../../../engine/agentClient';

/* ---- Mock AgentClient ---- */

let mockHandler: ((event: AgentEvent) => void) | null = null;
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSend = vi.fn();

vi.mock('../../../engine/agentClient', () => ({
  AgentClient: class {
    on(handler: (event: any) => void) {
      mockHandler = handler;
      return () => {};
    }
    connect() { mockConnect(); }
    disconnect() { mockDisconnect(); }
    send(content: string, context?: unknown) { mockSend(content, context); }
    get connected() { return true; }
  },
}));

vi.mock('../MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

vi.mock('../AgentComponentRenderer', () => ({
  AgentComponentRenderer: ({ spec }: { spec: { type: string } }) => (
    <div data-testid="agent-component">{spec.type}</div>
  ),
}));

const baseContext = { kind: 'Deployment', name: 'web', namespace: 'default' };
const prompt = 'Analyze this deployment';

describe('AmbientInsight', () => {
  beforeEach(() => {
    mockHandler = null;
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockSend.mockClear();
    clearInsightCache();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the "Ask Pulse about this …" button in manual mode', () => {
    render(<AmbientInsight context={baseContext} prompt={prompt} />);
    expect(screen.getByRole('button', { name: /Ask Pulse about this/ })).toBeTruthy();
  });

  it('shows loading state when button clicked', () => {
    render(<AmbientInsight context={baseContext} prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pulse about this/ }));

    expect(screen.getByText('Analyzing...')).toBeTruthy();
    expect(screen.getByLabelText('Cancel')).toBeTruthy();
    expect(mockConnect).toHaveBeenCalled();
  });

  it('shows result after agent responds', () => {
    render(<AmbientInsight context={baseContext} prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pulse about this/ }));

    // Simulate connected -> send -> done
    act(() => {
      mockHandler?.({ type: 'connected' });
    });
    expect(mockSend).toHaveBeenCalledWith(prompt, baseContext);

    act(() => {
      mockHandler?.({
        type: 'component',
        spec: { type: 'metric_card', title: 'CPU', value: '42%' } as never,
        tool: 'get_metrics',
      });
    });

    act(() => {
      mockHandler?.({ type: 'done', full_response: 'Deployment looks healthy.' });
    });

    expect(screen.getByText('AI Insight')).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('Deployment looks healthy.');
    expect(screen.getByTestId('agent-component')).toBeTruthy();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('shows error state on agent error', () => {
    render(<AmbientInsight context={baseContext} prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pulse about this/ }));

    act(() => {
      mockHandler?.({ type: 'error', message: 'Agent unreachable' });
    });

    expect(screen.getByText('Agent unreachable')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('uses cache on re-render within staleTime', () => {
    const { unmount } = render(<AmbientInsight context={baseContext} prompt={prompt} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pulse about this/ }));

    act(() => mockHandler?.({ type: 'connected' }));
    act(() => mockHandler?.({ type: 'done', full_response: 'Cached result.' }));

    expect(screen.getByTestId('markdown').textContent).toBe('Cached result.');
    unmount();

    // Re-render -- should show cached result immediately without connecting
    mockConnect.mockClear();
    render(<AmbientInsight context={baseContext} prompt={prompt} />);

    // Cache hit: result shown directly, no new connection
    expect(screen.getByText('AI Insight')).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('Cached result.');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('auto-trigger fires on mount', () => {
    render(<AmbientInsight context={baseContext} prompt={prompt} trigger="auto" />);

    // Should immediately start connecting without user interaction
    expect(mockConnect).toHaveBeenCalled();
    expect(screen.getByText('Analyzing...')).toBeTruthy();
  });
});
