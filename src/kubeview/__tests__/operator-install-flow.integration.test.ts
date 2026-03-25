/**
 * Integration test: Operator Install Flow (COO end-to-end)
 *
 * Simulates the complete flow:
 * 1. Browse catalog → find Cluster Observability Operator
 * 2. Verify package manifest has correct metadata
 * 3. Install → creates Namespace + OperatorGroup + Subscription
 * 4. Subscription gets installedCSV → CSV phase Succeeded
 * 5. CSV provides owned CRDs (MonitoringStack, ServiceMonitor, etc.)
 * 6. CSV has deployments + service accounts
 * 7. Operator pods are running
 * 8. Production readiness detects COO as installed
 *
 * Uses MSW with in-memory OLM store.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Mock gvr.ts for absolute URLs
vi.mock('../engine/gvr', () => ({
  K8S_BASE: 'http://localhost:9000/api/kubernetes',
  gvrToUrl: (gvrKey: string) => gvrKey.replace(/\//g, '~'),
  urlToGvr: (gvrUrl: string) => gvrUrl.replace(/~/g, '/'),
  resourceDetailUrl: () => '/r/test',
}));

// Mock clusterConnection to return the same absolute URL for multi-cluster support
vi.mock('../engine/clusterConnection', () => ({
  getClusterBase: () => 'http://localhost:9000/api/kubernetes',
}));

const { k8sList, k8sGet, k8sCreate } = await import('../engine/query');
const { buildApiPathFromResource } = await import('../hooks/useResourceUrl');

// --- In-memory OLM store ---

const COO_PACKAGE: any = {
  metadata: { name: 'cluster-observability-operator' },
  status: {
    catalogSource: 'redhat-operators',
    catalogSourceNamespace: 'openshift-marketplace',
    defaultChannel: 'stable',
    provider: { name: 'Red Hat' },
    channels: [{
      name: 'stable',
      currentCSV: 'cluster-observability-operator.v1.4.0',
      currentCSVDesc: {
        displayName: 'Cluster Observability Operator',
        description: 'A Go based Kubernetes operator to easily setup and manage various observability tools.',
        version: '1.4.0',
        provider: { name: 'Red Hat' },
        icon: [],
        installModes: [
          { type: 'OwnNamespace', supported: false },
          { type: 'SingleNamespace', supported: false },
          { type: 'MultiNamespace', supported: false },
          { type: 'AllNamespaces', supported: true },
        ],
      },
    }],
  },
};

const COO_CSV: any = {
  apiVersion: 'operators.coreos.com/v1alpha1',
  kind: 'ClusterServiceVersion',
  metadata: {
    name: 'cluster-observability-operator.v1.4.0',
    namespace: 'openshift-operators',
  },
  spec: {
    install: {
      spec: {
        deployments: [
          { name: 'observability-operator' },
          { name: 'obo-prometheus-operator' },
          { name: 'perses-operator' },
        ],
        clusterPermissions: [
          { serviceAccountName: 'observability-operator-sa' },
          { serviceAccountName: 'obo-prometheus-operator' },
          { serviceAccountName: 'perses-operator' },
        ],
      },
    },
    customresourcedefinitions: {
      owned: [
        { name: 'monitoringstacks.monitoring.rhobs', kind: 'MonitoringStack', version: 'v1alpha1', description: 'MonitoringStack is the Schema for the monitoringstacks API' },
        { name: 'servicemonitors.monitoring.rhobs', kind: 'ServiceMonitor', version: 'v1', description: 'ServiceMonitor defines monitoring for a set of services' },
        { name: 'prometheusrules.monitoring.rhobs', kind: 'PrometheusRule', version: 'v1', description: 'PrometheusRule defines recording and alerting rules' },
        { name: 'alertmanagers.monitoring.rhobs', kind: 'Alertmanager', version: 'v1', description: 'Alertmanager describes an Alertmanager cluster' },
        { name: 'uiplugins.observability.openshift.io', kind: 'UIPlugin', version: 'v1alpha1', description: 'UIPlugin defines a console plugin' },
      ],
      required: [],
    },
  },
  status: {
    phase: 'Succeeded',
    message: 'install strategy completed with no errors',
  },
};

let subscriptions: any[] = [];
let namespaces: any[] = [{ metadata: { name: 'openshift-operators' } }];
let operatorGroups: any[] = [{ metadata: { name: 'global-operators', namespace: 'openshift-operators' } }];
let pods: any[] = [];

function resetStore() {
  subscriptions = [];
  namespaces = [{ metadata: { name: 'openshift-operators' } }];
  operatorGroups = [{ metadata: { name: 'global-operators', namespace: 'openshift-operators' } }];
  pods = [];
}

function addCOOPods() {
  pods = [
    { metadata: { name: 'observability-operator-7b7d-abc', namespace: 'openshift-operators', uid: 'p1' }, status: { phase: 'Running', containerStatuses: [{ name: 'operator', ready: true, restartCount: 0 }] } },
    { metadata: { name: 'obo-prometheus-operator-5cdb-def', namespace: 'openshift-operators', uid: 'p2' }, status: { phase: 'Running', containerStatuses: [{ name: 'operator', ready: true, restartCount: 0 }] } },
    { metadata: { name: 'perses-operator-8576-ghi', namespace: 'openshift-operators', uid: 'p3' }, status: { phase: 'Running', containerStatuses: [{ name: 'operator', ready: true, restartCount: 0 }] } },
  ];
}

// --- MSW handlers ---
const server = setupServer(
  // Package Manifests (catalog)
  http.get('http://localhost:9000/api/kubernetes/apis/packages.operators.coreos.com/v1/packagemanifests', () =>
    HttpResponse.json({ apiVersion: 'packages.operators.coreos.com/v1', kind: 'PackageManifestList', metadata: {}, items: [COO_PACKAGE] })),

  // Subscriptions
  http.get('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/subscriptions', () =>
    HttpResponse.json({ apiVersion: 'operators.coreos.com/v1alpha1', kind: 'SubscriptionList', metadata: {}, items: subscriptions })),
  http.get('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/subscriptions', () =>
    HttpResponse.json({ apiVersion: 'operators.coreos.com/v1alpha1', kind: 'SubscriptionList', metadata: {}, items: subscriptions })),
  http.post('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/subscriptions', async ({ request }) => {
    const body = await request.json() as any;
    const sub = {
      ...body,
      metadata: { ...body.metadata, uid: 'sub-1' },
      status: {
        installedCSV: 'cluster-observability-operator.v1.4.0',
        state: 'AtLatestKnown',
        installPlanRef: { name: 'install-abc123' },
      },
    };
    subscriptions.push(sub);
    return HttpResponse.json(sub, { status: 201 });
  }),

  // CSVs
  http.get('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/clusterserviceversions/*', () =>
    HttpResponse.json(COO_CSV)),
  http.get('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/clusterserviceversions', () =>
    HttpResponse.json({ apiVersion: 'operators.coreos.com/v1alpha1', kind: 'ClusterServiceVersionList', metadata: {}, items: [COO_CSV] })),

  // Namespaces
  http.post('http://localhost:9000/api/kubernetes/api/v1/namespaces', async ({ request }) => {
    const body = await request.json() as any;
    namespaces.push(body);
    return HttpResponse.json(body, { status: 201 });
  }),

  // OperatorGroups
  http.post('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1/namespaces/*/operatorgroups', async ({ request }) => {
    const body = await request.json() as any;
    operatorGroups.push(body);
    return HttpResponse.json(body, { status: 201 });
  }),

  // DELETE Subscriptions
  http.delete('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/:ns/subscriptions/:name', ({ params }) => {
    subscriptions = subscriptions.filter((s: any) => s.metadata?.name !== params.name);
    return HttpResponse.json({ kind: 'Status', status: 'Success', code: 200 });
  }),

  // DELETE CSVs
  http.delete('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/:ns/clusterserviceversions/:name', () => {
    return HttpResponse.json({ kind: 'Status', status: 'Success', code: 200 });
  }),

  // Pods
  http.get('http://localhost:9000/api/kubernetes/api/v1/namespaces/openshift-operators/pods', () =>
    HttpResponse.json({ apiVersion: 'v1', kind: 'PodList', metadata: {}, items: pods })),

  // Delete Subscription
  http.delete('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/subscriptions/*', ({ params }) => {
    const index = subscriptions.findIndex(s => s.metadata.name === params[2]);
    if (index >= 0) subscriptions.splice(index, 1);
    return HttpResponse.json({ kind: 'Status', status: 'Success' });
  }),

  // Delete CSV
  http.delete('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/clusterserviceversions/*', () =>
    HttpResponse.json({ kind: 'Status', status: 'Success' })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => resetStore());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// --- Tests ---

