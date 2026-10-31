// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn() }),
}));
const mockData: Record<string, any[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: mockData[apiPath] || [], isLoading: false }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
const k8sList = vi.fn();
vi.mock('../../engine/query', () => ({ k8sList: (...a: unknown[]) => k8sList(...a), k8sGet: vi.fn().mockResolvedValue(null) }));
vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
}));
vi.mock('../../components/metrics/prometheus', () => ({ queryInstant: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import StorageView from '../StorageView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><StorageView /></MemoryRouter></QueryClientProvider>);
}

describe('StorageView', () => {
  beforeEach(() => { k8sList.mockReset(); k8sList.mockResolvedValue([]); });
  afterEach(() => { cleanup(); Object.keys(mockData).forEach(k => delete mockData[k]); });

  it('renders page header', () => {
    renderView();
    expect(document.body.textContent).toContain('Storage');
  });

  it('shows stat cards', () => {
    renderView();
    expect(document.body.textContent).toContain('PVCs');
    expect(document.body.textContent).toContain('Persistent Volumes');
    expect(document.body.textContent).toContain('Storage Classes');
  });

  it('shows metric cards', () => {
    renderView();
    expect(screen.getAllByTestId('metric-card').length).toBeGreaterThanOrEqual(2);
  });

  it('shows storage classes panel', () => {
    renderView();
    expect(document.body.textContent).toMatch(/Storage Classes/);
  });

  it('shows CSI drivers section', () => {
    renderView();
    expect(document.body.textContent).toMatch(/CSI Drivers/);
  });

  it('renders page with no data without crashing', () => {
    const { container } = renderView();
    expect(container.querySelector('.bg-slate-950')).toBeDefined();
  });

  it('does not raise "No StorageClasses configured" while the list is loading', () => {
    k8sList.mockReturnValue(new Promise(() => {}));
    renderView();
    expect(document.body.textContent).not.toMatch(/No StorageClasses configured|No default StorageClass set/);
    expect(screen.getAllByText('Loading storage classes…').length).toBeGreaterThan(0);
  });

  it('shows a load error, not "no StorageClasses", when the list is forbidden', async () => {
    k8sList.mockImplementation((path: string) =>
      path.includes('storageclasses') ? Promise.reject(Object.assign(new Error('forbidden'), { statusCode: 403 })) : Promise.resolve([]));
    renderView();
    await waitFor(() => expect(screen.getByText('StorageClasses could not be loaded')).toBeDefined());
    expect(document.body.textContent).not.toMatch(/No StorageClasses configured|No default StorageClass set|No storage classes configured/);
  });

  it('fails the Default StorageClass check when there are no classes at all', async () => {
    mockData['/api/v1/persistentvolumeclaims'] = [{ metadata: { name: 'data', namespace: 'app', uid: 'p1' }, spec: {}, status: { phase: 'Bound' } }];
    renderView();
    await waitFor(() => expect(screen.getByText('Default StorageClass')).toBeDefined());
    const check = screen.getByText('Default StorageClass').closest('button')!;
    expect(check.textContent).toContain('1 of 1 need attention');
  });
});
