// @vitest-environment jsdom
/**
 * PVC expand (only when the StorageClass allows it; otherwise disabled with
 * the reason), the pods that mount a PVC, HPA min/max, Service endpoints and
 * "set as default" StorageClass — each asserted on what the user sees and the
 * exact request sent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { KindSections } from '../KindSections';
import { installFetch, setAllow, respond, writes, json, renderWithProviders, calls } from '../../../components/workloads/__tests__/actionHarness';
import type { K8sResource } from '../../../engine/renderers';

const go = vi.fn();
const pvc = {
  apiVersion: 'v1', kind: 'PersistentVolumeClaim',
  metadata: { name: 'data', namespace: 'shop', uid: 'u-pvc', resourceVersion: '3' },
  spec: { storageClassName: 'fast', volumeName: 'pv-1', resources: { requests: { storage: '10Gi' } } },
  status: { phase: 'Bound' },
} as unknown as K8sResource;

let scExpandable = true;
beforeEach(() => {
  installFetch();
  scExpandable = true;
  setAllow({ 'patch/persistentvolumeclaims': true, 'patch/horizontalpodautoscalers': true, 'patch/storageclasses': true });
  respond((c) => {
    if (c.method === 'GET' && c.path === '/apis/storage.k8s.io/v1/storageclasses/fast') return json({ metadata: { name: 'fast' }, allowVolumeExpansion: scExpandable });
    if (c.method === 'GET' && c.path === '/api/v1/namespaces/shop/pods') {
      return json({ kind: 'PodList', apiVersion: 'v1', items: [
        { metadata: { name: 'db-0', namespace: 'shop', uid: 'p1' }, spec: { nodeName: 'w1', volumes: [{ name: 'd', persistentVolumeClaim: { claimName: 'data' } }] }, status: { phase: 'Running' } },
        { metadata: { name: 'web-1', namespace: 'shop', uid: 'p2' }, spec: { volumes: [{ name: 'tmp', emptyDir: {} }] }, status: { phase: 'Running' } },
      ] });
    }
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); go.mockReset(); });

const expandButton = () => screen.getByRole('button', { name: /Expand/ }) as HTMLButtonElement;

describe('PVC', () => {
  it('lists only the pods that mount the claim', async () => {
    renderWithProviders(<KindSections resource={pvc} go={go} />);
    expect(await screen.findByRole('button', { name: 'db-0' })).toBeTruthy();
    expect(screen.queryByText('web-1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'db-0' }));
    expect(go).toHaveBeenCalledWith('/r/v1~pods/shop/db-0', 'db-0');
  });

  it('expands: patches spec.resources.requests.storage, only to a larger size', async () => {
    renderWithProviders(<KindSections resource={pvc} go={go} />);
    await waitFor(() => expect(expandButton().disabled).toBe(false));
    fireEvent.click(expandButton());
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('New size');
    fireEvent.change(input, { target: { value: '5Gi' } });
    expect(within(dialog).getByText(/larger than the current 10Gi/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '20Gi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/v1/namespaces/shop/persistentvolumeclaims/data',
      contentType: 'application/merge-patch+json',
      body: { metadata: { resourceVersion: '3' }, spec: { resources: { requests: { storage: '20Gi' } } } },
    });
  });

  it('is disabled with the reason when the StorageClass does not allow expansion', async () => {
    scExpandable = false;
    renderWithProviders(<KindSections resource={pvc} go={go} />);
    await waitFor(() => expect(expandButton().title).toMatch(/does not allow volume expansion/));
    expect(expandButton().disabled).toBe(true);
    expect(screen.getByText(/Expand unavailable/)).toBeTruthy();
  });

  it('a failed pod list is shown as an error, not as "no pods"', async () => {
    // Responders answer in order: start again with the failing one first.
    installFetch();
    setAllow({ 'patch/persistentvolumeclaims': true });
    respond((c) => (c.method === 'GET' && c.path === '/api/v1/namespaces/shop/pods' ? json({ message: 'forbidden', code: 403 }, 403) : undefined));
    renderWithProviders(<KindSections resource={pvc} go={go} />);
    expect(await screen.findByText('Pods could not be listed')).toBeTruthy();
    expect(screen.queryByText(/No pod in shop mounts this claim/)).toBeNull();
  });
});

describe('HPA', () => {
  const hpa = {
    apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler',
    metadata: { name: 'web', namespace: 'shop', uid: 'u-h', resourceVersion: '8' },
    spec: { minReplicas: 2, maxReplicas: 5, scaleTargetRef: { kind: 'Deployment', name: 'web' } },
  } as unknown as K8sResource;

  it('edits min/max with a conditional merge patch and refuses max < min', async () => {
    renderWithProviders(<KindSections resource={hpa} go={go} />);
    const btn = () => screen.getByRole('button', { name: /Edit min\/max/ }) as HTMLButtonElement;
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Minimum replicas'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Maximum replicas'), { target: { value: '1' } });
    expect(within(dialog).getByText(/at least the minimum/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Maximum replicas'), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'PATCH',
      path: '/apis/autoscaling/v2/namespaces/shop/horizontalpodautoscalers/web',
      body: { metadata: { resourceVersion: '8' }, spec: { minReplicas: 3, maxReplicas: 10 } },
    });
  });
});

describe('Service endpoints', () => {
  const svc = { apiVersion: 'v1', kind: 'Service', metadata: { name: 'web', namespace: 'shop', uid: 's' }, spec: { selector: { app: 'web' } } } as unknown as K8sResource;

  it('lists ready and not-ready addresses with links to their pods', async () => {
    respond((c) => (c.path === '/api/v1/namespaces/shop/endpoints/web' ? json({
      subsets: [{
        addresses: [{ ip: '10.0.0.5', nodeName: 'w1', targetRef: { kind: 'Pod', name: 'web-a', namespace: 'shop' } }],
        notReadyAddresses: [{ ip: '10.0.0.6', targetRef: { kind: 'Pod', name: 'web-b', namespace: 'shop' } }],
        ports: [{ port: 8080 }],
      }],
    }) : undefined));
    renderWithProviders(<KindSections resource={svc} go={go} />);
    expect(await screen.findByText('Endpoints (1 ready, 1 not ready)')).toBeTruthy();
    expect(screen.getByText('10.0.0.5:8080')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'web-b' }));
    expect(go).toHaveBeenCalledWith('/r/v1~pods/shop/web-b', 'web-b');
  });

  it('says when no pod is ready behind the selector', async () => {
    respond((c) => (c.path === '/api/v1/namespaces/shop/endpoints/web' ? json({ subsets: [] }) : undefined));
    renderWithProviders(<KindSections resource={svc} go={go} />);
    expect(await screen.findByText(/No ready endpoints/)).toBeTruthy();
  });

  it('an unreadable Endpoints object is an error, not "no endpoints"', async () => {
    respond((c) => (c.path === '/api/v1/namespaces/shop/endpoints/web' ? json({ message: 'boom', code: 500 }, 500) : undefined));
    renderWithProviders(<KindSections resource={svc} go={go} />);
    expect(await screen.findByText('Endpoints could not be loaded')).toBeTruthy();
  });
});

describe('StorageClass', () => {
  it('Set as default clears the old default first, then sets this one', async () => {
    respond((c) => (c.method === 'GET' && c.path === '/apis/storage.k8s.io/v1/storageclasses' ? json({ kind: 'StorageClassList', apiVersion: 'storage.k8s.io/v1', items: [
      { metadata: { name: 'old', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } } },
      { metadata: { name: 'fast' } },
      { metadata: { name: 'other' } },
    ] }) : undefined));
    const sc = { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'fast', uid: 'f' } } as unknown as K8sResource;
    renderWithProviders(<KindSections resource={sc} go={go} />);
    const btn = () => screen.getByRole('button', { name: /Set as default/ }) as HTMLButtonElement;
    await waitFor(() => expect(btn().disabled).toBe(false));
    fireEvent.click(btn());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Set as default' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((w) => [w.path, w.body.metadata.annotations['storageclass.kubernetes.io/is-default-class']])).toEqual([
      ['/apis/storage.k8s.io/v1/storageclasses/old', 'false'],
      ['/apis/storage.k8s.io/v1/storageclasses/fast', 'true'],
    ]);
    expect(calls.some((c) => c.method === 'GET' && c.path === '/apis/storage.k8s.io/v1/storageclasses')).toBe(true);
  });
});
