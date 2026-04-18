// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../store/trustStore', () => ({
  useTrustStore: Object.assign(
    (selector: any) => selector({
      trustLevel: 2,
      autoFixCategories: ['crashloop'],
      communicationStyle: 'detailed',
      setTrustLevel: vi.fn(),
      setAutoFixCategories: vi.fn(),
      setCommunicationStyle: vi.fn(),
    }),
    { getState: () => ({ trustLevel: 2 }) },
  ),
  TRUST_LABELS: { 0: 'Observe', 1: 'Confirm', 2: 'Batch', 3: 'Bounded', 4: 'Autonomous' },
  TRUST_DESCRIPTIONS: { 0: 'Observe', 1: 'Confirm', 2: 'Batch', 3: 'Bounded', 4: 'Autonomous' },
}));

vi.mock('../../store/monitorStore', () => ({
  useMonitorStore: Object.assign(
    (selector: any) => selector({ connected: true, findings: [] }),
    { getState: () => ({ findings: [] }) },
  ),
}));

vi.mock('../../engine/analyticsApi', () => ({
  fetchFixHistorySummary: vi.fn().mockResolvedValue({ total_actions: 0, completed: 0, failed: 0, rolled_back: 0, success_rate: 0, rollback_rate: 0, avg_resolution_ms: 0, by_category: [], trend: { current_week: 0, previous_week: 0, delta: 0 }, verification: { resolved: 0, still_failing: 0, improved: 0, pending: 0, resolution_rate: 0 } }),
  fetchScannerCoverage: vi.fn().mockResolvedValue({ active_scanners: 17, total_scanners: 17, scanners: [] }),
  fetchCapabilities: vi.fn().mockResolvedValue({ max_trust_level: 3, supported_auto_fix_categories: ['crashloop'] }),
  fetchAgentVersion: vi.fn().mockResolvedValue({ agent: '2.4.0', protocol: '2', tools: 118, skills: 7 }),
  fetchAgentHealth: vi.fn().mockResolvedValue({ status: 'ok', circuit_breaker: { state: 'closed', failure_count: 0, recovery_timeout: 60 }, errors: { total: 0, by_category: {}, recent: [] }, investigations: {}, autofix_paused: false }),
  fetchAgentActivity: vi.fn().mockResolvedValue({ events: [], period_days: 7 }),
}));

vi.mock('../../engine/evalStatus', () => ({
  fetchAgentEvalStatus: vi.fn().mockResolvedValue(null),
}));

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function renderView() {
  const PulseAgentView = (await import('../PulseAgentView')).default;
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/agent']}>
        <PulseAgentView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PulseAgentView', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders page header', async () => {
    await renderView();
    expect(screen.getByText('Pulse Agent')).toBeDefined();
  });

  it('renders tab bar with all tabs', async () => {
    await renderView();
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Tools')).toBeDefined();
    expect(screen.getByText('Skills')).toBeDefined();
    expect(screen.getByText('SkillPlan')).toBeDefined();
    expect(screen.getByText('MCP')).toBeDefined();
    expect(screen.getByText('Analytics')).toBeDefined();
  });

  it('defaults to overview tab with status sentence', async () => {
    await renderView();
    expect(await screen.findByText(/monitoring your cluster/i)).toBeDefined();
  });

  it('renders trust controls on overview', async () => {
    await renderView();
    expect(screen.getByText('Trust Level')).toBeDefined();
  });

  it('renders version info in footer', async () => {
    await renderView();
    expect(await screen.findByText(/v2\.4\.0/)).toBeDefined();
    expect(await screen.findByText(/118 tools/)).toBeDefined();
    expect(await screen.findByText(/7 skills/)).toBeDefined();
  });

  it('shows empty activity state', async () => {
    await renderView();
    expect(await screen.findByText(/no activity yet/i)).toBeDefined();
  });
});