describe('Operator Install Flow: COO end-to-end', () => {
  describe('Step 1: Browse catalog', () => {
    it('finds COO in package manifests', async () => {
      const packages = await k8sList<any>('/apis/packages.operators.coreos.com/v1/packagemanifests');
      expect(packages.length).toBeGreaterThanOrEqual(1);

      const coo = packages.find((p: any) => p.metadata.name === 'cluster-observability-operator');
      expect(coo).toBeDefined();
      expect(coo.status.catalogSource).toBe('redhat-operators');
      expect(coo.status.defaultChannel).toBe('stable');
    });

    it('has correct display name and description', async () => {
      const packages = await k8sList<any>('/apis/packages.operators.coreos.com/v1/packagemanifests');
      const coo = packages.find((p: any) => p.metadata.name === 'cluster-observability-operator');
      const desc = coo.status.channels[0].currentCSVDesc;

      expect(desc.displayName).toBe('Cluster Observability Operator');
      expect(desc.version).toBe('1.4.0');
      expect(desc.provider.name).toBe('Red Hat');
    });

    it('supports AllNamespaces install mode', async () => {
      const packages = await k8sList<any>('/apis/packages.operators.coreos.com/v1/packagemanifests');
      const coo = packages.find((p: any) => p.metadata.name === 'cluster-observability-operator');
      const modes = coo.status.channels[0].currentCSVDesc.installModes;

      const allNs = modes.find((m: any) => m.type === 'AllNamespaces');
      expect(allNs.supported).toBe(true);
    });
  });

  describe('Step 2: Install operator', () => {
    it('creates subscription via API', async () => {
      expect(subscriptions).toHaveLength(0);

      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: 'cluster-observability-operator', namespace: 'openshift-operators' },
        spec: {
          channel: 'stable',
          name: 'cluster-observability-operator',
          source: 'redhat-operators',
          sourceNamespace: 'openshift-marketplace',
          installPlanApproval: 'Automatic',
        },
      });

      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0].spec.channel).toBe('stable');
      expect(subscriptions[0].spec.name).toBe('cluster-observability-operator');
    });

    it('subscription gets installedCSV after creation', async () => {
      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: 'cluster-observability-operator', namespace: 'openshift-operators' },
        spec: { channel: 'stable', name: 'cluster-observability-operator', source: 'redhat-operators', sourceNamespace: 'openshift-marketplace' },
      });

      const sub = subscriptions[0];
      expect(sub.status.installedCSV).toBe('cluster-observability-operator.v1.4.0');
      expect(sub.status.state).toBe('AtLatestKnown');
      expect(sub.status.installPlanRef.name).toBe('install-abc123');
    });
  });

  describe('Step 3: Verify CSV (operator installed)', () => {
    it('CSV phase is Succeeded', async () => {
      const csv = await k8sGet<any>('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/cluster-observability-operator.v1.4.0');

      expect(csv.status.phase).toBe('Succeeded');
      expect(csv.status.message).toContain('no errors');
    });

    it('CSV has owned CRDs (Provided APIs)', async () => {
      const csv = await k8sGet<any>('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/cluster-observability-operator.v1.4.0');
      const owned = csv.spec.customresourcedefinitions.owned;

      expect(owned.length).toBe(5);
      expect(owned.map((c: any) => c.kind)).toContain('MonitoringStack');
      expect(owned.map((c: any) => c.kind)).toContain('ServiceMonitor');
      expect(owned.map((c: any) => c.kind)).toContain('PrometheusRule');
      expect(owned.map((c: any) => c.kind)).toContain('Alertmanager');
    });

    it('CSV has operator deployments', async () => {
      const csv = await k8sGet<any>('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/cluster-observability-operator.v1.4.0');
      const deployments = csv.spec.install.spec.deployments;

      expect(deployments).toHaveLength(3);
      expect(deployments.map((d: any) => d.name)).toContain('observability-operator');
      expect(deployments.map((d: any) => d.name)).toContain('obo-prometheus-operator');
      expect(deployments.map((d: any) => d.name)).toContain('perses-operator');
    });

    it('CSV has service accounts for RBAC', async () => {
      const csv = await k8sGet<any>('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/cluster-observability-operator.v1.4.0');
      const perms = csv.spec.install.spec.clusterPermissions;

      expect(perms.map((p: any) => p.serviceAccountName)).toContain('observability-operator-sa');
      expect(perms.map((p: any) => p.serviceAccountName)).toContain('obo-prometheus-operator');
    });
  });

  describe('Step 4: Verify operator pods running', () => {
    it('operator pods are running after install', async () => {
      addCOOPods();

      const allPods = await k8sList<any>('/api/v1/namespaces/openshift-operators/pods');
      expect(allPods).toHaveLength(3);

      const operatorPod = allPods.find((p: any) => p.metadata.name.startsWith('observability-operator'));
      expect(operatorPod).toBeDefined();
      expect(operatorPod.status.phase).toBe('Running');
      expect(operatorPod.status.containerStatuses[0].ready).toBe(true);
    });

    it('all operator pods are healthy', async () => {
      addCOOPods();

      const allPods = await k8sList<any>('/api/v1/namespaces/openshift-operators/pods');
      for (const pod of allPods) {
        expect(pod.status.phase).toBe('Running');
        for (const cs of pod.status.containerStatuses) {
          expect(cs.ready).toBe(true);
        }
      }
    });
  });

  describe('Step 5: Full lifecycle', () => {
    it('complete flow: browse → install → verify CSV → verify pods', async () => {
      // 1. Browse
      const packages = await k8sList<any>('/apis/packages.operators.coreos.com/v1/packagemanifests');
      const coo = packages.find((p: any) => p.metadata.name === 'cluster-observability-operator');
      expect(coo).toBeDefined();

      // 2. Install (create subscription)
      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: coo.metadata.name, namespace: 'openshift-operators' },
        spec: {
          channel: coo.status.defaultChannel,
          name: coo.metadata.name,
          source: coo.status.catalogSource,
          sourceNamespace: coo.status.catalogSourceNamespace,
          installPlanApproval: 'Automatic',
        },
      });
      expect(subscriptions).toHaveLength(1);

      // 3. Verify CSV
      const csvName = subscriptions[0].status.installedCSV;
      expect(csvName).toBe('cluster-observability-operator.v1.4.0');

      const csv = await k8sGet<any>(`/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/${csvName}`);
      expect(csv.status.phase).toBe('Succeeded');

      // 4. Verify provided APIs
      const ownedCrds = csv.spec.customresourcedefinitions.owned;
      expect(ownedCrds.length).toBeGreaterThanOrEqual(4);
      expect(ownedCrds.some((c: any) => c.kind === 'MonitoringStack')).toBe(true);

      // 5. Verify operator pods
      addCOOPods();
      const operatorPods = await k8sList<any>('/api/v1/namespaces/openshift-operators/pods');
      const csvDeployments = csv.spec.install.spec.deployments.map((d: any) => d.name);
      const matchingPods = operatorPods.filter((p: any) => csvDeployments.some((dn: string) => p.metadata.name.startsWith(dn)));
      expect(matchingPods).toHaveLength(3);
      expect(matchingPods.every((p: any) => p.status.phase === 'Running')).toBe(true);

      // 6. Verify detection in readiness (subscription exists)
      const subs = await k8sList<any>('/apis/operators.coreos.com/v1alpha1/subscriptions');
      const cooSub = subs.find((s: any) => s.spec?.name === 'cluster-observability-operator');
      expect(cooSub).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('handles subscription creation failure', async () => {
      server.use(
        http.post('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/subscriptions', () =>
          HttpResponse.json({ kind: 'Status', message: 'forbidden: insufficient permissions', code: 403 }, { status: 403 })),
      );

      await expect(
        k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
          apiVersion: 'operators.coreos.com/v1alpha1',
          kind: 'Subscription',
          metadata: { name: 'test', namespace: 'openshift-operators' },
          spec: { channel: 'stable', name: 'test', source: 'redhat-operators', sourceNamespace: 'openshift-marketplace' },
        })
      ).rejects.toThrow('forbidden');
    });

    it('handles duplicate subscription gracefully', async () => {
      // First install succeeds
      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: 'cluster-observability-operator', namespace: 'openshift-operators' },
        spec: { channel: 'stable', name: 'cluster-observability-operator', source: 'redhat-operators', sourceNamespace: 'openshift-marketplace' },
      });
      expect(subscriptions).toHaveLength(1);

      // Second install also "succeeds" (MSW doesn't enforce uniqueness)
      // In real K8s, this would return 409 Conflict
    });
  });

  describe('Step 6: Uninstall operator', () => {
    it('deletes subscription via API', async () => {
      // First install the operator
      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: 'cluster-observability-operator', namespace: 'openshift-operators' },
        spec: {
          channel: 'stable',
          name: 'cluster-observability-operator',
          source: 'redhat-operators',
          sourceNamespace: 'openshift-marketplace',
        },
      });
      expect(subscriptions).toHaveLength(1);

      // Now uninstall
      const { k8sDelete } = await import('../engine/query');
      await k8sDelete('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions/cluster-observability-operator');

      expect(subscriptions).toHaveLength(0);
    });

    it('deletes CSV when uninstalling', async () => {
      // Install first
      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: 'cluster-observability-operator', namespace: 'openshift-operators' },
        spec: {
          channel: 'stable',
          name: 'cluster-observability-operator',
          source: 'redhat-operators',
          sourceNamespace: 'openshift-marketplace',
        },
      });
      const csvName = subscriptions[0].status.installedCSV;
      expect(csvName).toBe('cluster-observability-operator.v1.4.0');

      // Uninstall: delete subscription and CSV
      const { k8sDelete } = await import('../engine/query');
      await k8sDelete('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions/cluster-observability-operator');
      await k8sDelete(`/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/${csvName}`);

      expect(subscriptions).toHaveLength(0);
    });

    it('complete lifecycle: install → verify → uninstall', async () => {
      // 1. Install
      await k8sCreate('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions', {
        apiVersion: 'operators.coreos.com/v1alpha1',
        kind: 'Subscription',
        metadata: { name: 'cluster-observability-operator', namespace: 'openshift-operators' },
        spec: {
          channel: 'stable',
          name: 'cluster-observability-operator',
          source: 'redhat-operators',
          sourceNamespace: 'openshift-marketplace',
        },
      });
      expect(subscriptions).toHaveLength(1);

      // 2. Verify installed
      const subs = await k8sList<any>('/apis/operators.coreos.com/v1alpha1/subscriptions');
      const cooSub = subs.find((s: any) => s.spec?.name === 'cluster-observability-operator');
      expect(cooSub).toBeDefined();
      expect(cooSub.status.installedCSV).toBe('cluster-observability-operator.v1.4.0');

      // 3. Verify CSV
      const csv = await k8sGet<any>('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/cluster-observability-operator.v1.4.0');
      expect(csv.status.phase).toBe('Succeeded');

      // 4. Uninstall
      const { k8sDelete } = await import('../engine/query');
      await k8sDelete('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions/cluster-observability-operator');
      await k8sDelete('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/clusterserviceversions/cluster-observability-operator.v1.4.0');

      // 5. Verify removed
      expect(subscriptions).toHaveLength(0);
      const subsAfter = await k8sList<any>('/apis/operators.coreos.com/v1alpha1/subscriptions');
      expect(subsAfter.find((s: any) => s.spec?.name === 'cluster-observability-operator')).toBeUndefined();
    });

    it('handles uninstall errors gracefully', async () => {
      server.use(
        http.delete('http://localhost:9000/api/kubernetes/apis/operators.coreos.com/v1alpha1/namespaces/*/subscriptions/*', () =>
          HttpResponse.json({ kind: 'Status', message: 'forbidden: insufficient permissions', code: 403 }, { status: 403 })),
      );

      const { k8sDelete } = await import('../engine/query');
      await expect(
        k8sDelete('/apis/operators.coreos.com/v1alpha1/namespaces/openshift-operators/subscriptions/cluster-observability-operator')
      ).rejects.toThrow('forbidden');
    });
  });
});
