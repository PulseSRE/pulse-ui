// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const addToastMock = vi.fn();
vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: any) => selector({
    addToast: addToastMock,
    setConnectionStatus: vi.fn(),
    setLastSyncTime: vi.fn(),
    addDegradedReason: vi.fn(),
    removeDegradedReason: vi.fn(),
  }), { getState: () => ({ addDegradedReason: vi.fn(), removeDegradedReason: vi.fn() }) }),
}));

const k8sListMock = vi.fn();
const k8sPatchMock = vi.fn();
vi.mock('../../../engine/query', () => ({
  k8sList: (...a: any[]) => k8sListMock(...a),
  k8sPatch: (...a: any[]) => k8sPatchMock(...a),
}));

type WatchCb = (e: { type: string; object: any }) => void;
const watchCallbacks: Record<string, WatchCb> = {};
vi.mock('../../../engine/watch', () => ({
  watchManager: {
    watch: vi.fn((path: string, cb: WatchCb) => { watchCallbacks[path] = cb; return { unsubscribe: vi.fn() }; }),
  },
}));

vi.mock('../../../engine/format', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../engine/format')>()), formatRelative: () => '2h ago' }));

let canPatch = true;
const canICalls: unknown[][] = [];
vi.mock('../../../hooks/useCanI', () => ({ useCanI: (...a: unknown[]) => { canICalls.push(a); return { allowed: canPatch, isLoading: false }; } }));

import { RolloutHistory, parseRevisions } from '../RolloutHistory';
import { registerCluster, setActiveClusterId, unregisterCluster } from '../../../engine/clusterConnection';
import { useMonitorStore } from '../../../store/monitorStore';
import { useInboxStore } from '../../../store/inboxStore';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const template = (image: string, extra: Record<string, unknown> = {}) => ({
  metadata: { labels: { app: 'api' } },
  spec: { containers: [{ name: 'app', image }], ...extra },
});

function deployment(rev = '2', status: Record<string, number> = { updatedReplicas: 3, readyReplicas: 3 }) {
  return {
    apiVersion: 'apps/v1', kind: 'Deployment',
    metadata: { name: 'api', namespace: 'prod', uid: 'dep-uid', resourceVersion: '42', annotations: { 'deployment.kubernetes.io/revision': rev } },
    spec: { replicas: 3, selector: { matchLabels: { app: 'api' } }, template: template('reg/api:1.2', { nodeSelector: { bad: 'true' } }) },
    status,
  };
}

function rs(rev: number, image: string, owner = 'dep-uid', cause?: string) {
  return {
    apiVersion: 'apps/v1', kind: 'ReplicaSet',
    metadata: {
      name: `api-${rev}`, namespace: 'prod', uid: `rs-${rev}`, resourceVersion: `${rev}`, creationTimestamp: `2026-10-0${rev}T00:00:00Z`,
      annotations: { 'deployment.kubernetes.io/revision': String(rev), ...(cause ? { 'kubernetes.io/change-cause': cause } : {}) },
      ownerReferences: [{ kind: 'Deployment', name: 'api', uid: owner }],
    },
    spec: { replicas: 3, template: { ...template(image), metadata: { labels: { app: 'api', 'pod-template-hash': `h${rev}` } } } },
    status: { readyReplicas: rev === 2 ? 3 : 0 },
  };
}

function statefulSet() {
  return {
    apiVersion: 'apps/v1', kind: 'StatefulSet',
    metadata: { name: 'db', namespace: 'data', uid: 'sts-uid', resourceVersion: '77' },
    spec: { replicas: 3, template: template('reg/db:16') },
    status: { updateRevision: 'db-bbb', currentRevision: 'db-aaa', updatedReplicas: 1, readyReplicas: 3 },
  };
}

function cr(name: string, revision: number, image: string, kind = 'StatefulSet', ownerUid = 'sts-uid') {
  return {
    apiVersion: 'apps/v1', kind: 'ControllerRevision',
    metadata: { name, namespace: 'data', uid: `cr-${name}`, resourceVersion: `${revision}`, creationTimestamp: '2026-10-01T00:00:00Z', ownerReferences: [{ kind, name: 'db', uid: ownerUid }] },
    revision,
    data: { spec: { template: { $patch: 'replace', metadata: { labels: { app: 'db' } }, spec: { containers: [{ name: 'db', image }] } } } },
  };
}

describe('RolloutHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canPatch = true;
    canICalls.length = 0;
    for (const k of Object.keys(watchCallbacks)) delete watchCallbacks[k];
  });
  afterEach(cleanup);

  it('renders a Deployment revision timeline, oldest first, current from the deployment annotation, image changes marked', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2', 'dep-uid', 'bump to 1.2'), rs(1, 'reg/api:1.1'), rs(9, 'reg/other:1', 'someone-else')]);
    render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
    await screen.findByRole('button', { name: 'Revision 2 (current)' });
    const order = Array.from(screen.getByRole('list', { name: 'Revisions' }).querySelectorAll('li button')).map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual(['Revision 1', 'Revision 2 (current)']);
    expect(screen.getByText('app: api:1.1 → api:1.2')).toBeDefined();
    expect(screen.getByText('bump to 1.2')).toBeDefined();
    expect(k8sListMock).toHaveBeenCalledWith('/apis/apps/v1/replicasets', 'prod', 'local');
    expect(canICalls[0]).toEqual(['patch', 'apps', 'deployments', 'prod']);
  });

  it('rolls a Deployment back by replacing spec.template exactly, guarded by the shown resourceVersion', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
    k8sPatchMock.mockResolvedValue({});
    render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    expect(screen.getByText('Container "app": image reg/api:1.2 -> reg/api:1.1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(k8sPatchMock).toHaveBeenCalledTimes(1));
    expect(k8sPatchMock).toHaveBeenCalledWith(
      '/apis/apps/v1/namespaces/prod/deployments/api',
      [
        { op: 'test', path: '/metadata/resourceVersion', value: '42' },
        // The whole template: the nodeSelector added since revision 1 is gone, and the
        // ReplicaSet's pod-template-hash label is not copied onto the Deployment.
        { op: 'replace', path: '/spec/template', value: { metadata: { labels: { app: 'api' } }, spec: { containers: [{ name: 'app', image: 'reg/api:1.1' }] } } },
      ],
      'application/json-patch+json',
      'local',
    );
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Rollback to revision 1 started' }));
  });

  it('copies the revision change-cause onto the Deployment, like kubectl rollout undo', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1', 'dep-uid', 'pin to 1.1')]);
    k8sPatchMock.mockResolvedValue({});
    render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(k8sPatchMock).toHaveBeenCalledTimes(1));
    expect(k8sPatchMock.mock.calls[0][1][2]).toEqual({ op: 'add', path: '/metadata/annotations/kubernetes.io~1change-cause', value: 'pin to 1.1' });
  });

  it('a Helm-owned Deployment: the rollback confirm says Helm reverts it and offers the release rollback', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
    const owned = deployment();
    (owned.metadata as Record<string, unknown>).labels = { 'app.kubernetes.io/managed-by': 'Helm' };
    (owned.metadata as Record<string, unknown>).annotations = { 'deployment.kubernetes.io/revision': '2', 'meta.helm.sh/release-name': 'api', 'meta.helm.sh/release-namespace': 'prod' };
    render(<RolloutHistory resource={owned as any} namespace="prod" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
    expect(screen.getByTestId('helm-rollback-note').textContent).toMatch(/managed by Helm release api in prod\. A rollback here is reverted by Helm/);
    expect(screen.getByRole('button', { name: 'Roll back the release…' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Roll back the Deployment anyway' })).toBeDefined();
    expect(k8sPatchMock).not.toHaveBeenCalled();
  });

  it('refuses to roll back a paused Deployment and says why', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
    const paused = deployment();
    (paused.spec as Record<string, unknown>).paused = true;
    render(<RolloutHistory resource={paused as any} namespace="prod" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    expect(screen.queryByRole('button', { name: 'Roll back to revision 1' })).toBeNull();
    expect(screen.getByText(/This Deployment is paused: resume it before rolling back/)).toBeDefined();
  });

  it('hides rollback when told the history is not of the active cluster', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
    render(<RolloutHistory resource={deployment() as any} namespace="prod" allowRollback={false} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    expect(screen.queryByRole('button', { name: 'Roll back to revision 1' })).toBeNull();
  });

  it('a concurrent change rejected by the API is reported as a failure, never as started', async () => {
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
    k8sPatchMock.mockRejectedValue(new Error('the server rejected our request due to an error in our request (test failed)'));
    render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Rollback failed' })));
    expect(addToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('restores a StatefulSet ControllerRevision template (without the $patch directive)', async () => {
    k8sListMock.mockResolvedValue([cr('db-aaa', 1, 'reg/db:15'), cr('db-bbb', 2, 'reg/db:16'), cr('cache-x', 1, 'reg/cache:1', 'StatefulSet', 'other')]);
    k8sPatchMock.mockResolvedValue({});
    render(<RolloutHistory resource={statefulSet() as any} namespace="data" />, { wrapper });
    expect(await screen.findByRole('button', { name: 'Revision 2 (current)' })).toBeDefined();
    expect(k8sListMock).toHaveBeenCalledWith('/apis/apps/v1/controllerrevisions', 'data', 'local');
    expect(canICalls[0]).toEqual(['patch', 'apps', 'statefulsets', 'data']);
    // Rolling out: 1 of 3 pods on the update revision.
    expect(screen.getByLabelText('Rollout in progress').textContent).toContain('1/3 updated');
    fireEvent.click(screen.getByRole('button', { name: 'Revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(k8sPatchMock).toHaveBeenCalledTimes(1));
    expect(k8sPatchMock).toHaveBeenCalledWith(
      '/apis/apps/v1/namespaces/data/statefulsets/db',
      [
        { op: 'test', path: '/metadata/resourceVersion', value: '77' },
        { op: 'replace', path: '/spec/template', value: { metadata: { labels: { app: 'db' } }, spec: { containers: [{ name: 'db', image: 'reg/db:15' }] } } },
      ],
      'application/json-patch+json',
      'local',
    );
  });

  it('a DaemonSet uses ControllerRevisions and marks the highest revision current', () => {
    const ds = { apiVersion: 'apps/v1', kind: 'DaemonSet', metadata: { name: 'db', namespace: 'data', uid: 'ds-uid' }, spec: {}, status: {} };
    const revs = parseRevisions(ds as any, [cr('a', 1, 'x:1', 'DaemonSet', 'ds-uid'), cr('b', 3, 'x:3', 'DaemonSet', 'ds-uid')] as any);
    expect(revs.map((r) => [r.revision, r.current])).toEqual([[1, false], [3, true]]);
  });

  it('offers no rollback without permission to patch the workload', async () => {
    canPatch = false;
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
    render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
    expect(screen.queryByRole('button', { name: 'Roll back to revision 1' })).toBeNull();
  });

  it('does not roll back on another cluster if the active cluster changed after the request', async () => {
    registerCluster({ id: 'other', name: 'Other', connectionType: 'acm-proxy', target: 'other' });
    try {
      k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
      render(<RolloutHistory resource={deployment() as any} namespace="prod" clusterId="local" />, { wrapper });
      fireEvent.click(await screen.findByRole('button', { name: 'Revision 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Roll back to revision 1' }));
      setActiveClusterId('other');
      fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
      await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Rollback failed' })));
      expect(k8sPatchMock).not.toHaveBeenCalled();
    } finally {
      unregisterCluster('other');
    }
  });

  it('shows a new revision as soon as the watch delivers it', async () => {
    k8sListMock.mockResolvedValue([rs(1, 'reg/api:1.1')]);
    render(<RolloutHistory resource={deployment('1') as any} namespace="prod" />, { wrapper });
    await screen.findByRole('button', { name: 'Revision 1 (current)' });
    await waitFor(() => expect(watchCallbacks['/apis/apps/v1/namespaces/prod/replicasets']).toBeDefined());
    act(() => watchCallbacks['/apis/apps/v1/namespaces/prod/replicasets']({ type: 'ADDED', object: rs(2, 'reg/api:1.2') }));
    expect(await screen.findByRole('button', { name: 'Revision 2' })).toBeDefined();
    expect(screen.getByText('2 revisions')).toBeDefined();
  });

  it('shows an error with retry when revisions cannot be read', async () => {
    k8sListMock.mockRejectedValueOnce(Object.assign(new Error('replicasets is forbidden'), { status: 403 }));
    render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Revisions could not be loaded');
    expect(alert.textContent).toContain('replicasets is forbidden');
    expect(screen.queryByText('No revisions found.')).toBeNull();
    k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2')]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('button', { name: 'Revision 2 (current)' })).toBeDefined();
  });

  describe('alerts and findings per revision', () => {
    const finding = (id: string, title: string, resources: Array<{ kind: string; name: string; namespace: string }>, at: string, severity: 'critical' | 'warning' = 'warning') =>
      ({ id, title, severity, category: 'x', summary: '', resources, autoFixable: false, timestamp: Date.parse(at) });
    afterEach(() => {
      useMonitorStore.setState({ findings: [] } as never);
      useInboxStore.setState({ items: [] } as never);
    });

    it('marks monitor findings and inbox items on the revision they occurred in, linking to the inbox item', async () => {
      useMonitorStore.setState({ findings: [
        // A pod of ReplicaSet api-1: revision 1 exactly, whatever the time.
        finding('f1', 'api-1-x7k2p crashlooping', [{ kind: 'Pod', name: 'api-1-x7k2p', namespace: 'prod' }], '2026-10-05T00:00:00Z', 'critical'),
        // The Deployment itself, after revision 2 was created: revision 2.
        finding('f2', 'api unavailable', [{ kind: 'Deployment', name: 'api', namespace: 'prod' }], '2026-10-02T06:00:00Z'),
        // Another namespace's api: not this workload.
        finding('f3', 'other api', [{ kind: 'Deployment', name: 'api', namespace: 'staging' }], '2026-10-02T06:00:00Z'),
      ] } as never);
      useInboxStore.setState({ items: [
        { id: 'inb-9', finding_id: 'f2', title: 'api unavailable', severity: 'warning', resources: [{ kind: 'Deployment', name: 'api', namespace: 'prod' }], created_at: Date.parse('2026-10-02T06:00:00Z') / 1000 },
        { id: 'inb-7', finding_id: null, title: 'Error budget burn on api', severity: 'critical', resources: [{ kind: 'Deployment', name: 'api', namespace: 'prod' }], created_at: Date.parse('2026-10-01T12:00:00Z') / 1000 },
      ] } as never);
      k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
      render(<RolloutHistory resource={deployment() as any} namespace="prod" />, { wrapper });
      await screen.findByRole('button', { name: 'Revision 2 (current)' });
      expect(screen.getByTestId('revision-signals-1').textContent).toContain('2');
      expect(screen.getByTestId('revision-signals-2').textContent).toContain('1');
      // Revision 2 is shown: the finding and its inbox item are one entry, linked to the item.
      const list2 = screen.getByLabelText('Alerts and findings during revision 2');
      expect(list2.querySelectorAll('li')).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'api unavailable' }).getAttribute('href')).toBe('/inbox?task=inb-9');
      fireEvent.click(screen.getByRole('button', { name: 'Revision 1' }));
      const list1 = screen.getByLabelText('Alerts and findings during revision 1');
      expect(list1.textContent).toContain('api-1-x7k2p crashlooping');
      expect(screen.getByRole('link', { name: 'Error budget burn on api' }).getAttribute('href')).toBe('/inbox?task=inb-7');
      // A finding without an inbox item is listed without a link.
      expect(screen.queryByRole('link', { name: 'api-1-x7k2p crashlooping' })).toBeNull();
      expect(screen.queryByText('other api')).toBeNull();
    });

    it('does not mark the agent cluster findings on another cluster history', async () => {
      useMonitorStore.setState({ findings: [finding('f2', 'api unavailable', [{ kind: 'Deployment', name: 'api', namespace: 'prod' }], '2026-10-02T06:00:00Z')] } as never);
      registerCluster({ id: 'east', name: 'East', connectionType: 'acm-proxy', target: 'east' });
      try {
        k8sListMock.mockResolvedValue([rs(2, 'reg/api:1.2'), rs(1, 'reg/api:1.1')]);
        render(<RolloutHistory resource={deployment() as any} namespace="prod" clusterId="east" />, { wrapper });
        await screen.findByRole('button', { name: 'Revision 2 (current)' });
        expect(screen.queryByTestId('revision-signals-2')).toBeNull();
      } finally {
        unregisterCluster('east');
      }
    });
  });

  it('renders nothing for kinds without revisions', () => {
    const { container } = render(<RolloutHistory resource={{ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'p' } } as any} namespace="prod" />, { wrapper });
    expect(container.innerHTML).toBe('');
  });
});
