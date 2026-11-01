// @vitest-environment jsdom
/**
 * Wave 7a: actions on nodes, machines, storage and networking pages, and
 * the Workloads / project pages' lists and links. Each test clicks what a
 * user clicks and asserts the confirmation, the exact request, or where it
 * navigates; denied actions are disabled with a reason.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { NodeHeaderActions } from '../detail/NodeHeaderActions';
import { MachineManagement } from '../compute/MachineManagement';
import { MachineConfigSection } from '../compute/MachineConfigSection';
import { findServicesWithoutReadyEndpoints } from '../NetworkingView';
import { useUIStore } from '../../store/uiStore';
import { installFetch, setAllow, respond, writes, json, renderWithProviders } from '../../components/workloads/__tests__/actionHarness';
import type { K8sResource } from '../../engine/renderers';
import type { Machine, MachineSet, Service } from '../../engine/types';

const go = vi.fn();
beforeEach(() => { installFetch(); go.mockReset(); useUIStore.setState({ selectedNamespace: '*' } as never); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const enabled = (name: RegExp | string) => () => expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);

describe('Node detail header', () => {
  const node = { apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-1', uid: 'n' }, spec: {} } as unknown as K8sResource;

  it('Cordon asks first, then patches spec.unschedulable', async () => {
    setAllow({ 'patch/nodes': true });
    renderWithProviders(<NodeHeaderActions node={node} />);
    await waitFor(enabled('Cordon'));
    fireEvent.click(screen.getByRole('button', { name: 'Cordon' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/No new pods will be scheduled on worker-1/);
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cordon' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', path: '/api/v1/nodes/worker-1', body: { spec: { unschedulable: true } } });
  });

  it('a cordoned node offers Uncordon', async () => {
    setAllow({ 'patch/nodes': true });
    renderWithProviders(<NodeHeaderActions node={{ ...node, spec: { unschedulable: true } } as K8sResource} />);
    await waitFor(enabled('Uncordon'));
    fireEvent.click(screen.getByRole('button', { name: 'Uncordon' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Uncordon' }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ spec: { unschedulable: false } }));
  });

  it('Drain opens the drain dialog (which lists the pods before doing anything)', async () => {
    setAllow({ 'patch/nodes': true });
    renderWithProviders(<NodeHeaderActions node={node} />);
    await waitFor(enabled(/Drain/));
    fireEvent.click(screen.getByRole('button', { name: /Drain/ }));
    expect(await screen.findByText(/Drain node/i)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('without node permission both are disabled with the reason', async () => {
    setAllow({});
    renderWithProviders(<NodeHeaderActions node={node} />);
    const cordon = screen.getByRole('button', { name: 'Cordon' }) as HTMLButtonElement;
    await waitFor(() => expect(cordon.disabled).toBe(true));
    expect(cordon.title).toMatch(/permission/);
  });
});

describe('Compute machines', () => {
  const ms = { apiVersion: 'machine.openshift.io/v1beta1', kind: 'MachineSet', metadata: { name: 'workers-a', namespace: 'openshift-machine-api', uid: 'ms', resourceVersion: '4' }, spec: { replicas: 3 }, status: { readyReplicas: 3 } } as unknown as MachineSet;
  const m = { apiVersion: 'machine.openshift.io/v1beta1', kind: 'Machine', metadata: { name: 'workers-a-x1', namespace: 'openshift-machine-api', uid: 'm1', ownerReferences: [{ kind: 'MachineSet', name: 'workers-a' }] }, status: { phase: 'Running', nodeRef: { name: 'worker-9' } } } as unknown as Machine;
  const render = () => renderWithProviders(
    <MachineManagement isHyperShift={false} machines={[m]} machineSets={[ms]} healthChecks={[]} machineAutoscalers={[]} clusterAutoscaler={[]} nodePools={[]} go={go} />,
  );

  it('MachineSet scale sets spec.replicas and warns about deleting machines when lowering', async () => {
    setAllow({ 'patch/machinesets': true });
    render();
    await waitFor(enabled('Scale MachineSet workers-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Scale MachineSet workers-a' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Machines'), { target: { value: '1' } });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/2 machine\(s\) will be deleted/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Scale' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/apis/machine.openshift.io/v1beta1/namespaces/openshift-machine-api/machinesets/workers-a',
      body: { metadata: { resourceVersion: '4' }, spec: { replicas: 1 } },
    });
  });

  it('Machine delete warns that the node goes and the MachineSet replaces it', async () => {
    setAllow({ 'delete/machines': true });
    render();
    await waitFor(enabled('Delete Machine workers-a-x1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Machine workers-a-x1' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/node "worker-9" is drained and removed/);
    expect(dialog.textContent).toMatch(/MachineSet then creates a replacement/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete machine' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: '/apis/machine.openshift.io/v1beta1/namespaces/openshift-machine-api/machines/workers-a-x1', body: { preconditions: { uid: 'm1' } } });
  });

  it('a control-plane machine with no ControlPlaneMachineSet needs its name typed, with an etcd quorum warning', async () => {
    setAllow({ 'delete/machines': true });
    const master = { ...m, metadata: { ...m.metadata, name: 'master-0', uid: 'm0', ownerReferences: [], labels: { 'machine.openshift.io/cluster-api-machine-role': 'master' } } } as unknown as Machine;
    renderWithProviders(<MachineManagement isHyperShift={false} machines={[master]} machineSets={[]} healthChecks={[]} machineAutoscalers={[]} clusterAutoscaler={[]} nodePools={[]} go={go} />);
    await waitFor(enabled('Delete Machine master-0'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Machine master-0' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/etcd/);
    expect(dialog.textContent).toMatch(/nothing would replace it/);
    const confirm = within(dialog).getByRole('button', { name: 'Delete machine' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Type the machine name/), { target: { value: 'master-0' } });
    expect(confirm.disabled).toBe(false);
  });

  it('a ControlPlaneMachineSet-owned machine says it is replaced, one at a time', async () => {
    setAllow({ 'delete/machines': true });
    const cp = { ...m, metadata: { ...m.metadata, name: 'master-1', uid: 'm1b', ownerReferences: [{ kind: 'ControlPlaneMachineSet', name: 'cluster' }] } } as unknown as Machine;
    renderWithProviders(<MachineManagement isHyperShift={false} machines={[cp]} machineSets={[]} healthChecks={[]} machineAutoscalers={[]} clusterAutoscaler={[]} nodePools={[]} go={go} />);
    await waitFor(enabled('Delete Machine master-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Machine master-1' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/ControlPlaneMachineSet creates a replacement/);
    expect(dialog.textContent).toMatch(/quorum/);
  });

  it('a failed delete is shown in the dialog', async () => {
    setAllow({ 'delete/machines': true });
    respond((c) => (c.method === 'DELETE' ? json({ kind: 'Status', message: 'admission webhook denied', code: 400 }, 400) : undefined));
    render();
    await waitFor(enabled('Delete Machine workers-a-x1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Machine workers-a-x1' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete machine' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/Delete machine failed/));
  });

  it('MachineConfigPool pause and unpause patch spec.paused', async () => {
    setAllow({ 'patch/machineconfigpools': true });
    const pools = [
      { apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool', metadata: { name: 'worker', uid: 'p1' }, spec: {} },
      { apiVersion: 'machineconfiguration.openshift.io/v1', kind: 'MachineConfigPool', metadata: { name: 'infra', uid: 'p2' }, spec: { paused: true } },
    ] as unknown as K8sResource[];
    renderWithProviders(<MachineConfigSection machineConfigPools={pools} go={go} />);
    await waitFor(enabled('Pause MachineConfigPool worker'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause MachineConfigPool worker' }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/rotated certificates .* do not reach nodes in a paused pool, and kubelet certificates can expire/);
    expect(dialog.textContent).not.toMatch(/Certificates still rotate/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', path: '/apis/machineconfiguration.openshift.io/v1/machineconfigpools/worker', body: { spec: { paused: true } } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Unpause MachineConfigPool infra' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpause' }));
    await waitFor(() => expect(writes()[1]?.body).toEqual({ spec: { paused: false } }));
  });
});

describe('Services with no ready endpoints', () => {
  const svc = (name: string, extra: Record<string, unknown> = {}) => ({ metadata: { name, namespace: 'shop' }, spec: { selector: { app: name }, ...extra } }) as unknown as Service;
  const ep = (name: string, subsets: unknown[]) => ({ metadata: { name, namespace: 'shop' }, subsets }) as unknown as K8sResource;

  it('flags missing, empty and not-ready-only endpoints; skips selector-less and ExternalName services', () => {
    const out = findServicesWithoutReadyEndpoints(
      [svc('ok'), svc('missing'), svc('empty'), svc('notready'), { metadata: { name: 'manual', namespace: 'shop' }, spec: {} } as unknown as Service, svc('ext', { type: 'ExternalName' })],
      [ep('ok', [{ addresses: [{ ip: '1' }] }]), ep('empty', []), ep('notready', [{ notReadyAddresses: [{ ip: '2' }, { ip: '3' }] }])],
    );
    expect(out.map((o) => [o.svc.metadata.name, o.notReady])).toEqual([['missing', 0], ['empty', 0], ['notready', 2]]);
  });
});
