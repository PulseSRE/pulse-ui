/**
 * Related objects of a workload for delete: what exists only for it, what is
 * shared (kept, cannot be chosen), PVCs (never chosen by default, data loss
 * stated), and kinds that could not be read (named, not treated as none).
 */
import { describe, it, expect } from 'vitest';
import { computeRelated } from '../relatedObjects';
import { helmOwnerOf, helmReleasePath } from '../helmOwnership';
import type { K8sResource } from '../renderers';

const tmpl = (app: string, spec: object = {}) => ({ metadata: { labels: { app } }, spec: { containers: [{ name: app }], ...spec } });
const legacy = {
  kind: 'Deployment', apiVersion: 'apps/v1', metadata: { name: 'storefront-legacy', namespace: 'shop', uid: 'u1' },
  spec: { template: tmpl('storefront-legacy', {
    containers: [{ name: 'web', envFrom: [{ configMapRef: { name: 'storefront-legacy-cfg' } }, { configMapRef: { name: 'shop-feature-flags' } }], env: [{ name: 'CA', valueFrom: { configMapKeyRef: { name: 'kube-root-ca.crt', key: 'ca.crt' } } }] }],
    volumes: [{ name: 'up', persistentVolumeClaim: { claimName: 'uploads-storefront-legacy' } }],
  }) },
} as unknown as K8sResource;
const storefront = { kind: 'Deployment', metadata: { name: 'storefront', namespace: 'shop' }, spec: { template: tmpl('storefront', { containers: [{ name: 's', envFrom: [{ configMapRef: { name: 'shop-feature-flags' } }] }] }) } } as unknown as K8sResource;
const cart = { kind: 'Deployment', metadata: { name: 'cart', namespace: 'shop' }, spec: { template: tmpl('cart', { containers: [{ name: 'c', envFrom: [{ configMapRef: { name: 'shop-feature-flags' } }] }] }) } } as unknown as K8sResource;

const r = (kind: string, name: string, spec: object, status?: object) => ({ kind, metadata: { name, namespace: 'shop', uid: `uid-${name}` }, spec, status }) as unknown as K8sResource;
const lists = {
  Service: [r('Service', 'storefront-legacy', { selector: { app: 'storefront-legacy' } }), r('Service', 'storefront', { selector: { app: 'storefront' } })],
  Route: [r('Route', 'storefront-legacy', { host: 'legacy.shop.example.com', to: { kind: 'Service', name: 'storefront-legacy' } }), r('Route', 'storefront', { to: { kind: 'Service', name: 'storefront' } })],
  HorizontalPodAutoscaler: [r('HorizontalPodAutoscaler', 'storefront-legacy', { scaleTargetRef: { kind: 'Deployment', name: 'storefront-legacy' } })],
  PodDisruptionBudget: [] as K8sResource[],
  NetworkPolicy: null,
  PersistentVolumeClaim: [r('PersistentVolumeClaim', 'uploads-storefront-legacy', { volumeName: 'pv-1' }, { capacity: { storage: '14Gi' } })],
};

const byName = (res: ReturnType<typeof computeRelated>) => Object.fromEntries(res.candidates.map((c) => [`${c.kind}/${c.name}`, c]));

