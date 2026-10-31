// @vitest-environment jsdom
/**
 * The shared workload menu: each item opens a confirmation that says what
 * happens, sends exactly one request (asserted: method, path, patch type,
 * body), is disabled with a reason when RBAC says no, shows a failed write in
 * the dialog, and refuses to write when the cluster changed after it opened.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { WorkloadActionMenu } from '../WorkloadActionMenu';
import { useUIStore } from '../../../store/uiStore';
import { useFleetStore } from '../../../store/fleetStore';
import { registerCluster, resetConnections } from '../../../engine/clusterConnection';
import { installFetch, setAllow, respond, writes, json, renderWithProviders } from './actionHarness';
import type { K8sResource } from '../../../engine/renderers';

const deployment = {
  apiVersion: 'apps/v1', kind: 'Deployment',
  metadata: { name: 'web', namespace: 'shop', uid: 'u-web', resourceVersion: '41' },
  spec: { replicas: 3, selector: { matchLabels: { app: 'web' } } },
} as unknown as K8sResource;

const cronJob = {
  apiVersion: 'batch/v1', kind: 'CronJob',
  metadata: { name: 'nightly', namespace: 'shop', uid: 'u-cj', resourceVersion: '7' },
  spec: {
    schedule: '0 2 * * *',
    jobTemplate: { metadata: { labels: { team: 'data' } }, spec: { template: { spec: { containers: [{ name: 'c', image: 'busybox' }], restartPolicy: 'Never' } } } },
  },
} as unknown as K8sResource;

const job = {
  apiVersion: 'batch/v1', kind: 'Job',
  metadata: {
    name: 'migrate', namespace: 'shop', uid: 'u-job', resourceVersion: '9',
    labels: { app: 'migrate', 'controller-uid': 'u-job', 'batch.kubernetes.io/controller-uid': 'u-job', 'job-name': 'migrate' },
  },
  spec: {
    selector: { matchLabels: { 'batch.kubernetes.io/controller-uid': 'u-job' } },
    template: {
      metadata: { labels: { app: 'migrate', 'controller-uid': 'u-job', 'batch.kubernetes.io/controller-uid': 'u-job', 'job-name': 'migrate', 'batch.kubernetes.io/job-name': 'migrate' } },
      spec: { containers: [{ name: 'c', image: 'migrate:1' }], restartPolicy: 'Never' },
    },
  },
} as unknown as K8sResource;

const pod = {
  apiVersion: 'v1', kind: 'Pod',
  metadata: { name: 'web-abc', namespace: 'shop', uid: 'u-pod', resourceVersion: '5', ownerReferences: [{ kind: 'ReplicaSet', name: 'web-1', controller: true }] },
  spec: { containers: [{ name: 'app' }] },
} as unknown as K8sResource;

beforeEach(() => {
  installFetch();
  setAllow({ 'patch/deployments': true, 'delete/deployments': true, 'patch/cronjobs': true, 'create/jobs': true, 'delete/jobs': true, 'delete/pods': true });
  useUIStore.setState({ toasts: [] } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetConnections();
  useFleetStore.setState({ activeClusterId: 'local' });
});

async function openItem(resource: K8sResource, label: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${resource.kind} ${resource.metadata.name}` }));
  const item = () => within(screen.getByRole('menu')).getByRole('menuitem', { name: new RegExp(label) }) as HTMLButtonElement;
  await waitFor(() => expect(item().disabled).toBe(false));
  fireEvent.click(item());
  return screen.findByRole('dialog');
}

describe('Deployment actions', () => {
  it('Set replicas sends a conditional merge patch with the exact count, and warns before 0', async () => {
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Set replicas');
    const input = within(dialog).getByLabelText('Replicas');
    fireEvent.change(input, { target: { value: '0' } });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/stops all 3 pods/);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Scale' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/apis/apps/v1/namespaces/shop/deployments/web',
      contentType: 'application/merge-patch+json',
      body: { metadata: { resourceVersion: '41' }, spec: { replicas: 7 } },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rejects a replica count that is not a whole number', async () => {
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Set replicas');
    fireEvent.change(within(dialog).getByLabelText('Replicas'), { target: { value: '-2' } });
    expect(within(dialog).getByText(/whole number/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Scale' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Restart rollout stamps the pod template', async () => {
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Restart rollout');
    expect(dialog.textContent).toMatch(/Every pod of Deployment "web" in shop is replaced/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe('PATCH');
    expect(w.contentType).toBe('application/strategic-merge-patch+json');
    expect(Date.parse(w.body.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'])).not.toBeNaN();
  });

  it('Pause rollout sets spec.paused', async () => {
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Pause rollout');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ spec: { paused: true } });
  });

  it('Roll back links to the rollback panel on the deployment page', async () => {
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Deployment web' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Roll back/ }));
    expect(screen.getByTestId('location').textContent).toBe('/r/apps~v1~deployments/shop/web#rollback');
    expect(writes()).toHaveLength(0);
  });

  it('Delete sends a uid-guarded DELETE', async () => {
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Delete');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: '/apis/apps/v1/namespaces/shop/deployments/web', body: { preconditions: { uid: 'u-web' } } });
  });

  it('a 403 stays on screen in the dialog and nothing claims success', async () => {
    respond((c) => (c.method === 'PATCH' ? json({ kind: 'Status', message: 'deployments.apps "web" is forbidden', reason: 'Forbidden', code: 403 }, 403) : undefined));
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Pause rollout');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/Pause failed/));
    expect(useUIStore.getState().toasts.some((t: { type: string }) => t.type === 'success')).toBe(false);
  });

  it('a 409 conflict says the object changed', async () => {
    respond((c) => (c.method === 'PATCH' ? json({ kind: 'Status', message: 'the object has been modified', reason: 'Conflict', code: 409 }, 409) : undefined));
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Set replicas');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Scale' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/changed since this page loaded it/));
  });

  it('items the user may not do are disabled with the reason, and send nothing', async () => {
    setAllow({});
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Deployment web' }));
    await screen.findByRole('menu');
    const scale = () => within(screen.getByRole('menu')).getByRole('menuitem', { name: /Set replicas/ }) as HTMLButtonElement;
    // Write verbs fail closed: disabled from the start, and still after the review answers.
    await waitFor(() => expect(scale().disabled).toBe(true));
    expect(scale().getAttribute('title')).toMatch(/permission/);
    fireEvent.click(scale());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it('refuses to write when the active cluster changed after the dialog opened', async () => {
    registerCluster({ id: 'prod', name: 'Prod', connectionType: 'acm-proxy', target: 'prod' });
    renderWithProviders(<WorkloadActionMenu resource={deployment} />);
    const dialog = await openItem(deployment, 'Pause rollout');
    act(() => { useFleetStore.getState().setActiveCluster('prod'); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/was not run/));
    expect(writes()).toHaveLength(0);
  });
});

describe('CronJob actions', () => {
  it('Trigger now creates a Job from the template, owned by the CronJob, with a unique name', async () => {
    renderWithProviders(<WorkloadActionMenu resource={cronJob} />);
    const dialog = await openItem(cronJob, 'Trigger now');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe('POST');
    expect(w.path).toBe('/apis/batch/v1/namespaces/shop/jobs');
    expect(w.body.metadata.name).toMatch(/^nightly-manual-[a-z0-9]+$/);
    expect(w.body.metadata.ownerReferences).toEqual([{ apiVersion: 'batch/v1', kind: 'CronJob', name: 'nightly', uid: 'u-cj', controller: true, blockOwnerDeletion: true }]);
    expect(w.body.metadata.annotations['cronjob.kubernetes.io/instantiate']).toBe('manual');
    expect(w.body.metadata.labels).toEqual({ team: 'data' });
    expect(w.body.spec.template.spec.containers[0].image).toBe('busybox');
  });

  it('Suspend schedule sets spec.suspend', async () => {
    renderWithProviders(<WorkloadActionMenu resource={cronJob} />);
    const dialog = await openItem(cronJob, 'Suspend schedule');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', path: '/apis/batch/v1/namespaces/shop/cronjobs/nightly', body: { spec: { suspend: true } } });
  });

  it('a suspended CronJob offers Resume', async () => {
    renderWithProviders(<WorkloadActionMenu resource={{ ...cronJob, spec: { ...(cronJob.spec as object), suspend: true } } as K8sResource} />);
    const dialog = await openItem(cronJob, 'Resume schedule');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ spec: { suspend: false } }));
  });
});

describe('Job actions', () => {
  it('Re-run clones the Job without its selector or controller labels', async () => {
    renderWithProviders(<WorkloadActionMenu resource={job} />);
    const dialog = await openItem(job, 'Re-run');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe('POST');
    expect(w.path).toBe('/apis/batch/v1/namespaces/shop/jobs');
    expect(w.body.metadata.name).toMatch(/^migrate-rerun-[a-z0-9]+$/);
    expect(w.body.metadata.labels).toEqual({ app: 'migrate' });
    expect(w.body.spec.selector).toBeUndefined();
    expect(w.body.spec.template.metadata.labels).toEqual({ app: 'migrate' });
    expect(w.body.metadata.uid).toBeUndefined();
    expect(w.body.metadata.resourceVersion).toBeUndefined();
  });

  it('a failed create is shown in the dialog', async () => {
    respond((c) => (c.method === 'POST' ? json({ kind: 'Status', message: 'internal error', code: 500 }, 500) : undefined));
    renderWithProviders(<WorkloadActionMenu resource={job} />);
    const dialog = await openItem(job, 'Re-run');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/Re-run failed/));
  });
});

describe('Pod actions', () => {
  it('Restart pod says the controller replaces it, then deletes by uid', async () => {
    renderWithProviders(<WorkloadActionMenu resource={pod} />);
    const dialog = await openItem(pod, 'Restart pod');
    expect(dialog.textContent).toMatch(/ReplicaSet "web-1" will create a replacement/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: '/api/v1/namespaces/shop/pods/web-abc', body: { preconditions: { uid: 'u-pod' } } });
  });

  it('Logs opens the pod logs page', async () => {
    renderWithProviders(<WorkloadActionMenu resource={pod} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Pod web-abc' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Logs' }));
    expect(screen.getByTestId('location').textContent).toBe('/logs/shop/web-abc');
  });
});
