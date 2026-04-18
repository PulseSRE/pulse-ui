// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../store/trustStore', () => ({
  useTrustStore: Object.assign(
    (selector: any) => selector({
      trustLevel: 1,
      autoFixCategories: [],
      communicationStyle: 'brief',
      setTrustLevel: vi.fn(),
      setAutoFixCategories: vi.fn(),
      setCommunicationStyle: vi.fn(),
    }),
    { getState: () => ({ trustLevel: 1 }) },
  ),
  TRUST_LABELS: { 0: 'Observe', 1: 'Confirm', 2: 'Batch', 3: 'Bounded', 4: 'Autonomous' },
  TRUST_DESCRIPTIONS: { 0: '', 1: '', 2: '', 3: '', 4: '' },
}));

vi.mock('../../store/monitorStore', () => ({
  useMonitorStore: Object.assign(
    (selector: any) => selector({ connected: false, findings: [] }),
    { getState: () => ({ findings: [] }) },
  ),
}));

vi.mock('../../engine/analyticsApi', () => ({
  fetchFixHistorySummary: vi.fn().mockResolvedValue({ total_actions: 0, completed: 0, failed: 0, rolled_back: 0, success_rate: 0, rollback_rate: 0, avg_resolution_ms: 0, by_category: [], trend: { current_week: 0, previous_week: 0, delta: 0 }, verification: { resolved: 0, still_failing: 0, improved: 0, pending: 0, resolution_rate: 0 } }),
  fetchScannerCoverage: vi.fn().mockResolvedValue({ active_scanners: 17, total_scanners: 17, scanners: [] }),
  fetchCapabilities: vi.fn().mockResolvedValue({ max_trust_level: 4, supported_auto_fix_categories: [] }),
  fetchAgentVersion: vi.fn().mockResolvedValue(null),
  fetchAgentHealth: vi.fn().mockResolvedValue({ status: 'ok', circuit_breaker: { state: 'closed', failure_count: 0, recovery_timeout: 60 }, errors: { total: 0, by_category: {}, recent: [] }, investigations: {}, autofix_paused: false }),
  fetchAgentActivity: vi.fn().mockResolvedValue({ events: [], period_days: 7 }),
}));

vi.mock('../../engine/evalStatus', () => ({
  fetchAgentEvalStatus: vi.fn().mockResolvedValue(null),
}));

import AgentSettingsView from '../AgentSettingsView';

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderView() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/agent']}>
        <AgentSettingsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentSettingsView (redirects to PulseAgent)', () => {
  afterEach(cleanup);

  it('renders Pulse Agent page header', () => {
    renderView();
    expect(screen.getByText('Pulse Agent')).toBeDefined();
  });

  it('renders trust level selector', () => {
    renderView();
    expect(screen.getByText('Trust Level')).toBeDefined();
  });

  it('renders status sentence on overview', async () => {
    renderView();
    expect(await screen.findByText(/monitoring your cluster/i)).toBeDefined();
  });
});
