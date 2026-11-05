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

const meta = (name: string, extra: object = {}) => ({ kind: 'PartialObjectMetadata', metadata: { name, namespace: 'shop', uid: `uid-${name}`, ...extra } }) as unknown as K8sResource;
const configMeta = {
  ConfigMap: [meta('storefront-legacy-cfg'), meta('shop-feature-flags'), meta('kube-root-ca.crt')],
  Secret: [] as K8sResource[],
};

const byName = (res: ReturnType<typeof computeRelated>) => Object.fromEntries(res.candidates.map((c) => [`${c.kind}/${c.name}`, c]));

describe('computeRelated', () => {
  const res = computeRelated(legacy, { workloads: [legacy, storefront, cart], workloadsIncomplete: [], lists, reclaimPolicies: { 'pv-1': 'Delete' }, configMeta, serviceAccounts: [] });
  const c = byName(res);

  it('offers what exists only for this workload, chosen by default', () => {
    expect(c['Service/storefront-legacy']).toMatchObject({ defaultChecked: true, keptReason: undefined, path: '/api/v1/namespaces/shop/services/storefront-legacy' });
    expect(c['Route/storefront-legacy']).toMatchObject({ defaultChecked: true, path: '/apis/route.openshift.io/v1/namespaces/shop/routes/storefront-legacy' });
    expect(c['Route/storefront-legacy'].note).toMatch(/legacy\.shop\.example\.com/);
    expect(c['HorizontalPodAutoscaler/storefront-legacy']).toMatchObject({ defaultChecked: true, path: '/apis/autoscaling/v2/namespaces/shop/horizontalpodautoscalers/storefront-legacy' });
    expect(c['ConfigMap/storefront-legacy-cfg']).toMatchObject({ defaultChecked: true, note: 'No other Deployment, StatefulSet, DaemonSet, DeploymentConfig, CronJob or Job in shop uses it; other kinds not checked' });
    // Read metadata-only: the uid is there for the delete precondition.
    expect(c['ConfigMap/storefront-legacy-cfg'].resource?.metadata.uid).toBe('uid-storefront-legacy-cfg');
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
    const r2 = byName(computeRelated(legacy, { workloads: [legacy], workloadsIncomplete: ['StatefulSets'], lists, reclaimPolicies: {}, configMeta, serviceAccounts: [] }));
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

describe('review follow-ups: ConfigMaps/Secrets, owners, retention', () => {
  const withSecrets = {
    ...legacy,
    spec: { template: tmpl('storefront-legacy', { containers: [{ name: 'web', envFrom: [{ secretRef: { name: 'app-creds' } }, { configMapRef: { name: 'gen-cfg' } }, { configMapRef: { name: 'chart-cfg' } }, { configMapRef: { name: 'missing-cfg' } }] }], imagePullSecrets: [{ name: 'pull' }] }) },
  } as unknown as K8sResource;
  const metaLists = {
    ConfigMap: [
      meta('gen-cfg', { ownerReferences: [{ kind: 'Certificate', name: 'web-cert' }] }),
      meta('chart-cfg', { labels: { 'app.kubernetes.io/managed-by': 'Helm' }, annotations: { 'meta.helm.sh/release-name': 'other' } }),
    ],
    Secret: [meta('app-creds'), meta('pull')],
  };
  const sas = [{ kind: 'ServiceAccount', metadata: { name: 'default' }, imagePullSecrets: [{ name: 'pull' }] }] as unknown as K8sResource[];
  const c = byName(computeRelated(withSecrets, { workloads: [withSecrets], workloadsIncomplete: [], lists, configMeta: metaLists, serviceAccounts: sas }));

  it('a Secret is offered but never chosen by default', () => {
    expect(c['Secret/app-creds']).toMatchObject({ defaultChecked: false, keptReason: undefined });
    expect(c['Secret/app-creds'].note).toMatch(/and no ServiceAccount lists it; other kinds not checked\. Secrets are not chosen by default/);
  });

  it('keeps objects with an owner, of another Helm release, listed by a ServiceAccount, or not found', () => {
    expect(c['ConfigMap/gen-cfg'].keptReason).toBe('Kept: owned by Certificate web-cert');
    expect(c['ConfigMap/chart-cfg'].keptReason).toBe('Kept: part of Helm release other');
    expect(c['Secret/pull'].keptReason).toBe('Kept: listed by ServiceAccount default');
    expect(c['ConfigMap/missing-cfg'].keptReason).toBe('Not found in shop');
  });

  it('when ConfigMaps/Secrets or ServiceAccounts cannot be listed, nothing is chosen and it says why', () => {
    const r = byName(computeRelated(withSecrets, { workloads: [withSecrets], workloadsIncomplete: [], lists, configMeta: { ConfigMap: null, Secret: null }, serviceAccounts: null }));
    expect(r['ConfigMap/gen-cfg']).toMatchObject({ defaultChecked: false, keptReason: undefined });
    expect(r['ConfigMap/gen-cfg'].note).toMatch(/Could not check what owns it/);
    expect(r['Secret/app-creds'].note).toMatch(/Could not check whether a ServiceAccount lists it/);
  });

  it('a related object managed by a controller is kept', () => {
    const owned = { ...lists, Service: [{ kind: 'Service', metadata: { name: 'storefront-legacy', namespace: 'shop', ownerReferences: [{ kind: 'Knative', name: 'svc', controller: true }] }, spec: { selector: { app: 'storefront-legacy' } } } as unknown as K8sResource] };
    const r = byName(computeRelated(legacy, { workloads: [legacy], workloadsIncomplete: [], lists: owned, configMeta, serviceAccounts: [] }));
    expect(r['Service/storefront-legacy']).toMatchObject({ defaultChecked: false, keptReason: 'Kept: managed by Knative svc' });
  });

  it('a StatefulSet whose retention policy deletes its claims: said, not offered as a choice; names are matched literally', () => {
    const sts = { kind: 'StatefulSet', metadata: { name: 'db.x', namespace: 'shop' }, spec: { template: tmpl('db'), volumeClaimTemplates: [{ metadata: { name: 'data' } }], persistentVolumeClaimRetentionPolicy: { whenDeleted: 'Delete' } } } as unknown as K8sResource;
    const pvcs = [r('PersistentVolumeClaim', 'data-db.x-0', {}), r('PersistentVolumeClaim', 'data-dbxx-0', {})];
    const res = computeRelated(sts, { workloads: [sts], workloadsIncomplete: [], lists: { ...lists, PersistentVolumeClaim: pvcs }, reclaimPolicies: {} });
    const claims = res.candidates.filter((x) => x.kind === 'PersistentVolumeClaim');
    expect(claims.map((x) => x.name)).toEqual(['data-db.x-0']);
    expect(claims[0]).toMatchObject({ byController: true });
    expect(claims[0].note).toMatch(/Will be deleted by the StatefulSet's retention policy/);
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
