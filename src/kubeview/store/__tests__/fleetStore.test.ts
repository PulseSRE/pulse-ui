// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock clusterConnection module
vi.mock('../../engine/clusterConnection', () => {
  // Initialize the shared array on first call (mock factories are hoisted)
  if (!(globalThis as any).__mockFleetConnections) {
    (globalThis as any).__mockFleetConnections = [];
  }
  return {
  registerCluster: vi.fn((config: any) => {
    ((globalThis as any).__mockFleetConnections as any[]).push({
      id: config.id,
      name: config.name,
      environment: config.environment,
      connectionType: config.connectionType,
      apiBase: '/api/kubernetes',
      status: 'unknown',
      lastHealthCheck: 0,
    });
  }),
  unregisterCluster: vi.fn((id: string) => {
    const conns = (globalThis as any).__mockFleetConnections as any[];
    const idx = conns.findIndex((c: any) => c.id === id);
    if (idx >= 0) conns.splice(idx, 1);
  }),
  getAllConnections: vi.fn(() => [...((globalThis as any).__mockFleetConnections as any[])]),
  setActiveClusterId: vi.fn(() => true),
  getActiveClusterId: vi.fn(() => 'local'),
  isMultiCluster: vi.fn(() => ((globalThis as any).__mockFleetConnections as any[]).length > 1),
  updateConnectionStatus: vi.fn(),
  updateConnectionLocation: vi.fn(),
  getClusterBase: vi.fn(() => '/api/kubernetes'),
  };
});

// Mock query module
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn(),
  k8sGet: vi.fn(),
  getImpersonationHeaders: vi.fn(() => ({})),
}));

import { useFleetStore } from '../fleetStore';

const getConns = () => (globalThis as any).__mockFleetConnections as any[];

