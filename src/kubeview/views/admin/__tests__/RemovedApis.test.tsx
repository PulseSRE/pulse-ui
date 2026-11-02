// @vitest-environment jsdom
/**
 * Removed-API go/no-go on Admin › Updates, rendered through the real
 * UpdatesTab with fetch stubbed: the real readK8s/listK8s, useCanI
 * (SelfSubjectAccessReview) and k8sPatch run against the stub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../store/uiStore', () => {
  const state = { addToast: vi.fn(), impersonateUser: '', impersonateGroups: [] };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state, setState: vi.fn() }) };
});

import { mockFetchRoutes, renderWithClient, expectNoAllClear, type MockRoute } from '../../../__tests__/helpers/honestStates';
import { UpdatesTab, type UpdatesTabProps } from '../UpdatesTab';
import { registerCluster, setActiveClusterId, unregisterCluster } from '../../../engine/clusterConnection';
import { useFleetStore } from '../../../store/fleetStore';
import type { ClusterVersion } from '../../../engine/types';

const GATE = 'ack-4.18-kube-1.32-api-removals-in-4.19';
const GATE_DESC = 'Kubernetes 1.32 and therefore OpenShift 4.19 remove several APIs which require admin consideration.';
const FLOWSCHEMA = 'flowschemas.v1beta3.flowcontrol.apiserver.k8s.io';

function clusterVersion(upgradeableFalse = false): ClusterVersion {
  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterVersion',
    metadata: { name: 'version', uid: 'cv', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: { clusterID: 'c-1', channel: 'stable-4.19' },
    status: {
      desired: { version: '4.18.9' },
      history: [{ state: 'Completed', version: '4.18.9' }],
      availableUpdates: [{ version: '4.19.2', image: 'quay.io/x@sha256:1' }],
      conditions: [
        { type: 'RetrievedUpdates', status: 'True' },
        ...(upgradeableFalse ? [{ type: 'Upgradeable', status: 'False', reason: 'AdminAckRequired', message: 'Kubernetes 1.32 and therefore OpenShift 4.19 remove several APIs which require admin consideration.' }] : []),
      ],
    },
  } as ClusterVersion;
}

function arcList(items: Array<{ name: string; removed?: string; count: number; users?: Array<[string, string, number]> }>) {
  return {
    kind: 'APIRequestCountList',
    apiVersion: 'apiserver.openshift.io/v1',
    items: items.map((i) => ({
      metadata: { name: i.name },
      status: {
        ...(i.removed ? { removedInRelease: i.removed } : {}),
        requestCount: i.count,
        last24h: [{ byNode: [{ nodeName: 'm1', byUser: (i.users ?? []).map(([username, userAgent, requestCount]) => ({ username, userAgent, requestCount })) }] }],
      },
    })),
  };
}

const cm = (name: string, data: Record<string, string>) => ({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, namespace: 'x' }, data });

const UNUSED_ONLY = arcList([{ name: FLOWSCHEMA, removed: '1.32', count: 0 }, { name: 'pods.v1', count: 500 }]);
const IN_USE = arcList([{
  name: FLOWSCHEMA, removed: '1.32', count: 120,
  users: [['system:serviceaccount:openshift-monitoring:prometheus', 'prometheus/2.5', 100], ['ci-deployer', 'helm/v3.14', 20]],
}]);

function routes(over: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  return {
    '/apis/apiserver.openshift.io/v1/apirequestcounts': { body: UNUSED_ONLY },
    '/configmaps/admin-gates': { body: cm('admin-gates', { [GATE]: GATE_DESC }) },
    '/configmaps/admin-acks': { body: cm('admin-acks', { [GATE]: 'true' }) },
    selfsubjectaccessreviews: { body: { status: { allowed: true } } },
    ...over,
  };
}

function renderTab(props: Partial<UpdatesTabProps> = {}) {
  const cv = props.clusterVersion ?? clusterVersion();
  const defaults: UpdatesTabProps = {
    clusterVersion: cv,
    cvVersion: '4.18.9',
    cvChannel: 'stable-4.19',
    platform: 'AWS',
    availableUpdates: (cv?.status?.availableUpdates ?? []) as UpdatesTabProps['availableUpdates'],
    isUpdating: false,
    operators: [],
    nodes: [],
    deployments: [],
    pdbs: [],
    etcdBackupExists: true,
    isHyperShift: false,
    machineConfigPools: [],
    pods: [],
    go: vi.fn(),
    ...props,
  };
  return renderWithClient(<UpdatesTab {...defaults} />);
}

const panel = () => screen.getByRole('region', { name: 'Removed APIs check' });
const verdict = async () => {
  await waitFor(() => expect(screen.getByTestId('removed-apis-verdict')).toBeTruthy());
  return screen.getByTestId('removed-apis-verdict');
};
const checklistRow = () => screen.getByTestId('precheck-Removed APIs');
/** The panel's Acknowledge button, once the permission check has answered. */
async function ackButton() {
  const btn = within(screen.getByTestId(`admin-gate-${GATE}`)).getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  return btn;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  setActiveClusterId('local');
  useFleetStore.setState({ activeClusterId: 'local' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Removed APIs panel: failed reads are "Could not check", never Go', () => {
  it.each([
    [403, /Permission denied \(403\)/],
    [500, /Request failed \(500\)/],
  ])('APIRequestCounts answering %s', async (status, re) => {
    mockFetchRoutes(routes({ '/apis/apiserver.openshift.io/v1/apirequestcounts': { status, body: { kind: 'Status', code: status } } }));
    renderTab();
    const badge = await verdict();
    expect(badge.dataset.status).toBe('unknown');
    expect(badge.textContent).toBe('Could not check');
    expect(within(panel()).getByRole('alert').textContent).toMatch(re);
    expect(within(panel()).queryByText('Go')).toBeNull();
    expect(checklistRow().dataset.status).toBe('unknown');
    expectNoAllClear(panel());
  });

  it('APIRequestCounts answering 404 (not OpenShift)', async () => {
    mockFetchRoutes(routes({ '/apis/apiserver.openshift.io/v1/apirequestcounts': { status: 404, body: { kind: 'Status', code: 404 } } }));
    renderTab();
    expect((await verdict()).dataset.status).toBe('unknown');
    expect(screen.getByTestId('removed-apis-reason').textContent).toMatch(/not available on this cluster/);
    expect(checklistRow().dataset.status).toBe('unknown');
  });

  it('admin-acks unreadable: gate acknowledgement is unknown, no Acknowledge button', async () => {
    mockFetchRoutes(routes({ '/configmaps/admin-acks': { status: 403, body: {} } }));
    renderTab();
    expect((await verdict()).dataset.status).toBe('unknown');
    const gate = screen.getByTestId(`admin-gate-${GATE}`);
    expect(within(gate).getByText('Acknowledgement unknown')).toBeTruthy();
    expect(within(gate).queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });
});

describe('Removed APIs panel verdicts', () => {
  it('Go: nothing removed in 4.19 is called and the gate is acknowledged; removed-but-unused list is collapsed', async () => {
    mockFetchRoutes(routes());
    renderTab();
    const badge = await verdict();
    expect(badge.dataset.status).toBe('go');
    expect(within(panel()).getByText('Kubernetes 1.32')).toBeTruthy();
    expect(within(screen.getByTestId(`admin-gate-${GATE}`)).getByText('Acknowledged')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Removed APIs not in use' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1 removed but not called/ }));
    expect(within(screen.getByRole('list', { name: 'Removed APIs not in use' })).getByText('flowschemas')).toBeTruthy();
    expect(checklistRow().dataset.status).toBe('pass');
  });

  it('No-go: a removed API in use is listed with callers (platform caller tagged), the update stays enabled with a warning, checklist fails', async () => {
    mockFetchRoutes(routes({ '/apis/apiserver.openshift.io/v1/apirequestcounts': { body: IN_USE } }));
    const go = vi.fn();
    renderTab({ go });
    expect((await verdict()).dataset.status).toBe('no_go');
    const table = screen.getByRole('table', { name: 'Removed APIs in use' });
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toContain('flowschemas');
    expect(row.textContent).toContain('flowcontrol.apiserver.k8s.io/v1beta3');
    expect(row.textContent).toContain('1.32');
    expect(row.textContent).toContain('120');
    // Non-platform caller ranks first; the platform caller is shown and tagged.
    const callers = within(row).getAllByRole('listitem');
    expect(callers[0].textContent).toContain('ci-deployer');
    expect(callers[0].textContent).toContain('helm/v3.14');
    expect(callers[1].textContent).toContain('system:serviceaccount:openshift-monitoring:prometheus');
    expect(within(callers[1]).getByText('Platform')).toBeTruthy();
    expect(checklistRow().dataset.status).toBe('warn');

    // The update action is not blocked, but warns.
    fireEvent.click(screen.getByRole('button', { name: /^4\.19\.2 — / }));
    const target = screen.getByRole('region', { name: 'Update target 4.19.2' });
    const btn = within(target).getByRole('button', { name: 'Update to 4.19.2' }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(within(target).getByTestId('removed-apis-update-warning').textContent).toMatch(/No-go/);
    fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('removed-apis-update-warning').textContent).toMatch(/was called 120 times/);
  });

  it('links an API to its resource list page when discovery serves it', async () => {
    const { useClusterStore } = await import('../../../store/clusterStore');
    const registry = new Map([['flowcontrol.apiserver.k8s.io/v1beta3/flowschemas', {} as never]]);
    useClusterStore.setState({ resourceRegistry: registry, discoveryClusterId: 'local' });
    try {
      mockFetchRoutes(routes({ '/apis/apiserver.openshift.io/v1/apirequestcounts': { body: IN_USE } }));
      const go = vi.fn();
      renderTab({ go });
      await verdict();
      fireEvent.click(within(screen.getByRole('table', { name: 'Removed APIs in use' })).getByRole('button', { name: 'flowschemas' }));
      expect(go).toHaveBeenCalledWith('/r/flowcontrol.apiserver.k8s.io~v1beta3~flowschemas', 'flowschemas');
    } finally {
      useClusterStore.setState({ resourceRegistry: null, discoveryClusterId: null });
    }
  });

  it('No-go on an unacknowledged gate; acknowledged gate shows no button', async () => {
    mockFetchRoutes(routes({ '/configmaps/admin-acks': { body: cm('admin-acks', {}) } }));
    renderTab();
    expect((await verdict()).dataset.status).toBe('no_go');
    const gate = screen.getByTestId(`admin-gate-${GATE}`);
    expect(within(gate).getByText('Not acknowledged')).toBeTruthy();
    expect(within(gate).getByText(GATE_DESC)).toBeTruthy();
    expect(within(gate).getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
  });
});

describe('Acknowledge an admin gate', () => {
  function ackRoutes(patchStatus = 200) {
    let acked = false;
    const fetchMock = mockFetchRoutes(routes({
      '/configmaps/admin-acks': (_url, init) => {
        if (init?.method === 'PATCH') {
          if (patchStatus !== 200) return { status: patchStatus, body: { kind: 'Status', code: patchStatus, message: 'configmaps "admin-acks" is forbidden' } };
          acked = true;
          return { body: cm('admin-acks', { [GATE]: 'true' }) };
        }
        return { body: cm('admin-acks', acked ? { [GATE]: 'true' } : {}) };
      },
    }));
    return fetchMock;
  }
  const patchCalls = (fetchMock: ReturnType<typeof mockFetchRoutes>) =>
    fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');

  it('happy path: confirm quotes the gate and key, patches admin-acks on the pinned cluster, then shows Acknowledged from a re-read', async () => {
    registerCluster({ id: 'east', name: 'East', connectionType: 'direct-proxy', target: 'https://east' });
    setActiveClusterId('east');
    useFleetStore.setState({ activeClusterId: 'east' });
    try {
      const fetchMock = ackRoutes();
      renderTab();
      await verdict();
      fireEvent.click(await ackButton());
      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain(GATE_DESC);
      expect(dialog.textContent).toContain('openshift-config/admin-acks');
      expect(dialog.textContent).toContain(`setting key ${GATE} to "true"`);
      expect(dialog.textContent).toContain('East');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Acknowledge' }));

      await waitFor(() => expect(within(screen.getByTestId(`admin-gate-${GATE}`)).getByText('Acknowledged')).toBeTruthy());
      const [[url, init]] = patchCalls(fetchMock);
      expect(String(url)).toBe('/api/kubernetes/cluster/east/api/v1/namespaces/openshift-config/configmaps/admin-acks');
      expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/merge-patch+json' });
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ data: { [GATE]: 'true' } });
      expect((await verdict()).dataset.status).toBe('go');
    } finally {
      setActiveClusterId('local');
      useFleetStore.setState({ activeClusterId: 'local' });
      unregisterCluster('east');
    }
  });

  it('cancel: no write', async () => {
    const fetchMock = ackRoutes();
    renderTab();
    await verdict();
    fireEvent.click(await ackButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchCalls(fetchMock)).toHaveLength(0);
    expect(within(screen.getByTestId(`admin-gate-${GATE}`)).getByText('Not acknowledged')).toBeTruthy();
  });

  it('403 on the patch: the error is shown and the gate stays unacknowledged', async () => {
    const fetchMock = ackRoutes(403);
    renderTab();
    await verdict();
    fireEvent.click(await ackButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Acknowledge' }));
    const gate = screen.getByTestId(`admin-gate-${GATE}`);
    await waitFor(() => expect(within(gate).getByRole('alert').textContent).toMatch(/Could not acknowledge/));
    expect(patchCalls(fetchMock)).toHaveLength(1);
    expect(within(gate).getByText('Not acknowledged')).toBeTruthy();
    expect((await verdict()).dataset.status).toBe('no_go');
  });

  it('cluster switched after opening the dialog: no write to either cluster, error shown', async () => {
    registerCluster({ id: 'east', name: 'East', connectionType: 'direct-proxy', target: 'https://east' });
    try {
      const fetchMock = ackRoutes();
      renderTab();
      await verdict();
      fireEvent.click(await ackButton());
      const dialog = await screen.findByRole('dialog');
      setActiveClusterId('east');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Acknowledge' }));
      await waitFor(() => expect(screen.getByText(/was not run: it was prepared on/)).toBeTruthy());
      expect(patchCalls(fetchMock)).toHaveLength(0);
    } finally {
      setActiveClusterId('local');
      unregisterCluster('east');
    }
  });

  it('no permission to patch ConfigMaps in openshift-config: button disabled with the reason', async () => {
    const fetchMock = mockFetchRoutes(routes({
      '/configmaps/admin-acks': { body: cm('admin-acks', {}) },
      selfsubjectaccessreviews: { body: { status: { allowed: false } } },
    }));
    renderTab();
    await verdict();
    const gate = screen.getByTestId(`admin-gate-${GATE}`);
    await waitFor(() => expect(within(gate).getByText('You do not have permission to patch ConfigMaps in openshift-config.')).toBeTruthy());
    const btn = within(gate).getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // The access review asked about configmaps/patch in openshift-config.
    const reviews = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('selfsubjectaccessreviews'))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).spec.resourceAttributes);
    expect(reviews).toContainEqual({ verb: 'patch', group: '', resource: 'configmaps', namespace: 'openshift-config' });
  });

  it('Upgradeable=False with an unacknowledged gate: the banner offers Acknowledge instead of the oc command', async () => {
    mockFetchRoutes(routes({ '/configmaps/admin-acks': { body: cm('admin-acks', {}) } }));
    renderTab({ clusterVersion: clusterVersion(true) });
    await verdict();
    await waitFor(() => expect(screen.getByText('These admin gates are not acknowledged:')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/run\s*oc adm upgrade/);
    // One button in the banner, one in the panel.
    expect(screen.getAllByRole('button', { name: 'Acknowledge' })).toHaveLength(2);
  });

  it('Upgradeable=False when gates cannot be read: the command fallback stays', async () => {
    mockFetchRoutes(routes({ '/configmaps/admin-gates': { status: 500, body: {} } }));
    renderTab({ clusterVersion: clusterVersion(true) });
    await verdict();
    expect(screen.getByText(/Boundaries like this commonly require/)).toBeTruthy();
  });
});
