// @vitest-environment jsdom
/**
 * Agent › Analytics shows each number once, with its window:
 *  - fix outcomes: one card ("Fix outcomes · last 7 days"), not also an Orca
 *    30-day block and a KPI tile;
 *  - cost: the Cost Breakdown, counted in "conversations", not also in the
 *    outcomes card;
 *  - avg prompt tokens / cache hit rate: Prompt Audit only;
 *  - scanners and memory open their one home on /agent instead of drawers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { FIX, COST } = vi.hoisted(() => ({ FIX: { total_actions: 6, completed: 5, failed: 1, rolled_back: 0, success_rate: 0.83, rollback_rate: 0, avg_resolution_ms: 0, by_category: [], trend: { current_week: 0, previous_week: 0, delta: 0 }, verification: { resolved: 4, still_failing: 1, improved: 0, pending: 0, resolution_rate: 0.8 } },
  COST: { cost: { total_usd: 12.5, avg_per_incident_usd: 0.25, input_usd: 10, output_usd: 2.5, cache_savings_usd: 1 }, total_incidents: 50, by_mode: [], avg_tokens_per_incident: 1000, trend: { delta_pct: 0 } } }));

vi.mock('../../engine/analyticsApi', async (orig) => ({
  ...(await orig<object>()),
  fetchIntelligenceSections: vi.fn().mockResolvedValue(null),
  fetchPromptStats: vi.fn().mockResolvedValue({ stats: { avg_tokens: 4321, cache_hit_rate: 0.5, section_avg: {}, total_prompts: 10, static_chars: 1, dynamic_chars: 1 } }),
  fetchFixHistorySummary: vi.fn().mockResolvedValue(FIX),
  fetchScannerCoverage: vi.fn().mockResolvedValue({ active_scanners: 17, total_scanners: 17, scanners: [] }),
  fetchConfidenceCalibration: vi.fn().mockResolvedValue(null),
  fetchAccuracyStats: vi.fn().mockResolvedValue({ anti_patterns: [], avg_quality_score: 0.9, quality_trend: { delta: 0 }, override_rate: { total_proposed: 0, rate: 0, overrides: 0 }, learning: { total_patterns: 3 } }),
  fetchCostStats: vi.fn().mockResolvedValue(COST),
  fetchRecommendations: vi.fn().mockResolvedValue({ recommendations: [] }),
  fetchReadinessSummary: vi.fn().mockResolvedValue({ passed: 4, total_gates: 5 }),
}));
vi.mock('../../engine/evalStatus', () => ({ fetchAgentEvalStatus: vi.fn().mockResolvedValue(null) }));
vi.mock('../../engine/safeQuery', async (orig) => ({
  ...(await orig<object>()),
  agentFetch: vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('/api/agent/kpi')) {
      return Promise.resolve(new Response(JSON.stringify({ kpis: {
        auto_fix_success: { label: 'Fix Success', value: 0.83, unit: 'ratio', status: 'pass' },
        mttd: { label: 'Detect', value: 30, unit: 'seconds', status: 'pass' },
      } }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }),
}));
vi.mock('../toolbox/SessionAnalyticsSection', () => ({ SessionAnalyticsSection: () => null }));
vi.mock('../toolbox/PromptAuditSection', () => ({ PromptAuditSection: () => <div>Prompt Audit (30 days) · Avg Prompt Tokens 4,321</div> }));

import { AnalyticsTab } from '../toolbox/AnalyticsTab';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function renderTab() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/agent?tab=analytics']}>
        <Routes><Route path="*" element={<><AnalyticsTab /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('Agent › Analytics', () => {
  it('shows fix outcomes once, with an explicit window', async () => {
    renderTab();
    expect(await screen.findByText('Fix outcomes · last 7 days')).toBeDefined();
    await screen.findByText('Detect');
    expect(screen.queryByText('Fix Success')).toBeNull();
    expect(screen.queryByText('Fix Outcomes')).toBeNull();
    expect(screen.queryByText(/last 30 days/)).toBeNull();
  });

  it('shows cost once, counted in conversations', async () => {
    renderTab();
    expect(await screen.findByText('$12.50')).toBeDefined();
    expect(screen.getAllByText(/\$12\.50/)).toHaveLength(1);
    expect(screen.getByText('50 conversations')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/\bsessions\b/);
  });

  it('shows avg prompt tokens only in Prompt Audit', async () => {
    renderTab();
    await screen.findByText('Fix outcomes · last 7 days');
    expect(screen.getAllByText(/4,321/)).toHaveLength(1);
  });

  it('calls the agent install checks "Install health", not "Readiness"', async () => {
    renderTab();
    expect(await screen.findByText('Install health: 4/5')).toBeDefined();
    expect(screen.queryByText(/Readiness:/)).toBeNull();
  });

  it('"patterns learned" opens the Memory tab instead of a second memory drawer', async () => {
    renderTab();
    fireEvent.click(await screen.findByText(/3 patterns learned/));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agent?tab=memory'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('scanner coverage opens the Overview scanner drawer', async () => {
    renderTab();
    const coverage = await screen.findByText(/17\/17|17 scanners|Coverage/i);
    fireEvent.click(coverage);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agent?drawer=scanners'));
  });
});
