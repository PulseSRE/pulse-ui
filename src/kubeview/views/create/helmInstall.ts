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
  | ({ action: 'upgrade'; releaseName: string; chartName: string; repoUrl: string; version?: string; valuesSecretName?: string } & UpgradeOptions)
  /** Values-only upgrade with the chart Helm stored in the release, mounted from a Secret as an archive. */
  | ({ action: 'upgrade-stored'; releaseName: string; chartSecretName: string; valuesSecretName?: string } & UpgradeOptions)
  | { action: 'rollback'; releaseName: string; revision: number }
  | { action: 'uninstall'; releaseName: string }
  /**
   * Render only: "helm template" prints the manifests to the Job's log and
   * touches nothing on the cluster, so it needs no permission beyond what the
   * runner already has. The chart comes from its repository or, for a
   * values-only change, from the stored-chart Secret.
   */
  | { action: 'template'; releaseName: string; chart: TemplateChart; valuesSecretName?: string; isUpgrade?: boolean; kubeVersion?: string; apiVersions?: string[] };

export type TemplateChart =
  | { from: 'repo'; chartName: string; repoUrl: string; version?: string }
  | { from: 'stored'; chartSecretName: string };

export interface UpgradeOptions {
  /**
   * reset (default): the values given replace the release's user values.
   * reuse: the values given are merged over the release's current user values.
   */
  valuesMode?: 'reset' | 'reuse';
  /** --atomic: Helm rolls the release back itself if the upgrade fails. */
  atomic?: boolean;
}

const VALUES_MOUNT = '/tmp/values';
const CHART_MOUNT = '/tmp/chart';
/** Key of the chart archive in the chart Secret. */
export const CHART_ARCHIVE_KEY = 'chart.tgz';

/** `helm` arguments for an action. Values come only from the mounted Secret file. */
export function helmArgs(a: HelmAction, namespace: string): string[] {
  const values = (v?: string) => (v ? ['-f', `${VALUES_MOUNT}/values.yaml`] : []);
  switch (a.action) {
    case 'install':
      return ['install', a.releaseName, a.chartName, '--repo', a.repoUrl, '--namespace', namespace,
        ...(a.version ? ['--version', a.version] : []), ...values(a.valuesSecretName), '--wait', '--timeout', '5m'];
    case 'upgrade':
      // --reset-values: the values given (possibly none) replace the release's
      // values. Without it Helm 3 reuses the previous values when none are given.
      return ['upgrade', a.releaseName, a.chartName, '--repo', a.repoUrl, '--namespace', namespace,
        ...(a.version ? ['--version', a.version] : []), ...upgradeFlags(a), ...values(a.valuesSecretName), '--wait', '--timeout', '5m'];
    case 'upgrade-stored':
      return ['upgrade', a.releaseName, `${CHART_MOUNT}/${CHART_ARCHIVE_KEY}`, '--namespace', namespace,
        ...upgradeFlags(a), ...values(a.valuesSecretName), '--wait', '--timeout', '5m'];
    case 'template':
      return ['template', a.releaseName,
        ...(a.chart.from === 'repo'
          ? [a.chart.chartName, '--repo', a.chart.repoUrl, ...(a.chart.version ? ['--version', a.chart.version] : [])]
          : [`${CHART_MOUNT}/${CHART_ARCHIVE_KEY}`]),
        '--namespace', namespace, ...values(a.valuesSecretName),
        ...(a.isUpgrade ? ['--is-upgrade'] : []),
        ...(a.kubeVersion ? ['--kube-version', a.kubeVersion] : []),
        ...(a.apiVersions ?? []).flatMap((v) => ['--api-versions', v])];
    case 'rollback':
      return ['rollback', a.releaseName, String(a.revision), '--namespace', namespace, '--wait', '--timeout', '5m'];
    case 'uninstall':
      return ['uninstall', a.releaseName, '--namespace', namespace, '--wait', '--timeout', '5m'];
  }
}

