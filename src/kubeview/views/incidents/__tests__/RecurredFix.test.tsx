// @vitest-environment jsdom
// A "verified, then recurred" fix is a verdict the agent retroactively
// withdrew: it must render as a warning everywhere, never as a success.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../../engine/safeQuery', () => ({ agentFetch: vi.fn() }));
vi.mock('../../../engine/gvr', () => ({ resourceDetailUrl: () => '/r/mock/resource' }));
vi.mock('../shared/InvestigationCard', () => ({ InvestigationCard: () => null }));
vi.mock('../shared/PostmortemCard', () => ({ PostmortemCard: () => null }));
vi.mock('../shared/CorrelationGroupRow', () => ({ CorrelationGroupRow: () => null }));

// One dispatch table for every component under test: OutcomesDrawer asks for
// the summary and the resolutions list, the lifecycle drawer for calibration.
const queryData: Record<string, unknown> = {};
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryData[String(queryKey[0])],
    isLoading: false,
  }),
}));
vi.mock('../../../engine/analyticsApi', () => ({
  fetchLearningFeed: vi.fn(),
  fetchResolutions: vi.fn(),
  fetchFixHistorySummary: vi.fn(),
  fetchConfidenceCalibration: vi.fn(),
}));

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

const _lifecycle = {
  detection: null as unknown,
  impact: null,
  investigation: null,
  action: null as unknown,
  verification: null as unknown,
  postmortem: null,
  learning: null,
  isLoading: false,
};
vi.mock('../../../hooks/useIncidentLifecycle', () => ({
  useIncidentLifecycle: () => _lifecycle,
}));

import { ActivityTab } from '../ActivityTab';
import { IncidentLifecycleDrawer } from '../IncidentLifecycleDrawer';
import { OutcomesDrawer } from '../../mission-control/OutcomesDrawer';

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
    rollbackAvailable: false,
    resources: [{ kind: 'Deployment', name: 'web', namespace: 'default' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _monitorState.fixHistory = [];
  _lifecycle.action = null;
  _lifecycle.verification = null;
  for (const k of Object.keys(queryData)) delete queryData[k];
});

afterEach(() => {
  cleanup();
});

describe('ActivityTab recurred fixes', () => {
  it('flags a recurred fix in the title and downgrades it to a warning', () => {
    _monitorState.fixHistory = [makeAction({ verificationStatus: 'verified_then_recurred' })];
    render(<ActivityTab />);
    const title = screen.getByText(/verified, then recurred/);
    expect(title.textContent).toContain('completed (verified, then recurred)');
    // The severity chip is the element labeled with the category config label.
    const chip = screen.getByText('Events', { selector: 'span' });
    expect(chip.className).toContain('bg-amber-900/50');
  });

  it('leaves a plainly verified fix as a normal entry', () => {
    _monitorState.fixHistory = [makeAction({ verificationStatus: 'verified' })];
    render(<ActivityTab />);
    expect(screen.queryByText(/then recurred/)).toBeNull();
    const chip = screen.getByText('Events', { selector: 'span' });
    expect(chip.className).toContain('bg-slate-800');
  });
});

describe('IncidentLifecycleDrawer recurred verification', () => {
  it('renders the recurred badge as an amber warning, not a success', () => {
    _lifecycle.action = makeAction({ verificationStatus: 'verified_then_recurred' });
    render(<IncidentLifecycleDrawer findingId="f1" onClose={() => {}} />);
    const badge = screen.getByText('verified, then recurred');
    expect(badge.className).toContain('bg-amber-900/50');
    expect(badge.className).not.toContain('emerald');
  });

  it('renders a live verification_report with recurred status the same way', () => {
    _lifecycle.verification = {
      id: 'v1',
      actionId: 'act-1',
      findingId: 'f1',
      status: 'verified_then_recurred',
      evidence: 'Condition returned 12 min after verification',
      timestamp: Date.now(),
    };
    render(<IncidentLifecycleDrawer findingId="f1" onClose={() => {}} />);
    const badge = screen.getByText('verified, then recurred');
    expect(badge.className).toContain('bg-amber-900/50');
    expect(screen.getByText('Condition returned 12 min after verification')).toBeDefined();
  });
});

describe('OutcomesDrawer recurred outcomes', () => {
  const summary = {
    total_actions: 10,
    completed: 8,
    failed: 1,
    rolled_back: 1,
    success_rate: 0.8,
    rollback_rate: 0.1,
    avg_resolution_ms: 60000,
    by_category: [],
    trend: { current_week: 5, previous_week: 5, delta: 0 },
    verification: {
      resolved: 5,
      still_failing: 1,
      improved: 0,
      recurred: 2,
      pending: 2,
      resolution_rate: 0.5,
    },
  };

  const recurredResolution = {
    id: 'r1',
    findingId: 'f2',
    category: 'crashloop',
    tool: 'restart_deployment',
    status: 'completed',
    reasoning: 'Restarted web deployment',
    outcome: 'verified_then_recurred',
    evidence: 'Same condition returned 12 min after verification',
    timestamp: Date.now(),
    verifiedAt: Date.now(),
    durationMs: 100,
    timeToVerifyMs: 30_000,
  };

  const verifiedResolution = {
    ...recurredResolution,
    id: 'r2',
    findingId: 'f3',
    outcome: 'verified',
    evidence: 'No active findings',
  };

  it('shows the recurred count and labels the outcome as a warning', () => {
    queryData['fix-history-summary'] = summary;
    queryData['resolutions'] = { resolutions: [recurredResolution, verifiedResolution], total: 2 };
    render(<OutcomesDrawer onClose={() => {}} />);

    expect(screen.getByText('2 recurred')).toBeDefined();
    const badge = screen.getByText('Verified, then recurred');
    expect(badge.className).toContain('bg-amber-900/40');
    expect(badge.className).not.toContain('emerald');
  });

  it('filters to only recurred outcomes via the Recurred chip', () => {
    queryData['fix-history-summary'] = summary;
    queryData['resolutions'] = { resolutions: [recurredResolution, verifiedResolution], total: 2 };
    render(<OutcomesDrawer onClose={() => {}} />);

    fireEvent.click(screen.getByText('Recurred'));
    expect(screen.getByText('Verified, then recurred')).toBeDefined();
    expect(screen.queryByText('Resolved', { selector: 'span' })).toBeNull();
  });
});
