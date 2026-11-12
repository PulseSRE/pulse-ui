// @vitest-environment jsdom
/**
 * Inbox › Activity › Roll back goes through the shared WriteConfirmDialog:
 * the exact change from the fix's snapshot (live → before the fix), where and
 * as whom, "No dry run available", impact and undo, the observe-mode gate and
 * the cluster pin. Closing it in any way never rolls back; confirming sends
 * exactly POST /fix-history/{id}/rollback with no body.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RollbackFixDialog } from '../RollbackFixDialog';
import { useTrustStore } from '../../../store/trustStore';
import { useFleetStore } from '../../../store/fleetStore';
import { useUIStore } from '../../../store/uiStore';
import { getAllConnections, registerCluster, resetConnections } from '../../../engine/clusterConnection';
import type { ActionRecord } from '../../../engine/fixHistory';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let rollbackReply: { status: number; body: unknown } = { status: 200, body: { status: 'rolled_back' } };
let live: { status: number; body: unknown } = { status: 200, body: {} };

const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  calls.push({ url, method, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
  const out = url.endsWith('/rollback') ? rollbackReply : url.includes('/apis/apps/v1/namespaces/shop/deployments/api') ? live : { status: 404, body: {} };
  return Promise.resolve({ ok: out.status < 400, status: out.status, statusText: String(out.status), headers: new Headers(), json: async () => out.body, text: async () => JSON.stringify(out.body) } as Response);
});
const rollbacks = () => calls.filter((c) => c.url.endsWith('/rollback'));

const SNAPSHOT = {
  kind: 'Deployment', name: 'api', namespace: 'shop', uid: 'u-1',
  metadata: { labels: { app: 'api' }, annotations: { team: 'payments' } },
  spec: { replicas: 2, template: { spec: { containers: [{ name: 'api', image: 'api:1.4', resources: { limits: { memory: '256Mi' } } }] } } },
  afterFix: { generation: 7 },
};
const LIVE = {
  metadata: { name: 'api', namespace: 'shop', uid: 'u-1', generation: 7, resourceVersion: '991', labels: { app: 'api' }, annotations: { team: 'payments' } },
  spec: { replicas: 2, template: { spec: { containers: [{ name: 'api', image: 'api:1.4', resources: { limits: { memory: '512Mi' } } }] } } },
};
const ACTION = {
  id: 'act-7', findingId: 'f-1', timestamp: Date.now(), category: 'oom', tool: 'patch_resources', input: {},
  status: 'completed', beforeState: '', afterState: '', reasoning: '', durationMs: 1, rollbackAvailable: true,
  rollbackAction: { tool: 'restore_snapshot', input: { snapshot: JSON.stringify(SNAPSHOT) } },
  resources: [{ kind: 'Deployment', name: 'api', namespace: 'shop' }],
} as unknown as ActionRecord;

let qc: QueryClient | null = null;
const onClose = vi.fn();
const onRolledBack = vi.fn();
function mount(action: ActionRecord = ACTION) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <RollbackFixDialog action={action} onClose={onClose} onRolledBack={onRolledBack} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const confirmBtn = () => screen.getByRole('button', { name: 'Roll back Deployment api' }) as HTMLButtonElement;

beforeEach(() => {
  resetConnections();
  registerCluster({ id: 'prod-east', name: 'Prod East', connectionType: 'acm-proxy', target: 'prod-east' });
  useFleetStore.setState({ activeClusterId: 'local', clusters: getAllConnections() });
  useUIStore.setState({ impersonateUser: '', impersonateGroups: [] });
  useTrustStore.setState({ trustLevel: 1, history: [] });
  calls = [];
  rollbackReply = { status: 200, body: { status: 'rolled_back' } };
  live = { status: 200, body: LIVE };
  onClose.mockReset();
  onRolledBack.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); qc?.clear(); qc = null; vi.unstubAllGlobals(); resetConnections(); });

describe('Roll back a fix: the shared approval dialog', () => {
  it('shows the exact change from the snapshot, where and as whom, no dry run, impact and undo', async () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Roll back the fix on Deployment api?' });
    const diff = await within(dialog).findByLabelText('What will change');
    expect(diff.textContent).toBe(
      'Deployment shop/api · live → as before the fix'
      + '-   spec.template.spec.containers[0].resources.limits.memory: "512Mi"'
      + '+   spec.template.spec.containers[0].resources.limits.memory: "256Mi"',
    );
    expect(within(dialog).getByTestId('write-where').textContent).toBe(
      "shop · cluster Local Cluster · acting as you, through the agent (Pulse's service account if token forwarding is off)",
    );
    expect(within(dialog).getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
    expect(within(dialog).getByText(/Restores Deployment api's spec as it was before "patch_resources"/)).toBeTruthy();
    expect(within(dialog).getByText(/No one-click undo/)).toBeTruthy();
    expect(within(dialog).getByText('No (generation 7)')).toBeTruthy();
    // The live object was read from the local cluster, where the agent runs.
    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/kubernetes/apis/apps/v1/namespaces/shop/deployments/api')).toBe(true);
    expect(rollbacks()).toHaveLength(0);
  });

  it('says when the object changed after the fix (the agent will refuse)', async () => {
    live = { status: 200, body: { ...LIVE, metadata: { ...LIVE.metadata, generation: 9 } } };
    mount();
    expect(await screen.findByText(/Yes: generation 7 → 9\. The agent will refuse/)).toBeTruthy();
  });

  it('a failed live read says the exact change cannot be shown, and names the snapshot target', async () => {
    live = { status: 403, body: { kind: 'Status', status: 'Failure', message: 'deployments.apps "api" is forbidden', reason: 'Forbidden', code: 403 } };
    mount();
    expect(await screen.findByText(/Could not read the live Deployment, so the exact change cannot be shown/)).toBeTruthy();
    expect(screen.getByLabelText('Parameters').textContent).toContain('"name": "api"');
  });

  it('a revision rollback shows the agent tool and its parameters', () => {
    mount({ ...ACTION, rollbackAction: { tool: 'rollback_deployment', input: { namespace: 'shop', name: 'api', revision: 4 } } } as ActionRecord);
    expect(screen.getByText('rollback_deployment')).toBeTruthy();
    expect(screen.getByText('Rolls back to revision 4.')).toBeTruthy();
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['the X', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['the backdrop', () => { const overlay = screen.getByRole('dialog').parentElement!; fireEvent.mouseDown(overlay, { target: overlay }); }],
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
  ])('closing with %s never rolls back', async (_how, dismiss) => {
    mount();
    await screen.findByLabelText('What will change');
    dismiss();
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { await Promise.resolve(); });
    expect(rollbacks()).toHaveLength(0);
    expect(onRolledBack).not.toHaveBeenCalled();
  });

  it('observe mode blocks it: Roll back disabled, says why, no key approves', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    mount();
    expect(confirmBtn().disabled).toBe(true);
    expect(screen.getByTestId('write-blocked').textContent).toMatch(/Observe mode/);
    fireEvent.click(confirmBtn());
    for (const key of ['Enter', 'y']) fireEvent.keyDown(screen.getByRole('dialog'), { key });
    await act(async () => { await Promise.resolve(); });
    expect(rollbacks()).toHaveLength(0);
  });

  it('a cluster switch after it opened refuses and sends nothing', async () => {
    mount();
    act(() => { useFleetStore.getState().setActiveCluster('prod-east'); });
    fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toMatch(/This rollback was not run: it was prepared on Local Cluster, but the active cluster is now Prod East/);
    expect(rollbacks()).toHaveLength(0);
    expect(onRolledBack).not.toHaveBeenCalled();
  });

  it('confirming sends exactly the existing request: POST /fix-history/{id}/rollback, no body, once', async () => {
    mount();
    fireEvent.click(confirmBtn());
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onRolledBack).toHaveBeenCalledTimes(1));
    expect(rollbacks()).toEqual([{ url: '/api/agent/fix-history/act-7/rollback', method: 'POST', body: undefined }]);
  });

  it("a refusal stays in the dialog with the agent's words", async () => {
    rollbackReply = { status: 400, body: { error: 'Rollback failed: Deployment shop/api was changed after the fix' } };
    mount();
    fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('The agent did not roll back: Rollback failed: Deployment shop/api was changed after the fix');
    expect(onRolledBack).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
