import { describe, expect, it } from 'vitest';
import { buildHelmInstallResources } from '../helmInstall';

describe('buildHelmInstallResources', () => {
  it('uses a digest-pinned runner image and dedicated service account', () => {
    const runnerImage = `quay.io/example/pulse-helm-runner@sha256:${'a'.repeat(64)}`;
    const resources = buildHelmInstallResources({
      namespace: 'demo',
      releaseName: 'my-app',
      chartName: 'nginx',
      repoUrl: 'https://charts.example.com',
      runnerImage,
      serviceAccountName: 'openshiftpulse-helm-installer',
    });

    expect(resources.serviceAccount.metadata.name).toBe('openshiftpulse-helm-installer');
    expect(resources.role.kind).toBe('Role');
    expect(resources.role.metadata.namespace).toBe('demo');
    expect(resources.roleBinding.subjects).toEqual([
      { kind: 'ServiceAccount', name: 'openshiftpulse-helm-installer', namespace: 'demo' },
    ]);
    expect(resources.job.spec.template.spec.serviceAccountName).toBe('openshiftpulse-helm-installer');
    expect(resources.job.spec.template.spec.containers[0].image).toBe(runnerImage);
    expect(resources.job.spec.template.spec.containers[0].securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
    });

    const coreRule = resources.role.rules.find((r) => r.apiGroups.includes('') && r.resources.includes('pods'));
    expect(coreRule?.resources).not.toContain('secrets');
    expect(coreRule?.resources).not.toContain('serviceaccounts');

    const secretsRule = resources.role.rules.find((r) => r.resources.includes('secrets'));
    expect(secretsRule).toBeDefined();
    expect(secretsRule?.verbs).not.toContain('watch');
    expect(secretsRule?.verbs).not.toContain('patch');
  });

  it('rejects mutable runner image tags', () => {
    expect(() => buildHelmInstallResources({
      namespace: 'demo',
      releaseName: 'my-app',
      chartName: 'nginx',
      repoUrl: 'https://charts.example.com',
      runnerImage: 'alpine/helm:latest',
      serviceAccountName: 'openshiftpulse-helm-installer',
    })).toThrow(/digest-pinned/);
  });

  it('rejects malformed digest references', () => {
    expect(() => buildHelmInstallResources({
      namespace: 'demo',
      releaseName: 'my-app',
      chartName: 'nginx',
      repoUrl: 'https://charts.example.com',
      runnerImage: 'quay.io/example/pulse-helm-runner@sha256:abcdef',
      serviceAccountName: 'openshiftpulse-helm-installer',
    })).toThrow(/digest-pinned/);
  });
});