describe('computeRelated', () => {
  const res = computeRelated(legacy, { workloads: [legacy, storefront, cart], workloadsIncomplete: [], lists, reclaimPolicies: { 'pv-1': 'Delete' } });
  const c = byName(res);

  it('offers what exists only for this workload, chosen by default', () => {
    expect(c['Service/storefront-legacy']).toMatchObject({ defaultChecked: true, keptReason: undefined, path: '/api/v1/namespaces/shop/services/storefront-legacy' });
    expect(c['Route/storefront-legacy']).toMatchObject({ defaultChecked: true, path: '/apis/route.openshift.io/v1/namespaces/shop/routes/storefront-legacy' });
    expect(c['Route/storefront-legacy'].note).toMatch(/legacy\.shop\.example\.com/);
    expect(c['HorizontalPodAutoscaler/storefront-legacy']).toMatchObject({ defaultChecked: true, path: '/apis/autoscaling/v2/namespaces/shop/horizontalpodautoscalers/storefront-legacy' });
    expect(c['ConfigMap/storefront-legacy-cfg']).toMatchObject({ defaultChecked: true, note: 'Used by nothing else' });
    // Other workloads' Services and Routes are not related.
    expect(c['Service/storefront']).toBeUndefined();
    expect(c['Route/storefront']).toBeUndefined();
  });

  it('keeps shared and cluster-created objects, with the reason', () => {
    expect(c['ConfigMap/shop-feature-flags'].keptReason).toBe('Kept: also used by Deployment storefront, Deployment cart');
    expect(c['ConfigMap/kube-root-ca.crt'].keptReason).toMatch(/created by the cluster/);
  });

  it('never chooses a PVC by default and states the data loss', () => {
    const pvc = c['PersistentVolumeClaim/uploads-storefront-legacy'];
    expect(pvc.defaultChecked).toBe(false);
    expect(pvc.dataLoss).toBe(true);
    expect(pvc.note).toMatch(/destroys 14Gi of data for good: the volume's reclaim policy is Delete/);
  });

  it('names a kind it could not read instead of treating it as none', () => {
    expect(res.notChecked).toEqual(['NetworkPolicy']);
  });

  it('an unreadable PV: the data loss is stated as unknown', () => {
    const r2 = computeRelated(legacy, { workloads: [legacy], workloadsIncomplete: [], lists, reclaimPolicies: { 'pv-1': null } });
    expect(byName(r2)['PersistentVolumeClaim/uploads-storefront-legacy'].note).toMatch(/may destroy 14Gi.*could not be checked/);
  });

  it('when other workloads could not all be read, sharing is unknown and nothing shared-able is chosen', () => {
    const r2 = byName(computeRelated(legacy, { workloads: [legacy], workloadsIncomplete: ['StatefulSets'], lists, reclaimPolicies: {} }));
    expect(r2['Service/storefront-legacy']).toMatchObject({ defaultChecked: false, keptReason: undefined });
    expect(r2['Service/storefront-legacy'].note).toMatch(/Could not check whether StatefulSets also use it/);
    expect(r2['ConfigMap/storefront-legacy-cfg'].defaultChecked).toBe(false);
    // The Route follows its Service.
    expect(r2['Route/storefront-legacy'].defaultChecked).toBe(false);
  });

  it('a Service that also selects another workload is kept, and so is its Route', () => {
    const twin = { ...storefront, metadata: { name: 'twin', namespace: 'shop' }, spec: { template: tmpl('storefront-legacy') } } as unknown as K8sResource;
    const r2 = byName(computeRelated(legacy, { workloads: [legacy, twin], workloadsIncomplete: [], lists, reclaimPolicies: {} }));
    expect(r2['Service/storefront-legacy'].keptReason).toBe('Kept: also selects pods of Deployment twin');
    expect(r2['Route/storefront-legacy'].keptReason).toMatch(/Service storefront-legacy, which is kept/);
  });

  it('a PDB or NetworkPolicy with an empty selector selects every pod and is kept', () => {
    const r2 = byName(computeRelated(legacy, { workloads: [legacy], workloadsIncomplete: [], lists: { ...lists, NetworkPolicy: [r('NetworkPolicy', 'deny-all', { podSelector: {} })] }, reclaimPolicies: {} }));
    expect(r2['NetworkPolicy/deny-all'].keptReason).toBe('Kept: selects every pod in shop');
  });

  it('StatefulSet claims from volumeClaimTemplates', () => {
    const sts = { kind: 'StatefulSet', metadata: { name: 'db', namespace: 'shop' }, spec: { template: tmpl('db'), volumeClaimTemplates: [{ metadata: { name: 'data' } }] } } as unknown as K8sResource;
    const pvcs = [r('PersistentVolumeClaim', 'data-db-0', {}), r('PersistentVolumeClaim', 'data-db-1', {}), r('PersistentVolumeClaim', 'data-dbx-0', {})];
    const r2 = computeRelated(sts, { workloads: [sts], workloadsIncomplete: [], lists: { ...lists, PersistentVolumeClaim: pvcs }, reclaimPolicies: {} });
    expect(r2.candidates.filter((x) => x.kind === 'PersistentVolumeClaim').map((x) => x.name)).toEqual(['data-db-0', 'data-db-1']);
  });
});

describe('helmOwnerOf', () => {
  it('needs both the managed-by label and the release annotation', () => {
    const md = (labels: object, annotations: object) => ({ metadata: { name: 'checkout', namespace: 'shop', labels, annotations } }) as unknown as K8sResource;
    expect(helmOwnerOf(md({ 'app.kubernetes.io/managed-by': 'Helm', 'helm.sh/chart': 'checkout-3.2.1' }, { 'meta.helm.sh/release-name': 'checkout', 'meta.helm.sh/release-namespace': 'shop' })))
      .toEqual({ release: 'checkout', namespace: 'shop', chart: 'checkout-3.2.1' });
    expect(helmOwnerOf(md({ 'app.kubernetes.io/managed-by': 'Helm' }, {}))).toBeNull();
    expect(helmOwnerOf(md({ 'app.kubernetes.io/managed-by': 'argocd' }, { 'meta.helm.sh/release-name': 'checkout' }))).toBeNull();
    expect(helmReleasePath({ release: 'checkout', namespace: 'shop' }, 'rollback')).toBe('/software?tab=helm&release=checkout&releaseNs=shop&action=rollback');
  });
});
