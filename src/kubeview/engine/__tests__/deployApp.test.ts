import { describe, expect, it } from 'vitest';
import { effectiveForm, emptyForm, planObjects, quotaHeadroom, validateForm, type DeployForm } from '../deployApp';

const CAPS = { routes: true, builds: true };

function form(patch: Partial<DeployForm> = {}): DeployForm {
  return { ...emptyForm('team-a'), name: 'api', source: { type: 'image', image: 'quay.io/acme/api:1', pullSecret: '' }, port: '8080', ...patch };
}

describe('validateForm', () => {
  it('accepts a minimal image deploy', () => {
    expect(validateForm(form(), CAPS)).toEqual([]);
  });

  it('names each problem', () => {
    const f = form({ name: 'Bad_Name', port: '70000', replicas: '-1', resources: { cpuRequest: '2', cpuLimit: '1', memRequest: 'lots', memLimit: '' } });
    const errs = validateForm(f, CAPS);
    expect(errs).toEqual(expect.arrayContaining([
      expect.stringMatching(/Name must be lowercase/),
      'Container port must be between 1 and 65535.',
      'Replicas must be between 0 and 100.',
      'Memory request "lots" is not a quantity (e.g. 250m, 512Mi).',
      'CPU request is above its limit.',
    ]));
  });

  it('needs a port for probes and exposure, and builds for a Git source', () => {
    expect(validateForm(form({ port: '' }), CAPS)).toEqual(['The readiness probe needs a port (set the container port or the probe\'s).', 'The liveness probe needs a port (set the container port or the probe\'s).']);
    expect(planObjects(form({ port: '', probes: { ...emptyForm('x').probes, readiness: { ...emptyForm('x').probes.readiness, enabled: false }, liveness: { ...emptyForm('x').probes.liveness, enabled: false } } })).map((o) => o.kind)).toEqual(['Deployment']);
    expect(validateForm(form({ source: { type: 'git', gitUrl: 'https://x/y.git', gitRef: '', contextDir: '', builderImage: 'nodejs:20' } }), { routes: true, builds: false }))
      .toContain('Git builds are not available on this cluster.');
  });
});

describe('planObjects', () => {
  it('orders dependencies first and adds a PDB only above one replica', () => {
    expect(planObjects(form({ replicas: '1' })).map((o) => o.kind)).toEqual(['Deployment', 'Service', 'Route']);
    const f = form({ replicas: '3', storage: { mode: 'new', claimName: '', size: '5Gi', storageClass: 'gp3', accessMode: 'ReadWriteMany', mountPath: '/d' } });
    expect(planObjects(f).map((o) => `${o.kind}/${o.name}`)).toEqual(['PersistentVolumeClaim/data-api', 'Deployment/api', 'PodDisruptionBudget/api', 'Service/api', 'Route/api']);
  });

  it('drops the Route where the cluster serves none', () => {
    expect(planObjects(effectiveForm(form(), { routes: false })).map((o) => o.kind)).toEqual(['Deployment', 'Service']);
  });

  it('references the pull secret by name', () => {
    const dep = planObjects(form({ source: { type: 'image', image: 'quay.io/a/b:1', pullSecret: 'acme-quay' } }))[0].body as { spec: { template: { spec: { imagePullSecrets: unknown } } } };
    expect(dep.spec.template.spec.imagePullSecrets).toEqual([{ name: 'acme-quay' }]);
  });
});

describe('quotaHeadroom', () => {
  it('adds replicas × requests, one surge pod for the next rollout, and storage', () => {
    const f = form({ replicas: '2', resources: { cpuRequest: '500m', cpuLimit: '', memRequest: '1Gi', memLimit: '' }, storage: { mode: 'new', claimName: '', size: '10Gi', storageClass: '', accessMode: 'ReadWriteOnce', mountPath: '/d' } });
    const lines = quotaHeadroom(f, [{ metadata: { name: 'q' }, status: { hard: { 'requests.cpu': '4', 'requests.memory': '4Gi', pods: '10', 'requests.storage': '100Gi', configmaps: '5' }, used: { 'requests.cpu': '1', 'requests.memory': '2Gi', pods: '3', 'requests.storage': '0' } } }]);
    const by = Object.fromEntries(lines.map((l) => [l.resource, l]));
    expect(by['requests.cpu']).toMatchObject({ after: 2, duringRollout: 2.5 });
    expect(by['requests.memory'].after).toBe(4 * 1024 ** 3);
    expect(by['requests.memory'].duringRollout).toBe(5 * 1024 ** 3);
    expect(by.pods).toMatchObject({ after: 5, duringRollout: 6 });
    expect(by['requests.storage'].after).toBe(10 * 1024 ** 3);
    expect(by.configmaps).toBeUndefined();
  });

  it('flags a quota on a resource the form leaves unset', () => {
    const lines = quotaHeadroom(form(), [{ metadata: { name: 'q' }, status: { hard: { 'limits.memory': '8Gi' }, used: {} } }]);
    expect(lines[0].unsetButRequired).toBe(true);
  });
});
