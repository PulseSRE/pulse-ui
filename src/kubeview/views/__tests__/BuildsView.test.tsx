// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn() }),
}));
const mockData: Record<string, any[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: mockData[apiPath] || [], isLoading: false }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
const k8sCreate = vi.fn().mockResolvedValue({});
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), k8sCreate: (...a: unknown[]) => k8sCreate(...a), k8sPatch: vi.fn() }));
let canStart = true;
vi.mock('../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: canStart, isLoading: false }) }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import BuildsView from '../BuildsView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><BuildsView /></MemoryRouter></QueryClientProvider>);
}

describe('BuildsView', () => {
  afterEach(() => { cleanup(); Object.keys(mockData).forEach(k => delete mockData[k]); });

  it('renders page header', () => {
    renderView();
    expect(screen.getAllByText('Builds').length).toBeGreaterThanOrEqual(1);
  });

  it('shows stat cards', () => {
    renderView();
    expect(screen.getAllByText('BuildConfigs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Builds').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ImageStreams').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Image Tags').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state for BuildConfigs', () => {
    renderView();
    expect(screen.getAllByText(/No BuildConfigs/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders with build data', () => {
    mockData['/apis/build.openshift.io/v1/builds'] = [{
      metadata: { name: 'my-build-1', namespace: 'test', uid: '1', creationTimestamp: '2025-01-01T00:00:00Z' },
      spec: { strategy: { type: 'Docker' } },
      status: { phase: 'Complete', startTimestamp: '2025-01-01T00:00:00Z', completionTimestamp: '2025-01-01T00:01:00Z' },
    }];
    renderView();
    expect(screen.getAllByText('my-build-1').length).toBeGreaterThanOrEqual(1);
  });

  it('renders with buildconfig data', () => {
    mockData['/apis/build.openshift.io/v1/buildconfigs'] = [{
      metadata: { name: 'my-bc', namespace: 'test', uid: '1' },
      spec: { strategy: { type: 'Docker' }, source: { type: 'Git', git: { uri: 'https://github.com/example/repo' } } },
    }];
    renderView();
    expect(screen.getAllByText('my-bc').length).toBeGreaterThanOrEqual(1);
  });

  it('renders imagestream with tags', () => {
    mockData['/apis/image.openshift.io/v1/imagestreams'] = [{
      metadata: { name: 'my-is', namespace: 'test', uid: '1' },
      status: { dockerImageRepository: 'image-registry.openshift-image-registry.svc:5000/test/my-is', tags: [{ tag: 'latest' }, { tag: 'v1.0' }] },
    }];
    renderView();
    expect(screen.getAllByText('my-is').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('latest').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('v1.0').length).toBeGreaterThanOrEqual(1);
  });

  it('Start build is always visible and instantiates the BuildConfig on the active cluster', async () => {
    canStart = true;
    mockData['/apis/build.openshift.io/v1/buildconfigs'] = [{
      metadata: { name: 'api', namespace: 'shop', uid: 'bc1' },
      spec: { strategy: { type: 'Docker' } },
    }];
    renderView();
    const btn = screen.getByRole('button', { name: 'Start build of api' });
    expect(btn.className).not.toContain('opacity-0');
    fireEvent.click(btn);
    await waitFor(() => expect(k8sCreate).toHaveBeenCalled());
    expect(k8sCreate).toHaveBeenCalledWith(
      '/apis/build.openshift.io/v1/namespaces/shop/buildconfigs/api/instantiate',
      { apiVersion: 'build.openshift.io/v1', kind: 'BuildRequest', metadata: { name: 'api' } },
      'local',
    );
  });

  it('Start build is not offered without permission', () => {
    canStart = false;
    mockData['/apis/build.openshift.io/v1/buildconfigs'] = [{ metadata: { name: 'api', namespace: 'shop', uid: 'bc1' }, spec: {} }];
    renderView();
    expect(screen.queryByRole('button', { name: 'Start build of api' })).toBeNull();
    canStart = true;
  });
});
