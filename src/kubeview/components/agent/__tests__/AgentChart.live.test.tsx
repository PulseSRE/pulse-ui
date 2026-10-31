// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryRangeMock = vi.fn();
const queryInstantMock = vi.fn();
vi.mock('../../metrics/prometheus', async () => ({
  ...(await vi.importActual<object>('../../metrics/prometheus')),
  queryRange: (...a: any[]) => queryRangeMock(...a),
  queryInstant: (...a: any[]) => queryInstantMock(...a),
}));

import AgentChart, { placeAnnotations, annotationTime } from '../AgentChart';
import { chartRefreshSettings } from '../../../hooks/useChartLiveData';
import { normalizeAgentProps } from '../../../engine/normalizeAgentProps';
import { AgentStatCard } from '../renderers/VisualizationRenderer';
import type { ChartSpec, ComponentSpec } from '../../../engine/agentComponents';

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('chart refresh settings', () => {
  it('the spec refreshInterval (seconds) overrides the view refresh', () => {
    expect(chartRefreshSettings({ kind: 'chart', series: [], refreshInterval: 15 } as ChartSpec, 60_000)).toEqual({ refreshMs: 15_000, timeRange: '1h', step: undefined });
    expect(chartRefreshSettings({ kind: 'chart', series: [] } as ChartSpec, 30_000).refreshMs).toBe(30_000);
  });
  it('live is a 15m window refreshed every 10s with a matching step', () => {
    expect(chartRefreshSettings({ kind: 'chart', series: [], live: true } as ChartSpec)).toEqual({ refreshMs: 10_000, timeRange: '15m', step: 10 });
    expect(chartRefreshSettings({ kind: 'chart', series: [], live: true, timeRange: '5m', step: 2 } as ChartSpec)).toEqual({ refreshMs: 10_000, timeRange: '5m', step: 2 });
  });
  it('a live chart queries its sliding window with the step', async () => {
    queryRangeMock.mockResolvedValue([{ metric: { pod: 'a' }, values: [[1000, '1'], [1010, '2']] }]);
    withQuery(<AgentChart spec={{ kind: 'chart', title: 'RPS', series: [], query: 'rate(x[1m])', live: true } as ChartSpec} />);
    await waitFor(() => expect(queryRangeMock).toHaveBeenCalled());
    const [q, start, end, step] = queryRangeMock.mock.calls[0];
    expect(q).toBe('rate(x[1m])');
    expect(end - start).toBe(15 * 60);
    expect(step).toBe(10);
  });
});

describe('chart annotations', () => {
  it('reads ms, seconds and ISO timestamps', () => {
    expect(annotationTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(annotationTime(1_700_000_000)).toBe(1_700_000_000_000);
    expect(annotationTime('2026-10-30T10:00:00Z')).toBe(Date.parse('2026-10-30T10:00:00Z'));
    expect(annotationTime('nonsense')).toBeNull();
  });

  it('snaps to the nearest sample and leaves out-of-range ones undrawn', () => {
    const t0 = 1_761_800_000_000;
    const placed = placeAnnotations([
      { timestamp: t0 + 64_000, label: 'deploy v2', kind: 'rollout' },
      { timestamp: t0 + 3_600_000, label: 'too late', kind: 'alert' },
      { timestamp: new Date(t0 + 60_000).toISOString(), label: 'odd', kind: 'bogus' as never },
    ], [t0, t0 + 60_000, t0 + 120_000]);
    expect(placed.map((p) => [p.label, p.x, p.kind])).toEqual([['deploy v2', t0 + 60_000, 'rollout'], ['too late', null, 'alert'], ['odd', t0 + 60_000, 'config']]);
  });

  it('lists annotations under the chart by kind', () => {
    render(<QueryClientProvider client={new QueryClient()}><AgentChart spec={{
      kind: 'chart', title: 'Latency',
      series: [{ label: 'p99', data: [[1_000, 1], [2_000, 3], [3_000, 2]] }],
      annotations: [{ timestamp: 2_000, label: 'api v2 rolled out', kind: 'rollout' }, { timestamp: 3_000, label: 'HighLatency fired', kind: 'alert' }],
    } as ChartSpec} /></QueryClientProvider>);
    const list = screen.getByRole('list', { name: 'Chart annotations' });
    expect(list.textContent).toContain('rollout');
    expect(list.textContent).toContain('api v2 rolled out');
    expect(list.textContent).toContain('HighLatency fired');
  });

  it('accepts the old time_range field name', () => {
    const spec = normalizeAgentProps({ kind: 'chart', series: [], time_range: '6h' } as unknown as ComponentSpec) as ChartSpec;
    expect(spec.timeRange).toBe('6h');
    expect((spec as unknown as Record<string, unknown>).time_range).toBeUndefined();
  });
});

describe('stat_card live value', () => {
  it('re-queries on refreshInterval and shows the newest value', async () => {
    queryInstantMock.mockResolvedValueOnce([{ metric: {}, value: 4 }]).mockResolvedValue([{ metric: {}, value: 9 }]);
    withQuery(<AgentStatCard spec={{ kind: 'stat_card', title: 'Ready pods', query: 'sum(up)', refreshInterval: 1, value: '1' }} />);
    expect(await screen.findByText('4')).toBeDefined();
    expect(screen.queryByText('1')).toBeNull();
    expect(await screen.findByText('9', {}, { timeout: 2500 })).toBeDefined();
    expect(queryInstantMock.mock.calls[0]).toEqual(['sum(up)', undefined, 'local']);
  });

  it('shows "—" and says why when Prometheus cannot be queried and there is no snapshot', async () => {
    queryInstantMock.mockRejectedValue(new Error('503'));
    withQuery(<AgentStatCard spec={{ kind: 'stat_card', title: 'Ready pods', query: 'sum(up)' }} />);
    expect(await screen.findByText('could not query Prometheus', {}, { timeout: 3000 })).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
  });
});
