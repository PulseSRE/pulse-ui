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
    pdbs: [],
    firingAlerts: [],
    isHyperShift: false,
    machineConfigPools: [],
    pods: [],
    go: vi.fn(),
    ...props,
  };
  return renderWithClient(<UpdatesTab {...defaults} />);
}

const panel = () => screen.getByRole('region', { name: 'Removed APIs check' });
/** The removed-API detail lives in the readiness row's "See callers" expansion: open it, then wait for the verdict. */
const verdict = async () => {
  const toggle = await screen.findByRole('button', { name: /See callers|next minor/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByTestId('removed-apis-verdict')).toBeTruthy());
  return screen.getByTestId('removed-apis-verdict');
};
const checklistRow = () => screen.getByTestId('readiness-removed-apis');
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
    expect(checklistRow().textContent).toMatch(re);
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
    expect(checklistRow().dataset.status).toBe('passed');
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
    expect(checklistRow().dataset.status).toBe('blocker');
    expect(checklistRow().textContent).toMatch(/flowschemas\.v1beta3\.flowcontrol\.apiserver\.k8s\.io is removed in Kubernetes 1\.32 and was called 120 times in 24h by ci-deployer/);

    // The update action is not blocked: the start dialog lists the blocker and asks to confirm anyway.
    const start = screen.getByRole('button', { name: /Start update/ }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('start-update-blockers').textContent).toMatch(/Removed APIs in use:.*called 120 times/);
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

