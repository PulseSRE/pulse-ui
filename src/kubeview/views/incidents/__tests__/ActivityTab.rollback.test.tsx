// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../../../engine/analyticsApi', () => ({ fetchLearningFeed: vi.fn() }));
vi.mock('../../../engine/safeQuery', () => ({ agentFetch: vi.fn() }));
vi.mock('../../../engine/gvr', () => ({ resourceDetailUrl: () => '/r/mock/resource' }));
vi.mock('../IncidentLifecycleDrawer', () => ({ IncidentLifecycleDrawer: () => null }));
vi.mock('../shared/InvestigationCard', () => ({ InvestigationCard: () => null }));
vi.mock('../shared/PostmortemCard', () => ({ PostmortemCard: () => null }));
vi.mock('../shared/CorrelationGroupRow', () => ({ CorrelationGroupRow: () => null }));

const _uiState = {
  selectedNamespace: '*',
  addToast: vi.fn(),
  expandAISidebar: vi.fn(),
  setAISidebarMode: vi.fn(),
};
vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: any) => selector(_uiState), {
    getState: () => _uiState,
  }),
}));

const _monitorState = {
  investigations: [] as any[],
  recentActions: [] as any[],
  fixHistory: [] as any[],
  loadFixHistory: vi.fn(),
  findings: [] as any[],
};
vi.mock('../../../store/monitorStore', () => ({
  useMonitorStore: Object.assign((selector: any) => selector(_monitorState), {
    getState: () => _monitorState,
  }),
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: { getState: () => ({ sendMessage: vi.fn() }) },
}));

vi.mock('../../../hooks/useIncidentTimeline', () => ({
  useIncidentTimeline: () => ({
    entries: [],
    correlationGroups: [],
    counts: { alert: 0, event: 0, rollout: 0, config: 0 },
    isLoading: false,
  }),
}));

const requestRollback = vi.fn();
vi.mock('../../../engine/fixHistory', () => ({
  requestRollback: (...args: unknown[]) => requestRollback(...args),
}));

import { ActivityTab } from '../ActivityTab';

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    findingId: 'f1',
    timestamp: Date.now(),
    category: 'crashloop',
    tool: 'restart_deployment',
    input: {},
    status: 'completed',
    beforeState: '',
    afterState: '',
    reasoning: 'Restarted web deployment',
    durationMs: 100,
    rollbackAvailable: true,
    resources: [{ kind: 'Deployment', name: 'web', namespace: 'default' }],
    ...overrides,
  };
}

describe('ActivityTab rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _monitorState.fixHistory = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a Rollback button on completed fixes with rollbackAvailable', () => {
    _monitorState.fixHistory = [makeAction()];
    render(<ActivityTab />);
    expect(screen.getByText('Rollback')).toBeDefined();
  });

  it('hides the Rollback button when rollback is not available', () => {
    _monitorState.fixHistory = [makeAction({ rollbackAvailable: false })];
    render(<ActivityTab />);
    expect(screen.queryByText('Rollback')).toBeNull();
  });

  it('hides the Rollback button for non-completed actions', () => {
    _monitorState.fixHistory = [makeAction({ status: 'failed' })];
    render(<ActivityTab />);
    expect(screen.queryByText('Rollback')).toBeNull();
  });

  it('confirms, calls the rollback endpoint, and refreshes the list', async () => {
    _monitorState.fixHistory = [makeAction()];
    requestRollback.mockResolvedValue(undefined);
    render(<ActivityTab />);

    fireEvent.click(screen.getByText('Rollback'));
    expect(screen.getByText('Roll back this fix?')).toBeDefined();
    expect(requestRollback).not.toHaveBeenCalled();

    const callsBefore = _monitorState.loadFixHistory.mock.calls.length;
    fireEvent.click(screen.getByText('Roll back'));

    await waitFor(() => {
      expect(requestRollback).toHaveBeenCalledWith('act-1');
      expect(_monitorState.loadFixHistory.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(_uiState.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Rollback executed' }),
    );
    expect(screen.queryByText('Roll back this fix?')).toBeNull();
  });

  it('does not call the endpoint when the dialog is cancelled', () => {
    _monitorState.fixHistory = [makeAction()];
    render(<ActivityTab />);

    fireEvent.click(screen.getByText('Rollback'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(requestRollback).not.toHaveBeenCalled();
    expect(screen.queryByText('Roll back this fix?')).toBeNull();
  });

  it('surfaces the agent error in the dialog on failure', async () => {
    _monitorState.fixHistory = [makeAction()];
    requestRollback.mockRejectedValue(new Error('No rollback strategy for delete_pod actions'));
    render(<ActivityTab />);

    fireEvent.click(screen.getByText('Rollback'));
    fireEvent.click(screen.getByText('Roll back'));

    await waitFor(() => {
      expect(screen.getByText('No rollback strategy for delete_pod actions')).toBeDefined();
    });
    // Dialog stays open so the operator can read the refusal
    expect(screen.getByText('Roll back this fix?')).toBeDefined();
    expect(_uiState.addToast).not.toHaveBeenCalled();
  });
});
