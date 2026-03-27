import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeForGitOps } from '../engine/yamlUtils';
import { useGitOpsSetupStore } from '../store/gitopsSetupStore';

describe('sanitizeForGitOps', () => {
  it('strips status, resourceVersion, uid, managedFields, ownerReferences', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'my-config',
        namespace: 'default',
        resourceVersion: '12345',
        uid: 'abc-123',
        creationTimestamp: '2024-01-01T00:00:00Z',
        generation: 3,
        selfLink: '/api/v1/namespaces/default/configmaps/my-config',
        managedFields: [{ manager: 'kubectl' }],
        ownerReferences: [{ kind: 'Deployment', name: 'my-deploy' }],
      },
      data: { key: 'value' },
      status: { phase: 'Active' },
    };

    const result = sanitizeForGitOps(resource);

    expect(result.status).toBeUndefined();
    expect(result.metadata).toBeDefined();
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.resourceVersion).toBeUndefined();
    expect(meta.uid).toBeUndefined();
    expect(meta.creationTimestamp).toBeUndefined();
    expect(meta.generation).toBeUndefined();
    expect(meta.selfLink).toBeUndefined();
    expect(meta.managedFields).toBeUndefined();
    expect(meta.ownerReferences).toBeUndefined();
    // Preserved fields
    expect(meta.name).toBe('my-config');
    expect(meta.namespace).toBe('default');
    expect((result as Record<string, unknown>).data).toEqual({ key: 'value' });
  });

  it('redacts Secret data and adds annotation', () => {
    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'my-secret', namespace: 'default' },
      data: { password: 'c2VjcmV0', username: 'dXNlcg==' },
      stringData: { token: 'plaintext' },
    };

    const result = sanitizeForGitOps(secret);

    expect(result.data).toEqual({});
    expect(result.stringData).toBeUndefined();
    const meta = result.metadata as Record<string, unknown>;
    const annotations = meta.annotations as Record<string, string>;
    expect(annotations['openshiftpulse.io/secret-data']).toBe('redacted');
  });

  it('removes noisy annotations and pv.kubernetes.io/* annotations', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: 'my-pvc',
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration': '{}',
          'openshift.io/generated-by': 'OpenShiftWebConsole',
          'deployment.kubernetes.io/revision': '3',
          'pv.kubernetes.io/bind-completed': 'yes',
          'pv.kubernetes.io/bound-by-controller': 'yes',
          'my-custom/annotation': 'keep-me',
        },
      },
    };

    const result = sanitizeForGitOps(resource);
    const meta = result.metadata as Record<string, unknown>;
    const annotations = meta.annotations as Record<string, string>;

    expect(annotations['kubectl.kubernetes.io/last-applied-configuration']).toBeUndefined();
    expect(annotations['openshift.io/generated-by']).toBeUndefined();
    expect(annotations['deployment.kubernetes.io/revision']).toBeUndefined();
    expect(annotations['pv.kubernetes.io/bind-completed']).toBeUndefined();
    expect(annotations['pv.kubernetes.io/bound-by-controller']).toBeUndefined();
    expect(annotations['my-custom/annotation']).toBe('keep-me');
  });

  it('removes empty annotations object', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'test',
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration': '{}',
        },
      },
    };

    const result = sanitizeForGitOps(resource);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.annotations).toBeUndefined();
  });

  it('does not mutate the original resource', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'test', uid: 'abc' },
      status: { phase: 'Active' },
    };

    sanitizeForGitOps(resource);

    expect(resource.status).toEqual({ phase: 'Active' });
    expect(resource.metadata.uid).toBe('abc');
  });
});

describe('useGitOpsSetupStore — new fields', () => {
  beforeEach(() => {
    useGitOpsSetupStore.setState({
      selectedCategories: ['cluster-config', 'operators'],
      selectedNamespaces: [],
      clusterName: '',
      exportProgress: null,
      exportMode: 'pull-request',
    });
  });

  it('has correct defaults for new fields', () => {
    const state = useGitOpsSetupStore.getState();
    expect(state.selectedCategories).toEqual(['cluster-config', 'operators']);
    expect(state.selectedNamespaces).toEqual([]);
    expect(state.clusterName).toBe('');
    expect(state.exportProgress).toBeNull();
    expect(state.exportMode).toBe('pull-request');
  });

  it('setSelectedCategories updates categories', () => {
    useGitOpsSetupStore.getState().setSelectedCategories(['networking', 'rbac']);
    expect(useGitOpsSetupStore.getState().selectedCategories).toEqual(['networking', 'rbac']);
  });

  it('setSelectedNamespaces updates namespaces', () => {
    useGitOpsSetupStore.getState().setSelectedNamespaces(['default', 'kube-system']);
    expect(useGitOpsSetupStore.getState().selectedNamespaces).toEqual(['default', 'kube-system']);
  });

  it('setClusterName updates cluster name', () => {
    useGitOpsSetupStore.getState().setClusterName('prod-east');
    expect(useGitOpsSetupStore.getState().clusterName).toBe('prod-east');
  });

  it('setExportProgress updates progress', () => {
    const progress = { category: 'operators', totalFiles: 10, committedFiles: 3, errors: [] };
    useGitOpsSetupStore.getState().setExportProgress(progress);
    expect(useGitOpsSetupStore.getState().exportProgress).toEqual(progress);

    useGitOpsSetupStore.getState().setExportProgress(null);
    expect(useGitOpsSetupStore.getState().exportProgress).toBeNull();
  });

  it('setExportMode updates mode', () => {
    useGitOpsSetupStore.getState().setExportMode('direct-commit');
    expect(useGitOpsSetupStore.getState().exportMode).toBe('direct-commit');
  });

  it('WizardStep type includes select-resources and export', () => {
    useGitOpsSetupStore.getState().setStep('select-resources');
    expect(useGitOpsSetupStore.getState().currentStep).toBe('select-resources');

    useGitOpsSetupStore.getState().setStep('export');
    expect(useGitOpsSetupStore.getState().currentStep).toBe('export');
  });
});
