// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
const listState = { isError: false, error: null as unknown, refetch: vi.fn() };
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: mockData[apiPath] || [], isLoading: false, ...listState }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import CRDsView from '../CRDsView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CRDsView /></MemoryRouter></QueryClientProvider>);
}

const makeCRD = (name: string, group: string, kind: string, scope: string = 'Namespaced') => ({
  metadata: { name: `${name}.${group}`, uid: name, creationTimestamp: '2025-01-01T00:00:00Z' },
  spec: {
    group,
    names: { kind, plural: name, singular: name.slice(0, -1), shortNames: [] },
    scope,
    versions: [{ name: 'v1', served: true, storage: true }],
  },
  status: { conditions: [{ type: 'Established', status: 'True' }] },
});

describe('CRDsView', () => {
  afterEach(() => { cleanup(); Object.keys(mockData).forEach(k => delete mockData[k]); });

  it('renders page header', () => {
    renderView();
    expect(screen.getAllByText('Custom Resource Definitions').length).toBeGreaterThanOrEqual(1);
  });

  it('shows stat cards', () => {
    renderView();
    expect(screen.getAllByText('Total CRDs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('API Groups').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Namespaced').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cluster-scoped').length).toBeGreaterThanOrEqual(1);
  });

  it('shows search input', () => {
    renderView();
    expect(screen.getByPlaceholderText(/Search by name/)).toBeDefined();
  });

  it('says no CRDs are installed when the list is genuinely empty', () => {
    renderView();
    expect(screen.getByText('No CRDs are installed')).toBeDefined();
  });

  it('shows a load error with retry, not "No CRDs match your filters", when the list fails', () => {
    listState.isError = true;
    listState.error = new Error('forbidden');
    try {
      renderView();
      expect(screen.getByRole('alert').textContent).toContain('CustomResourceDefinitions could not be loaded');
      expect(screen.queryByText(/No CRDs match/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(listState.refetch).toHaveBeenCalled();
    } finally {
      listState.isError = false;
      listState.error = null;
    }
  });

  it('renders CRDs grouped by API group', () => {
    mockData['/apis/apiextensions.k8s.io/v1/customresourcedefinitions'] = [
      makeCRD('widgets', 'example.com', 'Widget'),
      makeCRD('gadgets', 'example.com', 'Gadget'),
      makeCRD('things', 'other.io', 'Thing', 'Cluster'),
    ];
    renderView();
    expect(screen.getAllByText('Widget').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Gadget').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Thing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/example.com/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/other.io/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows scope badges', () => {
    mockData['/apis/apiextensions.k8s.io/v1/customresourcedefinitions'] = [
      makeCRD('widgets', 'example.com', 'Widget', 'Namespaced'),
      makeCRD('things', 'other.io', 'Thing', 'Cluster'),
    ];
    renderView();
    expect(screen.getAllByText('Namespaced').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cluster').length).toBeGreaterThanOrEqual(1);
  });

  it('has Instances button for each CRD', () => {
    mockData['/apis/apiextensions.k8s.io/v1/customresourcedefinitions'] = [
      makeCRD('widgets', 'example.com', 'Widget'),
    ];
    renderView();
    expect(screen.getAllByText(/Instances/).length).toBeGreaterThanOrEqual(1);
  });

  it('filters by search query', () => {
    mockData['/apis/apiextensions.k8s.io/v1/customresourcedefinitions'] = [
      makeCRD('widgets', 'example.com', 'Widget'),
      makeCRD('things', 'other.io', 'Thing'),
    ];
    renderView();
    const input = screen.getByPlaceholderText(/Search by name/);
    fireEvent.change(input, { target: { value: 'widget' } });
    expect(screen.getAllByText('Widget').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Thing')).toBeNull();
  });
});
