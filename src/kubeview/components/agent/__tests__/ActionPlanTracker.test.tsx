// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

const mockGo = vi.fn();
vi.mock('../../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => mockGo,
}));

const mockSetSelectedItem = vi.fn();
const mockResolve = vi.fn();
vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector: any) => {
    const state = { setSelectedItem: mockSetSelectedItem, resolve: mockResolve };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

vi.mock('../../primitives/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../primitives/Dropdown', () => ({
  Dropdown: ({ trigger, items }: { trigger: React.ReactNode; items: Array<{ id: string; label: string; onClick: () => void }> }) => (
    <div>
      {trigger}
      {items.map((item) => (
        <button key={item.id} onClick={item.onClick}>{item.label}</button>
      ))}
    </div>
  ),
}));

import { useActionPlanStore, type ActionPlanStep } from '../../../store/actionPlanStore';
import { ActionPlanTracker } from '../ActionPlanTracker';

const STEPS: ActionPlanStep[] = [
  { title: 'Get pods', description: 'Check pod status', tool: 'get_pods', tool_input: {}, risk: 'low', status: 'pending' },
  { title: 'Check logs', description: 'Read logs', tool: 'get_pod_logs', tool_input: {}, risk: 'low', status: 'pending' },
  { title: 'Scale up', description: 'Scale deployment', tool: 'scale', tool_input: {}, risk: 'medium', status: 'pending' },
];

describe('ActionPlanTracker', () => {
  beforeEach(() => {
    useActionPlanStore.getState().clearExecution();
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders nothing when no execution', () => {
    const { container } = render(<ActionPlanTracker />);
    expect(container.innerHTML).toBe('');
  });

  it('renders step dots when execution exists', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    render(<ActionPlanTracker />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Pod crash')).toBeTruthy();
    expect(screen.getByText('Reopen')).toBeTruthy();
  });

  it('shows running step label', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().startStep(1);
    render(<ActionPlanTracker />);
    expect(screen.getByText('Step 2: Check logs')).toBeTruthy();
  });

  it('Reopen navigates to inbox and sets selected item', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    render(<ActionPlanTracker />);
    fireEvent.click(screen.getByText('Reopen'));
    expect(mockGo).toHaveBeenCalledWith('/inbox', 'Inbox');
    expect(mockSetSelectedItem).toHaveBeenCalledWith('item-1');
  });

  it('shows All done and Resolve when all steps complete', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().setStepStatus(1, 'complete');
    useActionPlanStore.getState().setStepStatus(2, 'complete');
    render(<ActionPlanTracker />);
    expect(screen.getByText('All done')).toBeTruthy();
    expect(screen.getByText('Resolve')).toBeTruthy();
    expect(screen.getByText('Reopen')).toBeTruthy();
  });

  it('Resolve button resolves item and clears tracker', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().setStepStatus(1, 'complete');
    useActionPlanStore.getState().setStepStatus(2, 'complete');
    render(<ActionPlanTracker />);
    fireEvent.click(screen.getByText('Resolve'));
    expect(mockResolve).toHaveBeenCalledWith('item-1');
    expect(useActionPlanStore.getState().execution).toBeNull();
  });

  it('X button dismisses tracker when no step is running', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    render(<ActionPlanTracker />);
    fireEvent.click(screen.getByLabelText('Dismiss action plan tracker'));
    expect(useActionPlanStore.getState().execution).toBeNull();
  });

  it('hides X button when a step is running', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().startStep(0);
    render(<ActionPlanTracker />);
    expect(screen.queryByLabelText('Dismiss action plan tracker')).toBeNull();
  });

  it('provides manual override dropdown on completed dots', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    render(<ActionPlanTracker />);
    expect(screen.getByText('Mark failed')).toBeTruthy();
  });

  it('provides mark-complete and skip on failed dots', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'failed');
    render(<ActionPlanTracker />);
    expect(screen.getByText('Mark complete')).toBeTruthy();
    expect(screen.getByText('Skip')).toBeTruthy();
  });

  it('shows Resolve with amber styling when steps have failures', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().setStepStatus(1, 'failed');
    useActionPlanStore.getState().setStepStatus(2, 'complete');
    render(<ActionPlanTracker />);
    expect(screen.getByText('Done with failures')).toBeTruthy();
    expect(screen.getByText('Resolve')).toBeTruthy();
  });

  it('has correct aria attributes', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crash', STEPS);
    render(<ActionPlanTracker />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-label')).toBe('Action plan progress');
  });
});
