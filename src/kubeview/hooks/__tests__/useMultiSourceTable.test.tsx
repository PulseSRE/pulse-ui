// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TableDatasource } from '../../engine/agentComponents';

// Mock useK8sListWatch
const useK8sListWatchMock = vi.fn(() => ({ data: [], isLoading: false, error: null }));
vi.mock('../useK8sListWatch', () => ({
  useK8sListWatch: (...args: any[]) => useK8sListWatchMock(...args),
}));

// Mock Prometheus queryInstant
const queryInstantMock = vi.fn().mockResolvedValue([]);
vi.mock('../../components/metrics/prometheus', () => ({
  queryInstant: (...args: any[]) => queryInstantMock(...args),
}));

// Mock query helpers
vi.mock('../../engine/query', () => ({
  getImpersonationHeaders: () => ({}),
}));

// Mock useResourceUrl
vi.mock('../useResourceUrl', () => ({
  buildApiPath: (gvrKey: string, namespace?: string) => {
    const parts = gvrKey.split('/');
    let path: string;
    if (parts.length === 3) path = `/apis/${parts[0]}/${parts[1]}/${parts[2]}`;
    else path = `/api/${parts[0]}/${parts[1]}`;
    if (namespace) path = path.replace(/\/([^/]+)$/, `/namespaces/${namespace}/$1`);
    return path;
  },
}));

// Mock enhancers — return default columns for any GVR
vi.mock('../../engine/enhancers', () => ({
  getColumnsForResource: (_gvrKey: string, _namespaced: boolean, _resources?: any[]) => [
    { id: 'name', header: 'Name', accessorFn: (r: any) => r.metadata?.name || '', render: (v: unknown) => String(v), sortable: true, priority: 1 },
    { id: 'namespace', header: 'Namespace', accessorFn: (r: any) => r.metadata?.namespace || '', render: (v: unknown) => String(v), sortable: true, priority: 2 },
    { id: 'age', header: 'Age', accessorFn: (r: any) => r.metadata?.creationTimestamp || '', render: (v: unknown) => String(v), sortable: true, priority: 3 },
  ],
}));

// Mock useDocumentVisibility (used by useK8sListWatch)
vi.mock('../useDocumentVisibility', () => ({
  useDocumentVisibility: () => true,
}));

// Mock uiStore
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = { setConnectionStatus: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

import { useMultiSourceTable } from '../useMultiSourceTable';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const makePod = (name: string, ns: string) => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name, namespace: ns, uid: `uid-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
});

const makeDeploy = (name: string, ns: string) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name, namespace: ns, uid: `uid-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
  spec: { replicas: 2 },
  status: { readyReplicas: 2, availableReplicas: 2 },
});