describe('fleetStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getConns().length = 0;
    // Add local cluster
    getConns().push({
      id: 'local',
      name: 'Local Cluster',
      connectionType: 'local',
      apiBase: '/api/kubernetes',
      status: 'connected',
      lastHealthCheck: Date.now(),
    });
    useFleetStore.setState({
      fleetMode: 'single',
      connectionMode: 'none',
      acmAvailable: false,
      acmDetecting: false,
      clusters: [...getConns()],
      activeClusterId: 'local',
      healthPolling: false,
    });
  });

  afterEach(() => {
    useFleetStore.getState().stopHealthPolling();
    vi.useRealTimers();
  });

  // ---- Initial state ----

  it('initializes with single fleet mode', () => {
    const state = useFleetStore.getState();
    expect(state.fleetMode).toBe('single');
    expect(state.connectionMode).toBe('none');
    expect(state.acmAvailable).toBe(false);
    expect(state.acmDetecting).toBe(false);
    expect(state.healthPolling).toBe(false);
  });

  // ---- setActiveCluster ----

  it('setActiveCluster updates active cluster id', () => {
    useFleetStore.getState().setActiveCluster('cluster-2');
    expect(useFleetStore.getState().activeClusterId).toBe('cluster-2');
  });

  // ---- refreshClusters ----

  it('refreshClusters syncs from connection registry', () => {
    getConns().push({
      id: 'new-cluster',
      name: 'New',
      connectionType: 'direct-proxy',
      apiBase: 'http://localhost:8002',
      status: 'connected',
      lastHealthCheck: 0,
    });
    useFleetStore.getState().refreshClusters();
    expect(useFleetStore.getState().clusters).toHaveLength(2);
  });

  // ---- addCluster ----

  it('addCluster registers and updates fleet mode', async () => {
    // Mock fetch for health check
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [{}] }) });

    await useFleetStore.getState().addCluster({
      id: 'cluster-2',
      name: 'Cluster 2',
      connectionType: 'direct-proxy',
      target: 'http://localhost:8002',
    });

    const state = useFleetStore.getState();
    expect(state.clusters.length).toBeGreaterThanOrEqual(2);
    expect(state.fleetMode).toBe('multi');
    expect(state.connectionMode).toBe('multi-proxy');
  });

  it('addCluster keeps connectionMode when already set', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    useFleetStore.setState({ connectionMode: 'acm' });

    await useFleetStore.getState().addCluster({
      id: 'cluster-3',
      name: 'Cluster 3',
      connectionType: 'acm-proxy',
      target: 'cluster-3',
    });

    expect(useFleetStore.getState().connectionMode).toBe('acm');
  });

  // ---- removeCluster ----

  it('removeCluster removes and updates fleet mode', () => {
    // Add a second cluster first
    getConns().push({
      id: 'cluster-2',
      name: 'Cluster 2',
      connectionType: 'direct-proxy',
      apiBase: 'http://localhost:8002',
      status: 'connected',
      lastHealthCheck: 0,
    });
    useFleetStore.setState({ clusters: [...getConns()], fleetMode: 'multi' });

    useFleetStore.getState().removeCluster('cluster-2');
    const state = useFleetStore.getState();
    expect(state.clusters).toHaveLength(1);
    expect(state.fleetMode).toBe('single');
  });

  // ---- refreshHealth ----

  it('refreshHealth marks cluster connected on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [{}, {}], metadata: {} }),
    });

    await useFleetStore.getState().refreshHealth('local');
    const { updateConnectionStatus } = await import('../../engine/clusterConnection');
    expect(updateConnectionStatus).toHaveBeenCalledWith('local', 'connected', expect.any(Object));
  });

  it('refreshHealth marks cluster unreachable on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await useFleetStore.getState().refreshHealth('local');
    const { updateConnectionStatus } = await import('../../engine/clusterConnection');
    expect(updateConnectionStatus).toHaveBeenCalledWith('local', 'unreachable');
  });

  it('refreshHealth marks auth-expired on 401/403', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await useFleetStore.getState().refreshHealth('local');
    const { updateConnectionStatus } = await import('../../engine/clusterConnection');
    expect(updateConnectionStatus).toHaveBeenCalledWith('local', 'auth-expired');
  });

  it('refreshHealth handles network error as unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await useFleetStore.getState().refreshHealth('local');
    const { updateConnectionStatus } = await import('../../engine/clusterConnection');
    expect(updateConnectionStatus).toHaveBeenCalledWith('local', 'unreachable');
  });

  // ---- Health polling ----

  it('startHealthPolling sets flag and starts interval', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    useFleetStore.getState().startHealthPolling();
    expect(useFleetStore.getState().healthPolling).toBe(true);
  });

  it('stopHealthPolling clears interval', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    useFleetStore.getState().startHealthPolling();
    useFleetStore.getState().stopHealthPolling();
    expect(useFleetStore.getState().healthPolling).toBe(false);
  });

  it('startHealthPolling is idempotent', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    useFleetStore.getState().startHealthPolling();
    useFleetStore.getState().startHealthPolling();
    expect(useFleetStore.getState().healthPolling).toBe(true);
    useFleetStore.getState().stopHealthPolling();
  });

  // ---- detectACM ----

  it('detectACM sets acmAvailable on success with managed clusters', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              metadata: { name: 'cluster-a', labels: { env: 'prod' } },
              status: {
                conditions: [{ type: 'ManagedClusterConditionAvailable', status: 'True' }],
                version: { kubernetes: '1.28' },
              },
            },
            {
              metadata: { name: 'local-cluster', labels: {} },
              status: {},
            },
          ],
        }),
    });

    await useFleetStore.getState().detectACM();
    const state = useFleetStore.getState();
    expect(state.acmAvailable).toBe(true);
    expect(state.acmDetecting).toBe(false);
    expect(state.connectionMode).toBe('acm');
  });

  it('detectACM sets acmAvailable false on 404', async () => {
    // Mock uiStore for toast
    vi.doMock('../uiStore', () => ({
      useUIStore: { getState: () => ({ addToast: vi.fn() }) },
    }));
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    await useFleetStore.getState().detectACM();
    const state = useFleetStore.getState();
    expect(state.acmAvailable).toBe(false);
    expect(state.acmDetecting).toBe(false);
  });

  it('detectACM handles network error', async () => {
    vi.doMock('../uiStore', () => ({
      useUIStore: { getState: () => ({ addToast: vi.fn() }) },
    }));
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    await useFleetStore.getState().detectACM();
    const state = useFleetStore.getState();
    expect(state.acmAvailable).toBe(false);
    expect(state.acmDetecting).toBe(false);
  });

  // ---- refreshAllHealth ----

  it('refreshAllHealth checks all clusters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    global.fetch = fetchMock;

    getConns().push({
      id: 'c2',
      name: 'C2',
      connectionType: 'direct-proxy',
      apiBase: 'http://localhost:8002',
      status: 'unknown',
      lastHealthCheck: 0,
    });

    await useFleetStore.getState().refreshAllHealth();
    // fetch called once per cluster
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
