/**
 * The "Used by" engine: every way a pod template can read a ConfigMap or
 * Secret, and whether running pods see a change without a restart.
 */
import { describe, it, expect } from 'vitest';
import { findConsumers, usagesIn, pickUpOf, referencedConfig, describeUsage, lastEditTime } from '../configConsumers';
import type { K8sResource } from '../renderers';

const wl = (kind: string, name: string, spec: object, extra: object = {}) => ({
  apiVersion: 'apps/v1', kind, metadata: { name, namespace: 'payments', ...extra },
  spec: kind === 'CronJob' ? { jobTemplate: { spec: { template: { spec } } } } : { template: { metadata: { labels: { app: name } }, spec } },
}) as unknown as K8sResource;

const api = wl('Deployment', 'api', {
  containers: [{ name: 'api', env: [
    { name: 'CACHE_SIZE', valueFrom: { configMapKeyRef: { name: 'api-cfg', key: 'CACHE_SIZE' } } },
    { name: 'LOG_LEVEL', valueFrom: { configMapKeyRef: { name: 'api-cfg', key: 'LOG_LEVEL' } } },
    { name: 'PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } },
  ] }],
});
const worker = wl('Deployment', 'worker', { containers: [{ name: 'w', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] });
const sync = wl('Deployment', 'pricing-sync', {
  containers: [{ name: 's', volumeMounts: [{ name: 'cfg', mountPath: '/etc/api-cfg' }] }],
  volumes: [{ name: 'cfg', configMap: { name: 'api-cfg' } }],
});
const subPath = wl('StatefulSet', 'db', {
  containers: [{ name: 'db', volumeMounts: [{ name: 'cfg', mountPath: '/etc/my.cnf', subPath: 'my.cnf' }] }],
  volumes: [{ name: 'cfg', configMap: { name: 'api-cfg', items: [{ key: 'my.cnf', path: 'my.cnf' }] } }],
});
const projected = wl('DaemonSet', 'agent', {
  containers: [{ name: 'a', volumeMounts: [{ name: 'all', mountPath: '/etc/all' }] }],
  volumes: [{ name: 'all', projected: { sources: [{ configMap: { name: 'api-cfg' } }, { secret: { name: 'db' } }] } }],
  imagePullSecrets: [{ name: 'quay-pull' }],
});
const cron = wl('CronJob', 'nightly', { containers: [{ name: 'c', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] });
const cronJobRun = wl('Job', 'nightly-123', { containers: [{ name: 'c', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] }, { ownerReferences: [{ kind: 'CronJob', name: 'nightly' }] });
const oneOff = wl('Job', 'migrate', { containers: [{ name: 'm', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] });
const unrelated = wl('Deployment', 'web', { containers: [{ name: 'web' }] });

describe('usagesIn', () => {
  it('env valueFrom: the keys and the env vars set from them', () => {
    const [u] = usagesIn((api.spec as any).template.spec, 'ConfigMap', 'api-cfg');
    expect(u).toMatchObject({ how: 'env', container: 'api', keys: ['CACHE_SIZE', 'LOG_LEVEL'], envVars: ['CACHE_SIZE', 'LOG_LEVEL'] });
    expect(describeUsage(u, 'ConfigMap')).toBe('env CACHE_SIZE, LOG_LEVEL in api from keys CACHE_SIZE, LOG_LEVEL via configMapKeyRef');
  });

  it('a ConfigMap reference is not a Secret reference of the same name', () => {
    expect(usagesIn((api.spec as any).template.spec, 'Secret', 'api-cfg')).toEqual([]);
    expect(usagesIn((api.spec as any).template.spec, 'Secret', 'db')[0]).toMatchObject({ how: 'env', keys: ['password'] });
  });

  it('projected volumes and image pull secrets (Secrets only)', () => {
    const spec = (projected.spec as any).template.spec;
    expect(usagesIn(spec, 'ConfigMap', 'api-cfg')[0]).toMatchObject({ how: 'projected', mounts: [{ container: 'a', mountPath: '/etc/all', subPath: false }] });
    expect(usagesIn(spec, 'Secret', 'db')[0].how).toBe('projected');
    expect(usagesIn(spec, 'Secret', 'quay-pull')).toEqual([{ how: 'imagePullSecret', keys: [] }]);
    expect(usagesIn(spec, 'ConfigMap', 'quay-pull')).toEqual([]);
  });
});

describe('pickUpOf', () => {
  it('env and envFrom need a restart; a plain volume is refreshed; subPath is not', () => {
    const c = findConsumers('ConfigMap', 'api-cfg', [api, worker, sync, subPath, projected]);
    const by = Object.fromEntries(c.map((x) => [x.name, x.pickUp]));
    expect(by).toEqual({ api: 'restart', worker: 'restart', 'pricing-sync': 'file', db: 'restart', agent: 'file' });
  });

  it('an image pull secret needs nothing; CronJobs pick it up on the next run, Jobs only on a re-run', () => {
    expect(pickUpOf('Deployment', [{ how: 'imagePullSecret', keys: [] }])).toBe('next-pull');
    expect(pickUpOf('CronJob', [{ how: 'envFrom', keys: [] }])).toBe('next-run');
    expect(pickUpOf('Job', [{ how: 'envFrom', keys: [] }])).toBe('rerun');
  });
});

describe('findConsumers', () => {
  it('lists only workloads that reference it, by kind then name, with a CronJob standing for its Jobs', () => {
    const c = findConsumers('ConfigMap', 'api-cfg', [unrelated, worker, cronJobRun, oneOff, cron, api, sync]);
    expect(c.map((x) => `${x.kind}/${x.name}`)).toEqual(['Deployment/api', 'Deployment/pricing-sync', 'Deployment/worker', 'CronJob/nightly', 'Job/migrate']);
  });
});

describe('referencedConfig', () => {
  it('every ConfigMap and Secret name a template reads', () => {
    expect(referencedConfig((projected.spec as any).template.spec)).toEqual({ configMaps: ['api-cfg'], secrets: ['db', 'quay-pull'] });
    expect(referencedConfig((api.spec as any).template.spec)).toEqual({ configMaps: ['api-cfg'], secrets: ['db'] });
  });
});

describe('lastEditTime', () => {
  it('the latest managedFields time; null when none is recorded', () => {
    const r = { metadata: { name: 'x', managedFields: [{ time: '2026-10-12T10:00:00Z' }, { time: '2026-11-02T13:58:00Z' }] } } as unknown as K8sResource;
    expect(lastEditTime(r)).toBe(Date.parse('2026-11-02T13:58:00Z'));
    expect(lastEditTime({ metadata: { name: 'x' } } as K8sResource)).toBeNull();
  });
});

describe('review follow-ups: consumers the first scan missed', () => {
  it('a Secret listed in a ServiceAccount\'s imagePullSecrets reaches every workload running as it (default "default")', () => {
    const sas = [
      { kind: 'ServiceAccount', metadata: { name: 'default' }, imagePullSecrets: [{ name: 'quay-pull' }] },
      { kind: 'ServiceAccount', metadata: { name: 'builder' }, imagePullSecrets: [{ name: 'other' }] },
    ] as unknown as K8sResource[];
    const asDefault = wl('Deployment', 'web', { containers: [{ name: 'w' }] });
    const asBuilder = wl('Deployment', 'build', { serviceAccountName: 'builder', containers: [{ name: 'b' }] });
    const c = findConsumers('Secret', 'quay-pull', [asDefault, asBuilder], sas);
    expect(c.map((x) => x.name)).toEqual(['web']);
    expect(c[0].uses).toEqual([{ how: 'serviceAccountPullSecret', keys: [], serviceAccount: 'default' }]);
    expect(c[0].pickUp).toBe('next-pull');
    expect(describeUsage(c[0].uses[0], 'Secret')).toBe('image pull secret of its ServiceAccount default');
  });

  it('volume driver credentials: CSI nodePublishSecretRef, cephfs/rbd secretRef, azureFile secretName', () => {
    const spec = {
      containers: [{ name: 'c', volumeMounts: [{ name: 'vault', mountPath: '/mnt/secrets' }] }],
      volumes: [
        { name: 'vault', csi: { driver: 'secrets-store.csi.k8s.io', nodePublishSecretRef: { name: 'vault-creds' } } },
        { name: 'ceph', cephfs: { secretRef: { name: 'ceph-key' } } },
        { name: 'r', rbd: { secretRef: { name: 'ceph-key' } } },
        { name: 'az', azureFile: { secretName: 'az-share', shareName: 's' } },
      ],
    };
    const w = wl('Deployment', 'app', spec);
    const [csi] = findConsumers('Secret', 'vault-creds', [w]);
    expect(csi.uses[0]).toMatchObject({ how: 'volumeSecretRef', driver: 'csi secrets-store.csi.k8s.io' });
    expect(csi.pickUp).toBe('mount');
    expect(describeUsage(csi.uses[0], 'Secret')).toBe('credentials of a csi secrets-store.csi.k8s.io volume mounted at /mnt/secrets');
    expect(findConsumers('Secret', 'ceph-key', [w])[0].uses.map((u) => u.driver)).toEqual(['cephfs', 'rbd']);
    expect(findConsumers('Secret', 'az-share', [w])).toHaveLength(1);
    expect(referencedConfig(spec as never).secrets).toEqual(['az-share', 'ceph-key', 'vault-creds']);
  });

  it('DeploymentConfigs are scanned like Deployments', () => {
    const dc = { kind: 'DeploymentConfig', metadata: { name: 'legacy' }, spec: { template: { spec: { containers: [{ name: 'l', envFrom: [{ configMapRef: { name: 'api-cfg' } }] }] } } } } as unknown as K8sResource;
    expect(findConsumers('ConfigMap', 'api-cfg', [dc])[0]).toMatchObject({ kind: 'DeploymentConfig', pickUp: 'restart' });
  });
});