function upgradeFlags(a: UpgradeOptions): string[] {
  return [a.valuesMode === 'reuse' ? '--reuse-values' : '--reset-values', ...(a.atomic ? ['--atomic'] : [])];
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

/** The Secret that carries a rebuilt chart archive to the runner. */
export function buildHelmChartSecret(namespace: string, releaseName: string, archiveBase64: string) {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      generateName: `helm-chart-${releaseName}-`.slice(0, 58),
      namespace,
      labels: { app: 'helm-install', release: releaseName },
    },
    type: 'Opaque',
    data: { [CHART_ARCHIVE_KEY]: archiveBase64 },
  };
}

/** A Job running one helm action. Uses generateName so repeated actions never collide. */
export function buildHelmJob(input: { namespace: string; runnerImage: string; serviceAccountName: string; helm: HelmAction; chartLabel?: string }) {
  assertDigestPinnedImage(input.runnerImage);
  const a = input.helm;
  const valuesSecretName = a.action === 'install' || a.action === 'upgrade' || a.action === 'upgrade-stored' || a.action === 'template' ? a.valuesSecretName : undefined;
  const chartSecretName = a.action === 'upgrade-stored' ? a.chartSecretName : a.action === 'template' && a.chart.from === 'stored' ? a.chart.chartSecretName : undefined;
  const labels = { app: 'helm-install', release: a.releaseName, ...(input.chartLabel ? { chart: input.chartLabel } : {}) };
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      generateName: `helm-${a.action === 'upgrade-stored' ? 'upgrade' : a.action}-${a.releaseName}-`.slice(0, 58),
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
              ...(chartSecretName ? [{ name: 'chart', mountPath: CHART_MOUNT, readOnly: true }] : []),
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
            ...(chartSecretName ? [{ name: 'chart', secret: { secretName: chartSecretName } }] : []),
          ],
        },
      },
    },
  };
}

const VERBS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] as const;

/**
 * What the runner's namespace Role lets helm manage. A chart with any other
 * kind (cluster-scoped RBAC, CRDs, custom resources) cannot be upgraded,
 * rolled back or uninstalled by the runner; the UI checks first.
 */
export const HELM_RUNNER_RULES = [
  { apiGroups: [''], resources: ['configmaps', 'endpoints', 'persistentvolumeclaims', 'pods', 'secrets', 'serviceaccounts', 'services'], verbs: VERBS },
  { apiGroups: ['apps'], resources: ['daemonsets', 'deployments', 'replicasets', 'statefulsets'], verbs: VERBS },
  { apiGroups: ['batch'], resources: ['cronjobs', 'jobs'], verbs: VERBS },
  { apiGroups: ['networking.k8s.io'], resources: ['ingresses', 'networkpolicies'], verbs: VERBS },
  { apiGroups: ['route.openshift.io'], resources: ['routes'], verbs: VERBS },
] as const;

const KIND_PLURALS: Record<string, string> = {
  ConfigMap: 'configmaps', Endpoints: 'endpoints', PersistentVolumeClaim: 'persistentvolumeclaims', Pod: 'pods', Secret: 'secrets',
  ServiceAccount: 'serviceaccounts', Service: 'services', DaemonSet: 'daemonsets', Deployment: 'deployments', ReplicaSet: 'replicasets',
  StatefulSet: 'statefulsets', CronJob: 'cronjobs', Job: 'jobs', Ingress: 'ingresses', NetworkPolicy: 'networkpolicies', Route: 'routes',
};

/** Whether the runner Role covers objects of this apiVersion/kind. */
export function runnerCanManage(apiVersion: string, kind: string): boolean {
  const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
  const plural = KIND_PLURALS[kind];
  if (!plural) return false;
  return HELM_RUNNER_RULES.some((r) => (r.apiGroups as readonly string[]).includes(group) && (r.resources as readonly string[]).includes(plural));
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
      rules: HELM_RUNNER_RULES.map((r) => ({ ...r, apiGroups: [...r.apiGroups], resources: [...r.resources], verbs: [...r.verbs] })),
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
