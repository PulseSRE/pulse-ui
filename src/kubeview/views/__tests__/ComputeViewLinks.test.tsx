// @vitest-environment jsdom
/** HyperShift NodePool audit items used to have no navigation branch at all. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const goMock = vi.fn();
vi.mock('../../store/uiStore', () => ({ useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn() }) }));
vi.mock('../../store/clusterStore', () => ({ useClusterStore: (selector: any) => selector({ isHyperShift: true, resourceRegistry: null }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({
    data: apiPath === '/api/v1/nodes'
      ? [{ metadata: { name: 'w1', uid: 'n1', labels: { 'node-role.kubernetes.io/worker': '' } }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.30' } } }]
      : [],
    isLoading: false,
  }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn((path: string) => Promise.resolve(path.includes('nodepools')
    ? [{ metadata: { name: 'workers-a', namespace: 'clusters', uid: 'np1' }, spec: { replicas: 3 }, status: { replicas: 1, conditions: [] } }]
    : [])),
  k8sGet: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: () => null }));
vi.mock('../../components/metrics/prometheus', () => ({ queryInstant: vi.fn().mockResolvedValue([]) }));

import ComputeView from '../ComputeView';

describe('ComputeView NodePool audit link', () => {
  afterEach(() => { cleanup(); goMock.mockReset(); });

  it('opens the unhealthy NodePool', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ComputeView /></MemoryRouter></QueryClientProvider>);
    const header = (await screen.findAllByText('NodePool Health')).map((el) => el.closest('button')).find(Boolean)!;
    fireEvent.click(header);
    const item = screen.getAllByText('workers-a').map((el) => el.closest('button')).filter(Boolean).pop()!;
    fireEvent.click(item);
    expect(goMock).toHaveBeenCalledWith('/r/hypershift.openshift.io~v1beta1~nodepools/clusters/workers-a', 'workers-a');
  });
});
