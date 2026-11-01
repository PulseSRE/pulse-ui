/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../components/metrics/prometheus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryInstant: vi.fn().mockResolvedValue([{ value: 0.65 }]),
}));
vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
}));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import { CapacityTab } from '../compute/CapacityTab';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CapacityTab />
    </QueryClientProvider>
  );
}

describe('CapacityTab', () => {
  afterEach(() => { cleanup(); });

  it('renders "Capacity Planning" heading', () => {
    renderTab();
    expect(screen.getByText('Capacity Planning')).toBeDefined();
  });

  it('renders lookback selector with 7d, 30d, 90d buttons', () => {
    renderTab();
    expect(screen.getByText('7d')).toBeDefined();
    expect(screen.getByText('30d')).toBeDefined();
    expect(screen.getByText('90d')).toBeDefined();
  });

  it('renders 4 ExhaustionCards (CPU, Memory, Disk, Pods)', async () => {
    renderTab();
    // Wait for queries to resolve and cards to render
    await vi.waitFor(() => {
      expect(screen.getByText('CPU')).toBeDefined();
      expect(screen.getByText('Memory')).toBeDefined();
      expect(screen.getByText('Disk')).toBeDefined();
      expect(screen.getByText('Pods')).toBeDefined();
    });
  });

  it('shows disclaimer text about linear regression', async () => {
    renderTab();
    await vi.waitFor(() => {
      expect(screen.getByText(/linear regression/)).toBeDefined();
    });
  });

  it('does not repeat the Overview tab\'s CPU / memory / disk / pod trend charts', async () => {
    renderTab();
    await vi.waitFor(() => expect(screen.getByText(/linear regression/)).toBeDefined());
    expect(screen.queryAllByTestId('metric-card')).toHaveLength(0);
    expect(screen.queryByText('Resource Trends')).toBeNull();
  });
});
