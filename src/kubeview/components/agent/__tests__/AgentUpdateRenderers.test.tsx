// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<object>('react-router-dom')), useNavigate: () => navigateMock }));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: any) => selector({
    addToast: vi.fn(), setConnectionStatus: vi.fn(), setLastSyncTime: vi.fn(), addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(),
  }), { getState: () => ({ addDegradedReason: vi.fn(), removeDegradedReason: vi.fn() }) }),
}));

const k8sGetMock = vi.fn();
const k8sListMock = vi.fn();
vi.mock('../../../engine/query', () => ({
  k8sGet: (...a: any[]) => k8sGetMock(...a),
  k8sList: (...a: any[]) => k8sListMock(...a),
  k8sPatch: vi.fn(),
}));
vi.mock('../../../engine/watch', () => ({ watchManager: { watch: vi.fn(() => ({ unsubscribe: vi.fn() })) } }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));

import { AgentComponentRenderer } from '../renderers';
import type { ComponentSpec } from '../../../engine/agentComponents';
import { getKnownKinds } from '../../../engine/componentRegistry';

function renderSpec(spec: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><AgentComponentRenderer spec={spec as ComponentSpec} /></MemoryRouter></QueryClientProvider>,
  );
}

// Exactly what pulse-agent's get_cluster_updates emits for an idle cluster.
const upgradeGraphSpec = {
  kind: 'upgrade_graph',
  title: 'Cluster updates — 4.16.3',
  current: { version: '4.16.3', image: 'quay.io/ocp@sha256:aaa', channel: 'stable-4.16' },
  desired: { version: '4.16.3', image: 'quay.io/ocp@sha256:aaa' },
  channels: ['stable-4.16', 'stable-4.17'],
  nodes: [
    { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb', state: 'recommended', recommended: true, risks: [], channels: [] },
    { version: '4.17.1', image: 'quay.io/ocp@sha256:ccc', state: 'conditional', recommended: false, risks: [{ name: 'OVNInterconnectMigration', message: 'egress loss', url: 'https://issues.redhat.com/browse/OCPBUGS-1', matchingRules: [] }], channels: [] },
  ],
  edges: [{ from: '4.16.3', to: '4.16.8' }, { from: '4.16.3', to: '4.17.1' }],
  history: [{ version: '4.16.3', state: 'Completed', startedTime: '2026-09-01T10:00:00Z', completionTime: '2026-09-01T11:20:00Z', verified: true }],
  progress: { phase: 'idle', message: '', done: null, total: null, percent: null, clusterOperators: { updated: 0, total: 3, degraded: [] }, pools: [], etaMinutes: null, etaBasis: '' },
  blockers: [],
};

const rolloutSpec = {
  kind: 'rollout_history',
  title: 'Rollout history — api',
  workload: { kind: 'Deployment', namespace: 'prod', name: 'api', gvr: 'apps~v1~deployments' },
  revisions: [
    { revision: 1, name: 'api-1', createdAt: '2026-10-01T00:00:00Z', images: ['reg/api:1.1'], changeCause: '', replicas: { ready: 0, desired: 0 }, current: false, source: 'replicaset' },
    { revision: 2, name: 'api-2', createdAt: '2026-10-02T00:00:00Z', images: ['reg/api:1.2'], changeCause: 'bump', replicas: { ready: 3, desired: 3 }, current: true, source: 'replicaset' },
  ],
  inFlight: { strategy: 'RollingUpdate', updated: 3, ready: 3, available: 3, desired: 3, conditions: [] },
};

describe('agent update renderers', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('both kinds have native renderers', () => {
    expect(getKnownKinds()).toEqual(expect.arrayContaining(['upgrade_graph', 'rollout_history']));
  });

  it('upgrade_graph renders the graph read-only and sends the user to Admin › Updates to act', async () => {
    renderSpec(upgradeGraphSpec);
    const conditional = await screen.findByRole('button', { name: '4.17.1 — Conditional, 1 risk' });
    expect(screen.getByRole('img', { name: 'Current version 4.16.3' })).toBeDefined();
    fireEvent.click(conditional);
    expect(screen.getByText('OVNInterconnectMigration')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Review risks and update/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review and update in Admin › Updates' }));
    expect(navigateMock).toHaveBeenCalledWith('/admin?tab=updates');
  });

  it('rollout_history renders the live workload history on the agent cluster', async () => {
    k8sGetMock.mockResolvedValue({
      apiVersion: 'apps/v1', kind: 'Deployment',
      metadata: { name: 'api', namespace: 'prod', uid: 'u', resourceVersion: '5', annotations: { 'deployment.kubernetes.io/revision': '1' } },
      spec: { replicas: 1, template: { spec: { containers: [{ name: 'app', image: 'reg/api:1.1' }] } } },
      status: { updatedReplicas: 1, readyReplicas: 1 },
    });
    k8sListMock.mockResolvedValue([{
      apiVersion: 'apps/v1', kind: 'ReplicaSet',
      metadata: { name: 'api-1', uid: 'rs1', annotations: { 'deployment.kubernetes.io/revision': '1' }, ownerReferences: [{ kind: 'Deployment', name: 'api', uid: 'u' }] },
      spec: { replicas: 1, template: { spec: { containers: [{ name: 'app', image: 'reg/api:1.1' }] } } },
      status: { readyReplicas: 1 },
    }]);
    renderSpec(rolloutSpec);
    expect(await screen.findByRole('button', { name: 'Revision 1 (current)' })).toBeDefined();
    expect(k8sGetMock).toHaveBeenCalledWith('/apis/apps/v1/namespaces/prod/deployments/api', 'local');
    fireEvent.click(screen.getByRole('button', { name: 'Open Deployment prod/api' }));
    expect(navigateMock).toHaveBeenCalledWith('/r/apps~v1~deployments/prod/api');
  });

  it('rollout_history falls back to the agent snapshot, saying so, when the workload cannot be read', async () => {
    k8sGetMock.mockRejectedValue(new Error('deployments.apps "api" is forbidden'));
    renderSpec(rolloutSpec);
    // The live read is retried once before the snapshot is labelled as such.
    const note = await screen.findByRole('status', {}, { timeout: 4000 });
    expect(note.textContent).toContain('Live revisions could not be read');
    expect(note.textContent).toContain('forbidden');
    const snapshot = screen.getByRole('region', { name: 'Rollout history snapshot' });
    expect(snapshot.textContent).toContain('#2 current');
    expect(snapshot.textContent).toContain('api:1.2');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Roll back/ })).toBeNull());
  });
});
