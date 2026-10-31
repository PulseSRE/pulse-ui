// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn() }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

const _mockListWatchData: Record<string, any[]> = {};
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn((path: string) => Promise.resolve(_mockListWatchData[path] || [])),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sCreate: vi.fn().mockResolvedValue({}),
  k8sDelete: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));
vi.mock('../../components/feedback/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));
vi.mock('../../components/primitives/Card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

import OperatorCatalogView from '../OperatorCatalogView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OperatorCatalogView />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OperatorCatalogView', () => {
  afterEach(() => { cleanup(); Object.keys(_mockListWatchData).forEach(k => delete _mockListWatchData[k]); });

  it('renders the page header', () => {
    renderView();
    expect(screen.getByText('Operator Catalog')).toBeDefined();
  });

  it('renders search input', () => {
    renderView();
    expect(screen.getByPlaceholderText('Search operators...')).toBeDefined();
  });

  it('renders the All filter button', () => {
    renderView();
    expect(screen.getByText(/All \(/)).toBeDefined();
  });

  it('renders operator cards from mock data', async () => {
    _mockListWatchData['/apis/packages.operators.coreos.com/v1/packagemanifests'] = [
      {
        metadata: { name: 'cluster-logging' },
        status: {
          catalogSource: 'redhat-operators',
          catalogSourceNamespace: 'openshift-marketplace',
          channels: [{
            name: 'stable-6.0',
            currentCSV: 'cluster-logging.v6.0.0',
            currentCSVDesc: {
              displayName: 'Cluster Logging',
              description: 'Collect and forward logs from your cluster.',
              icon: [],
              version: '6.0.0',
              provider: { name: 'Red Hat' },
              installModes: [{ type: 'AllNamespaces', supported: true }],
            },
          }],
          defaultChannel: 'stable-6.0',
          provider: { name: 'Red Hat' },
        },
      },
    ];
    renderView();
    // Wait for the query to resolve and render
    const card = await screen.findByText('Cluster Logging');
    expect(card).toBeDefined();
  });

  it('filters operators by search text', async () => {
    _mockListWatchData['/apis/packages.operators.coreos.com/v1/packagemanifests'] = [
      {
        metadata: { name: 'cluster-logging' },
        status: {
          catalogSource: 'redhat-operators',
          catalogSourceNamespace: 'openshift-marketplace',
          channels: [{ name: 'stable', currentCSV: 'cl.v1', currentCSVDesc: { displayName: 'Cluster Logging', description: 'Logs', icon: [], version: '1.0', provider: { name: 'RH' }, installModes: [] } }],
          defaultChannel: 'stable',
          provider: { name: 'RH' },
        },
      },
      {
        metadata: { name: 'quay-operator' },
        status: {
          catalogSource: 'redhat-operators',
          catalogSourceNamespace: 'openshift-marketplace',
          channels: [{ name: 'stable', currentCSV: 'q.v1', currentCSVDesc: { displayName: 'Quay', description: 'Registry', icon: [], version: '1.0', provider: { name: 'RH' }, installModes: [] } }],
          defaultChannel: 'stable',
          provider: { name: 'RH' },
        },
      },
    ];
    renderView();
    await screen.findByText('Cluster Logging');

    const searchInput = screen.getByPlaceholderText('Search operators...');
    fireEvent.change(searchInput, { target: { value: 'quay' } });

    expect(screen.getByText('Quay')).toBeDefined();
    expect(screen.queryByText('Cluster Logging')).toBeNull();
  });

  it('shows a load error, not "0 operators from 0 sources", when packagemanifests cannot be read', async () => {
    const { k8sList } = await import('../../engine/query');
    vi.mocked(k8sList).mockImplementation((path: string) =>
      path.includes('packagemanifests')
        ? Promise.reject(Object.assign(new Error('forbidden'), { statusCode: 403 }))
        : Promise.resolve(_mockListWatchData[path] || []),
    );
    renderView();
    expect(await screen.findByText('The operator catalog could not be loaded')).toBeDefined();
    expect(screen.getByText('Catalog could not be read')).toBeDefined();
    expect(document.body.textContent).not.toMatch(/0 operators available/);
    vi.mocked(k8sList).mockImplementation((path: string) => Promise.resolve(_mockListWatchData[path] || []));
  });

  it('says when a search matches nothing instead of showing a blank grid', async () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText('Search operators...'), { target: { value: 'zzz-nothing' } });
    expect(await screen.findByText(/No operators (match your search|in the catalog)/)).toBeDefined();
  });
});
