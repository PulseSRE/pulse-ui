// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AIOnboarding } from '../AIOnboarding';

const mockDismiss = vi.fn();
const mockConnectAndSend = vi.fn();
const mockOpenDock = vi.fn();

let mockOnboardingSeen = false;

// useOnboardingStore is called WITHOUT selector (destructured)
vi.mock('../../../store/onboardingStore', () => ({
  useOnboardingStore: () => ({
    aiOnboardingSeen: mockOnboardingSeen,
    dismissOnboarding: mockDismiss,
  }),
}));

// useAgentStore and useUIStore are called WITH selector
vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (sel: (s: any) => any) =>
    sel({ connectAndSend: mockConnectAndSend, streaming: false }),
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: (sel: (s: any) => any) =>
    sel({ expandAISidebar: mockOpenDock, setAISidebarMode: vi.fn() }),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mockOnboardingSeen = false;
});

describe('AIOnboarding', () => {
  it('renders full card by default', () => {
    render(<AIOnboarding />);
    expect(screen.getByText('Pulse AI')).toBeDefined();
    expect(screen.getByText('Try it now')).toBeDefined();
  });

  it('renders compact banner when compact=true', () => {
    render(<AIOnboarding compact />);
    expect(screen.getByText('Try it')).toBeDefined();
    expect(screen.queryByText('Pulse AI')).toBeNull();
  });

  it('does not render when onboarding already seen', () => {
    mockOnboardingSeen = true;
    const { container } = render(<AIOnboarding />);
    expect(container.innerHTML).toBe('');
  });

  it('dismiss button calls dismissOnboarding', () => {
    render(<AIOnboarding />);
    const dismissButtons = screen.getAllByLabelText('Dismiss');
    fireEvent.click(dismissButtons[0]);
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('try it button calls connectAndSend and dismisses', () => {
    render(<AIOnboarding />);
    fireEvent.click(screen.getByText('Try it now'));
    expect(mockConnectAndSend).toHaveBeenCalledWith('Give me a safe read-only cluster health summary and top 3 risks.');
    expect(mockDismiss).toHaveBeenCalled();
  });
});
