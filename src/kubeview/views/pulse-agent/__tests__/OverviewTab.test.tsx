// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../../store/trustStore', () => ({
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

vi.mock('../../../store/monitorStore', () => ({
  useMonitorStore: Object.assign(
    (selector: any) => selector({ connected: true, findings: [] }),
    { getState: () => ({ findings: [] }) },
  ),
}));

vi.mock('../../../engine/analyticsApi', () => ({
  fetchFixHistorySummary: vi.fn().mockResolvedValue({ total_actions: 0, completed: 0, failed: 0, rolled_back: 0, success_rate: 0, rollback_rate: 0, avg_resolution_ms: 0, by_category: [], trend: { current_week: 0, previous_week: 0, delta: 0 }, verification: { resolved: 0, still_failing: 0, improved: 0, pending: 0, resolution_rate: 0 } }),
  fetchScannerCoverage: vi.fn().mockResolvedValue({ active_scanners: 17, total_scanners: 17, scanners: [] }),
  fetchCapabilities: vi.fn().mockResolvedValue({ max_trust_level: 3, supported_auto_fix_categories: ['crashloop'] }),
  fetchAgentVersion: vi.fn().mockResolvedValue({ agent: '2.4.0', protocol: '2', tools: 118, skills: 7 }),
  fetchAgentHealth: vi.fn().mockResolvedValue({ status: 'ok', circuit_breaker: { state: 'closed', failure_count: 0, recovery_timeout: 60 }, errors: { total: 0, by_category: {}, recent: [] }, investigations: {}, autofix_paused: false }),
  fetchAgentActivity: vi.fn().mockResolvedValue({ events: [], period_days: 7 }),
}));

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function renderTab() {
  const { OverviewTab } = await import('../OverviewTab');
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <OverviewTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewTab', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders status sentence', async () => {
    await renderTab();
    expect(await screen.findByText(/monitoring your cluster/i)).toBeDefined();
  });

  it('renders clickable scanner count', async () => {
    await renderTab();
    expect(await screen.findByRole('button', { name: /scanners/ })).toBeDefined();
  });

  it('renders empty activity state', async () => {
    await renderTab();
    expect(await screen.findByText(/no activity yet/i)).toBeDefined();
  });

  it('renders trust controls', async () => {
    await renderTab();
    expect(screen.getByText('Browser trust preference')).toBeDefined();
  });

  it('renders version footer with clickable links', async () => {
    await renderTab();
    expect(await screen.findByText(/v2\.4\.0/)).toBeDefined();
    expect(await screen.findByText(/118 tools/)).toBeDefined();
    expect(await screen.findByText(/7 skills/)).toBeDefined();
  });
});

describe('OverviewTab links', () => {
  afterEach(() => { cleanup(); });

  it('"N auto-fixed" opens the agent-cleared inbox, not needs-attention', async () => {
    const api = await import('../../../engine/analyticsApi');
    vi.mocked(api.fetchFixHistorySummary).mockResolvedValueOnce({ total_actions: 4, completed: 4, failed: 0, rolled_back: 0 } as never);
    await renderTab();
    const link = (await screen.findByText(/4 auto-fixed/)).closest('a')!;
    expect(link.getAttribute('href')).toBe('/inbox?preset=agent_cleared');
  });

  it('maps legacy /incidents activity links to the Inbox activity tab and refuses unknown ones', async () => {
    const api = await import('../../../engine/analyticsApi');
    vi.mocked(api.fetchAgentActivity).mockResolvedValueOnce({
      period_days: 7,
      events: [
        { type: 'auto_fix', description: 'Restarted web', link: '/incidents?tab=actions' },
        { type: 'investigation', description: 'Looked at db', link: '/incidents' },
        { type: 'scan', description: 'Weird link', link: '/nowhere' },
      ],
    } as never);
    await renderTab();
    expect((await screen.findByText('Restarted web')).closest('a')!.getAttribute('href')).toBe('/inbox?tab=activity');
    expect(screen.getByText('Looked at db').closest('a')!.getAttribute('href')).toBe('/inbox?tab=activity');
    expect(screen.getByText('Weird link').closest('a')).toBeNull();
  });
});

describe('OverviewTab honest status', () => {
  afterEach(() => { cleanup(); });

  it('calls fix actions fix actions, not "issues detected"', async () => {
    const api = await import('../../../engine/analyticsApi');
    vi.mocked(api.fetchFixHistorySummary).mockResolvedValueOnce({ total_actions: 3, completed: 2, failed: 1, rolled_back: 0 } as never);
    await renderTab();
    expect(await screen.findByText('3 fix actions')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/detected/);
  });

  it('shows status unknown, not "0 scanners active, no issues detected", when the reads fail', async () => {
    const api = await import('../../../engine/analyticsApi');
    vi.mocked(api.fetchFixHistorySummary).mockRejectedValueOnce(new Error('Analytics API error: 503'));
    vi.mocked(api.fetchScannerCoverage).mockRejectedValueOnce(new Error('Analytics API error: 503'));
    await renderTab();
    expect(await screen.findByText(/Pulse status is unknown — fix history and scanner coverage could not be loaded/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/no issues detected/);
    expect(document.body.textContent).not.toMatch(/0 scanners/);
  });
});
