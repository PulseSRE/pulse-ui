// @vitest-environment jsdom
/** IngressControllers are namespaced (openshift-ingress-operator); their links must say so. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const goMock = vi.fn();
vi.mock('../../store/uiStore', () => ({ useUIStore: (s: any) => s({ selectedNamespace: '*', addTab: vi.fn() }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
const degraded = {
  apiVersion: 'operator.openshift.io/v1', kind: 'IngressController',
  metadata: { name: 'sharded', namespace: 'openshift-ingress-operator', uid: 'ic1' },
  status: { conditions: [{ type: 'Available', status: 'False' }], availableReplicas: 0 },
};
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn((path: string) => Promise.resolve(path.includes('ingresscontrollers') ? [degraded] : [])),
  k8sGet: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../../components/metrics/prometheus', () => ({ queryInstant: vi.fn().mockResolvedValue([]) }));

import NetworkingView from '../NetworkingView';

function r() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><NetworkingView /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const DETAIL = '/r/operator.openshift.io~v1~ingresscontrollers/openshift-ingress-operator/sharded';

describe('NetworkingView IngressController links', () => {
  afterEach(() => { cleanup(); goMock.mockReset(); });

  it('an IngressController row opens its namespaced detail page', async () => {
    r();
    const row = await waitFor(() => screen.getByText('Ingress Controllers').closest('div')!.parentElement!.querySelector('button')!);
    expect(row.textContent).toContain('sharded');
    fireEvent.click(row);
    expect(goMock).toHaveBeenCalledWith(DETAIL, 'sharded');
  });

  it('the health-audit item links to the namespaced detail page, not /_/', async () => {
    r();
    await screen.findByText('sharded'); // controllers loaded
    const header = screen.getAllByText('Ingress Controller Health').map((el) => el.closest('button')).find(Boolean)!;
    fireEvent.click(header);
    const items = screen.getAllByText('sharded').map((el) => el.closest('button')).filter(Boolean) as HTMLElement[];
    fireEvent.click(items[items.length - 1]);
    expect(goMock).toHaveBeenLastCalledWith(DETAIL, expect.any(String));
  });
});