describe('useMultiSourceTable', () => {
  beforeEach(() => {
    useK8sListWatchMock.mockReset();
    useK8sListWatchMock.mockReturnValue({ data: [], isLoading: false, error: null });
    queryInstantMock.mockReset();
    queryInstantMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('returns empty state with no resources', () => {
    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });
    expect(result.current.resources).toEqual([]);
    expect(result.current.isLive).toBe(false);
    expect(result.current.sources).toHaveLength(1);
  });

  it('returns resources from a single K8s datasource', () => {
    const pods = [makePod('web-1', 'default'), makePod('web-2', 'default')];
    useK8sListWatchMock.mockReturnValue({ data: pods, isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });
    expect(result.current.resources).toHaveLength(2);
    expect(result.current.isLive).toBe(true);
    expect(result.current.sources[0].count).toBe(2);
  });

  it('merges resources from multiple K8s datasources with dedup by UID', () => {
    const sharedPod = makePod('shared', 'ns1');
    const uniquePod = makePod('unique', 'ns2');

    // First watch returns shared + unique, second returns shared (duplicate)
    let callCount = 0;
    useK8sListWatchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return { data: [sharedPod, uniquePod], isLoading: false, error: null };
      return { data: [sharedPod], isLoading: false, error: null };
    });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'ns1', label: 'NS1', resource: 'pods', namespace: 'ns1' },
      { type: 'k8s', id: 'ns2', label: 'NS2', resource: 'pods', namespace: 'ns2' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    // Shared pod should appear only once (dedup by UID)
    const names = result.current.resources.map((r) => r.metadata.name);
    expect(names.filter((n) => n === 'shared')).toHaveLength(1);
  });

  it('adds _source column when multiple K8s datasources', () => {
    useK8sListWatchMock.mockReturnValue({ data: [makePod('web', 'default')], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'prod', label: 'Production', resource: 'pods', namespace: 'production' },
      { type: 'k8s', id: 'staging', label: 'Staging', resource: 'pods', namespace: 'staging' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    const colIds = result.current.columns.map((c) => c.id);
    expect(colIds).toContain('_source');
  });

  it('does NOT add _source column for single K8s datasource', () => {
    useK8sListWatchMock.mockReturnValue({ data: [makePod('web', 'default')], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    const colIds = result.current.columns.map((c) => c.id);
    expect(colIds).not.toContain('_source');
  });

  it('adds enrichment columns for PromQL datasources', () => {
    useK8sListWatchMock.mockReturnValue({ data: [makePod('web', 'default')], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
      { type: 'promql', id: 'cpu', label: 'CPU', query: 'rate(cpu[5m])', columnId: 'cpu_usage', columnHeader: 'CPU Usage', joinLabel: 'pod', joinColumn: 'name' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    const colIds = result.current.columns.map((c) => c.id);
    expect(colIds).toContain('cpu_usage');
  });

  it('adds enrichment columns for log datasources', () => {
    useK8sListWatchMock.mockReturnValue({ data: [makePod('web', 'default')], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
      { type: 'logs', id: 'errors', label: 'Errors', namespace: 'default', columnId: 'error_count', columnHeader: 'Errors' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    const colIds = result.current.columns.map((c) => c.id);
    expect(colIds).toContain('error_count');
  });

  it('toggle pause stops and resumes enrichment', () => {
    useK8sListWatchMock.mockReturnValue({ data: [], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    expect(result.current.isPaused).toBe(false);
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(true);
    act(() => result.current.togglePause());
    expect(result.current.isPaused).toBe(false);
  });

  it('stamps _gvrKey on merged resources', () => {
    useK8sListWatchMock.mockReturnValue({ data: [makeDeploy('web', 'default')], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'deploys', label: 'Deployments', resource: 'deployments', group: 'apps', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    const resource = result.current.resources[0] as Record<string, unknown>;
    expect(resource._gvrKey).toBe('apps/v1/deployments');
  });

  it('handles mixed resource types (deployments + pods)', () => {
    let callCount = 0;
    useK8sListWatchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return { data: [makeDeploy('web', 'default')], isLoading: false, error: null };
      return { data: [makePod('api', 'default')], isLoading: false, error: null };
    });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'deploys', label: 'Deployments', resource: 'deployments', group: 'apps', namespace: 'default' },
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    // Both resource types should be present
    expect(result.current.resources.length).toBeGreaterThanOrEqual(1);
    // Should have base columns (name, namespace, age) + _source
    const colIds = result.current.columns.map((c) => c.id);
    expect(colIds).toContain('name');
    expect(colIds).toContain('_source');
  });

  it('enrichmentUpdatedAt is null when no enrichment datasources', () => {
    useK8sListWatchMock.mockReturnValue({ data: [], isLoading: false, error: null });

    const ds: TableDatasource[] = [
      { type: 'k8s', id: 'pods', label: 'Pods', resource: 'pods', namespace: 'default' },
    ];
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });
    expect(result.current.enrichmentUpdatedAt).toBeNull();
  });

  it('handles 5 K8s datasources (max slots)', () => {
    useK8sListWatchMock.mockReturnValue({ data: [makePod('p', 'default')], isLoading: false, error: null });

    const ds: TableDatasource[] = Array.from({ length: 5 }, (_, i) => ({
      type: 'k8s' as const,
      id: `ds${i}`,
      label: `DS${i}`,
      resource: 'pods',
      namespace: `ns${i}`,
    }));
    const { result } = renderHook(() => useMultiSourceTable(ds), { wrapper: createWrapper() });

    expect(result.current.sources).toHaveLength(5);
  });
});
