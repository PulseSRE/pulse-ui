interface BuildHelmInstallResourcesInput {
  namespace: string;
  releaseName: string;
  chartName: string;
  repoUrl: string;
  runnerImage: string;
  serviceAccountName: string;
  /** Chart version to install; the repo's latest when omitted. */
  version?: string;
  /** Secret (in the same namespace) holding `values.yaml`, mounted and passed with -f. */
  valuesSecretName?: string;
}

/**
 * What a Helm runner Job does. Every release action runs the same digest-pinned
 * `helm` image under the same namespace-scoped ServiceAccount the install
 * path already uses — there is no other backend for Helm.
 */
export type HelmAction =
  | { action: 'install'; releaseName: string; chartName: string; repoUrl: string; version?: string; valuesSecretName?: string }
  | { action: 'upgrade'; releaseName: string; chartName: string; repoUrl: string; version?: string; valuesSecretName?: string }
  | { action: 'rollback'; releaseName: string; revision: number }
  | { action: 'uninstall'; releaseName: string };

const VALUES_MOUNT = '/tmp/values';

/** `helm` arguments for an action. Values come only from the mounted Secret file. */
export function helmArgs(a: HelmAction, namespace: string): string[] {
  const values = (v?: string) => (v ? ['-f', `${VALUES_MOUNT}/values.yaml`] : []);
  switch (a.action) {
    case 'install':
      return ['install', a.releaseName, a.chartName, '--repo', a.repoUrl, '--namespace', namespace,
        ...(a.version ? ['--version', a.version] : []), ...values(a.valuesSecretName), '--wait', '--timeout', '5m'];
    case 'upgrade':
      return ['upgrade', a.releaseName, a.chartName, '--repo', a.repoUrl, '--namespace', namespace,
        ...(a.version ? ['--version', a.version] : []), ...values(a.valuesSecretName), '--wait', '--timeout', '5m'];
    case 'rollback':
      return ['rollback', a.releaseName, String(a.revision), '--namespace', namespace, '--wait', '--timeout', '5m'];
    case 'uninstall':
      return ['uninstall', a.releaseName, '--namespace', namespace, '--wait', '--timeout', '5m'];
  }
}

/** The Secret that carries values.yaml to the runner (never a command-line argument). */
export function buildHelmValuesSecret(namespace: string, releaseName: string, valuesYaml: string) {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      generateName: `helm-values-${releaseName}-`.slice(0, 58),
      namespace,
      labels: { app: 'helm-install', release: releaseName },
    },
    type: 'Opaque',
    stringData: { 'values.yaml': valuesYaml },
  };
}

/** A Job running one helm action. Uses generateName so repeated actions never collide. */
export function buildHelmJob(input: { namespace: string; runnerImage: string; serviceAccountName: string; helm: HelmAction; chartLabel?: string }) {
  assertDigestPinnedImage(input.runnerImage);
  const a = input.helm;
  const valuesSecretName = a.action === 'install' || a.action === 'upgrade' ? a.valuesSecretName : undefined;
  const labels = { app: 'helm-install', release: a.releaseName, ...(input.chartLabel ? { chart: input.chartLabel } : {}) };
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      generateName: `helm-${a.action}-${a.releaseName}-`.slice(0, 58),
      namespace: input.namespace,
      labels,
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'Never',
          serviceAccountName: input.serviceAccountName,
          automountServiceAccountToken: true,
          securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [{
            name: 'helm',
            image: input.runnerImage,
            imagePullPolicy: 'IfNotPresent',
            command: ['helm'],
            args: helmArgs(a, input.namespace),
            env: [
              { name: 'HELM_CACHE_HOME', value: '/tmp/helm/cache' },
              { name: 'HELM_CONFIG_HOME', value: '/tmp/helm/config' },
              { name: 'HELM_DATA_HOME', value: '/tmp/helm/data' },
            ],
            volumeMounts: [
              { name: 'helm-home', mountPath: '/tmp/helm' },
              { name: 'tmp', mountPath: '/tmp/work' },
              ...(valuesSecretName ? [{ name: 'values', mountPath: VALUES_MOUNT, readOnly: true }] : []),
            ],
            securityContext: {
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              runAsNonRoot: true,
              capabilities: { drop: ['ALL'] },
            },
          }],
          volumes: [
            { name: 'helm-home', emptyDir: {} },
            { name: 'tmp', emptyDir: {} },
            ...(valuesSecretName ? [{ name: 'values', secret: { secretName: valuesSecretName } }] : []),
          ],
        },
      },
    },
  };
}

export const HELM_RUNNER_IMAGE_DIGEST_PATTERN = /^[^\s@]+@sha256:[a-f0-9]{64}$/i;

function assertDigestPinnedImage(image: string): void {
  if (!HELM_RUNNER_IMAGE_DIGEST_PATTERN.test(image)) {
    throw new Error('Helm runner image must be digest-pinned');
  }
}

export function buildHelmInstallResources(input: BuildHelmInstallResourcesInput) {
  assertDigestPinnedImage(input.runnerImage);

  const labels = { app: 'helm-install', chart: input.chartName };
  const roleName = input.serviceAccountName;

  return {
    serviceAccount: {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: {
        name: input.serviceAccountName,
        namespace: input.namespace,
        labels,
      },
    },
    role: {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: {
        name: roleName,
        namespace: input.namespace,
        labels,
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['configmaps', 'endpoints', 'persistentvolumeclaims', 'pods', 'secrets', 'serviceaccounts', 'services'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
        {
          apiGroups: ['apps'],
          resources: ['daemonsets', 'deployments', 'replicasets', 'statefulsets'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
        {
          apiGroups: ['batch'],
          resources: ['cronjobs', 'jobs'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
        {
          apiGroups: ['networking.k8s.io'],
          resources: ['ingresses', 'networkpolicies'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
        {
          apiGroups: ['route.openshift.io'],
          resources: ['routes'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
        },
      ],
    },
    roleBinding: {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: {
        name: roleName,
        namespace: input.namespace,
        labels,
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'Role',
        name: roleName,
      },
      subjects: [
        { kind: 'ServiceAccount', name: input.serviceAccountName, namespace: input.namespace },
      ],
    },
    job: {
      ...buildHelmJob({
        namespace: input.namespace,
        runnerImage: input.runnerImage,
        serviceAccountName: input.serviceAccountName,
        chartLabel: input.chartName,
        helm: { action: 'install', releaseName: input.releaseName, chartName: input.chartName, repoUrl: input.repoUrl, version: input.version, valuesSecretName: input.valuesSecretName },
      }),
    },
  };
}
