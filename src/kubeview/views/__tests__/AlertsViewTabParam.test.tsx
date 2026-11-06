// @vitest-environment jsdom
/** Alerts keeps its tab in `?tab=` through the router (useTabParam). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { renderRouted } from '../../__tests__/helpers/routerTabs';

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => selector({ addTab: vi.fn(), addToast: vi.fn(), setSelectedNamespace: vi.fn() }),
    { getState: () => ({ setSelectedNamespace: vi.fn(), addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(), impersonateUser: '', impersonateGroups: [] }) },
  ),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));
vi.mock('../../components/metrics/prometheus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));

const jsonHeaders = { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) };
const mockFetch = vi.fn();
global.fetch = mockFetch;

import AlertsView from '../AlertsView';

const selected = (name: RegExp) => screen.getByRole('tab', { name }).getAttribute('aria-selected');

describe('AlertsView tab in the URL', () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => Promise.resolve({
      ok: true, headers: jsonHeaders,
      json: () => Promise.resolve(url.includes('/rules') ? { data: { groups: [] } } : []),
    }));
  });
  afterEach(cleanup);

  it('opens Silences from a deep link', () => {
    renderRouted(<AlertsView />, '/alerts?tab=silences');
    expect(selected(/^Silences$/)).toBe('true');
  });

  it('switches on a same-page ?tab= link and on Back', async () => {
    const page = renderRouted(<AlertsView />, '/alerts');
    expect(selected(/Firing/)).toBe('true');
    await page.go('/alerts?tab=rules');
    expect(selected(/^Rules$/)).toBe('true');
    await page.back();
    expect(selected(/Firing/)).toBe('true');
  });

  it('a tab click writes ?tab= through the router; an unknown value falls back to Firing', () => {
    const page = renderRouted(<AlertsView />, '/alerts?tab=bogus');
    expect(selected(/Firing/)).toBe('true');
    expect(page.url()).toBe('/alerts');
    fireEvent.click(screen.getByRole('tab', { name: /^Rules$/ }));
    expect(page.url()).toBe('/alerts?tab=rules');
  });
});