describe('Removed APIs panel: agent-aligned rules', () => {
  it('404 on admin-gates is "Could not check", not "no gates"', async () => {
    mockFetchRoutes(routes({ '/configmaps/admin-gates': { status: 404, body: { kind: 'Status', code: 404 } } }));
    renderTab();
    expect((await verdict()).dataset.status).toBe('unknown');
    expect(screen.getByTestId('removed-apis-reason').textContent).toMatch(/admin-gates ConfigMap .* was not found/);
    // The API usage itself was read, so that row passes; the acknowledgement row is unknown.
    expect(checklistRow().dataset.status).toBe('passed');
    expect(screen.getByTestId('readiness-admin-ack').dataset.status).toBe('unknown');
  });

  it('Upgradeable=False for a reason other than admin-ack is No-go with the CVO reason', async () => {
    mockFetchRoutes(routes());
    const cv = clusterVersion();
    cv.status!.conditions = [...(cv.status!.conditions ?? []), { type: 'Upgradeable', status: 'False', reason: 'ClusterOperatorsNotUpgradeable', message: 'storage should not be upgraded' }];
    renderTab({ clusterVersion: cv });
    expect((await verdict()).dataset.status).toBe('no_go');
    expect(screen.getByTestId('removed-apis-reason').textContent).toMatch(/Upgradeable=False \(ClusterOperatorsNotUpgradeable\)/);
    const row = screen.getByTestId('readiness-upgradeable');
    expect(row.dataset.status).toBe('blocker');
    expect(row.textContent).toMatch(/storage should not be upgraded/);
  });

  it('no newer minor offered: checks current minor + 1, labelled as not yet offered on the channel', async () => {
    mockFetchRoutes(routes());
    const cv = clusterVersion();
    cv.status!.availableUpdates = [{ version: '4.18.11', image: 'quay.io/x@sha256:2' }];
    renderTab({ clusterVersion: cv });
    await verdict();
    expect(screen.getByTestId('removed-apis-target-not-offered').textContent).toMatch(/4\.19: next minor \(not yet offered on your channel\)/);
    const option = within(screen.getByRole('combobox', { name: 'Target minor' })).getByRole('option') as HTMLOptionElement;
    expect(option.value).toBe('4.19');
    expect(option.textContent).toMatch(/next minor \(not yet offered on your channel\)/);
  });

  it('No-go with a failed read still offers Retry, and Retry re-reads', async () => {
    let acksReads = 0;
    mockFetchRoutes(routes({
      '/apis/apiserver.openshift.io/v1/apirequestcounts': { body: IN_USE },
      '/configmaps/admin-acks': () => { acksReads += 1; return { status: 500, body: { kind: 'Status', code: 500 } }; },
    }));
    renderTab();
    expect((await verdict()).dataset.status).toBe('no_go');
    expect(screen.getByTestId('removed-apis-reason').textContent).toMatch(/Also could not check: the admin-acks ConfigMap could not be read/);
    const alert = within(panel()).getByRole('alert');
    expect(alert.textContent).toMatch(/Part of the removed-API check could not be read/);
    const before = acksReads;
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(acksReads).toBeGreaterThan(before));
  });

  it('Start update dialog opened while the check is still running lists the blocker once it arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inner = mockFetchRoutes(routes({ '/apis/apiserver.openshift.io/v1/apirequestcounts': { body: IN_USE } }));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('apirequestcounts')) await gate;
      return inner(input, init);
    });
    renderTab();
    const start = screen.getByRole('button', { name: /Start update/ }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    expect(checklistRow().dataset.status).toBe('checking');
    fireEvent.click(start);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Removed APIs in use/)).toBeNull();
    release();
    await waitFor(() => expect(within(dialog).getByTestId('start-update-blockers').textContent).toMatch(/Removed APIs in use:.*called 120 times/));
    // A blocker that appeared after opening still needs the explicit "update anyway".
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'planned' } });
    expect((within(dialog).getByRole('button', { name: 'Start update to 4.19.2' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('truncates very long usernames and user agents to ~120 characters, keeping the full text in the tooltip', async () => {
    const longUser = `u-${'x'.repeat(300)}`;
    const longAgent = `agent/${'y'.repeat(300)}`;
    mockFetchRoutes(routes({ '/apis/apiserver.openshift.io/v1/apirequestcounts': { body: arcList([{ name: FLOWSCHEMA, removed: '1.32', count: 5, users: [[longUser, longAgent, 5]] }]) } }));
    renderTab();
    await verdict();
    const user = screen.getByTitle(longUser);
    const agent = screen.getByTitle(longAgent);
    expect(user.textContent!.length).toBeLessThanOrEqual(120);
    expect(user.textContent!.endsWith('\u2026')).toBe(true);
    expect(agent.textContent!.length).toBeLessThanOrEqual(120);
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
      const { client } = renderTab();
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await verdict();
      fireEvent.click(await ackButton());
      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain(GATE_DESC);
      expect(dialog.textContent).toContain('openshift-config/admin-acks');
      expect(dialog.textContent).toContain(`setting key ${GATE} to "true"`);
      expect(dialog.textContent).toContain('East');
      // The literal merge-patch body is shown, and is exactly what is sent.
      expect(within(dialog).getByTestId('admin-ack-patch-body').textContent).toBe(`{"data":{"${GATE}":"true"}}`);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Acknowledge' }));

      await waitFor(() => expect(within(screen.getByTestId(`admin-gate-${GATE}`)).getByText('Acknowledged')).toBeTruthy());
      const [[url, init]] = patchCalls(fetchMock);
      expect(String(url)).toBe('/api/kubernetes/cluster/east/api/v1/namespaces/openshift-config/configmaps/admin-acks');
      expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/merge-patch+json' });
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ data: { [GATE]: 'true' } });
      expect((await verdict()).dataset.status).toBe('go');
      // Acknowledged state comes from re-reading admin-acks; no stray invalidation of an unused ClusterVersion key.
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['admin', 'clusterversion'] });
      expect(String(JSON.parse(String((patchCalls(fetchMock)[0][1] as RequestInit).body)).data[GATE])).toBe('true');
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
    // One button in the banner, one in the readiness acknowledgement row.
    expect(screen.getAllByRole('button', { name: 'Acknowledge' })).toHaveLength(2);
  });

  it('Upgradeable=False when gates cannot be read: the command fallback stays', async () => {
    mockFetchRoutes(routes({ '/configmaps/admin-gates': { status: 500, body: {} } }));
    renderTab({ clusterVersion: clusterVersion(true) });
    await verdict();
    expect(screen.getByText(/Boundaries like this commonly require/)).toBeTruthy();
  });
});
