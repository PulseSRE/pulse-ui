interface BuildHelmInstallResourcesInput {
  namespace: string;
  releaseName: string;
  chartName: string;
  repoUrl: string;
  runnerImage: string;
  serviceAccountName: string;
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
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: `helm-install-${input.releaseName}`,
        namespace: input.namespace,
        labels,
      },
      spec: {
        backoffLimit: 0,
        template: {
          spec: {
            restartPolicy: 'Never',
            serviceAccountName: input.serviceAccountName,
            automountServiceAccountToken: true,
            securityContext: {
              runAsNonRoot: true,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [{
              name: 'helm',
              image: input.runnerImage,
              imagePullPolicy: 'IfNotPresent',
              command: ['helm'],
              args: ['install', input.releaseName, input.chartName, '--repo', input.repoUrl, '--namespace', input.namespace, '--wait', '--timeout', '5m'],
              env: [
                { name: 'HELM_CACHE_HOME', value: '/tmp/helm/cache' },
                { name: 'HELM_CONFIG_HOME', value: '/tmp/helm/config' },
                { name: 'HELM_DATA_HOME', value: '/tmp/helm/data' },
              ],
              volumeMounts: [
                { name: 'helm-home', mountPath: '/tmp/helm' },
                { name: 'tmp', mountPath: '/tmp/work' },
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
            ],
          },
        },
      },
    },
  };
}
