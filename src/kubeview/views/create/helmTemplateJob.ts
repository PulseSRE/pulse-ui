/**
 * The preview Job: "helm template" in the runner image, with nothing beyond
 * what rendering needs.
 *
 * - No Role, RoleBinding or ServiceAccount is created or changed. The pod runs
 *   as the namespace's `default` ServiceAccount with
 *   automountServiceAccountToken: false: helm template makes no API calls.
 * - Its inputs are the values Secret (values.yaml plus a one-off salt) and,
 *   for a values-only change, the stored-chart Secret. Both are created after
 *   the Job, owned by it, so they go when the Job goes.
 * - Rendered Secrets never reach the pod log in clear: the Job redacts every
 *   `data`/`stringData` value to "(redacted sha256:<16 hex>)", a hash of the
 *   salt and the value, before printing. The salt lives only in the values
 *   Secret, so the log does not let anyone test guesses; the browser, which
 *   made the salt, hashes the current release's values the same way, so the
 *   diff still shows which keys changed. If redaction cannot run, nothing is
 *   printed and the preview fails.
 * - ttlSecondsAfterFinished is 60, and the UI deletes the Job on every path.
 */
import { assertDigestPinnedImage, CHART_ARCHIVE_KEY, CHART_MOUNT, helmArgs, VALUES_MOUNT, type TemplateChart } from './helmInstall';

/** Line-based redaction of Secret data in a multi-document manifest. Mirrored in TS by redactSecretValues. */
export const REDACT_AWK = String.raw`
function hash(v,   f, cmd, line, n) {
  f = work "/v"
  printf "%s%s", salt, v > f
  close(f)
  cmd = "sha256sum " work "/v"
  n = (cmd | getline line)
  close(cmd)
  if (n <= 0) { failed = 1; exit 3 }
  return substr(line, 1, 16)
}
function indent(s) { match(s, /^ */); return RLENGTH }
function flush(   i, j, sec, kind, ind, keyind, l, key, val, m) {
  kind = 0
  for (i = 1; i <= nl; i++) if (doc[i] ~ /^kind:[ \t]*Secret[ \t]*$/) kind = 1
  if (!kind) { for (i = 1; i <= nl; i++) print doc[i]; nl = 0; return }
  sec = 0
  for (i = 1; i <= nl; i++) {
    l = doc[i]
    if (l ~ /^(data|stringData):[ \t]*$/) { sec = 1; keyind = -1; print l; continue }
    if (l ~ /^(data|stringData):[ \t]*\{[ \t]*\}[ \t]*$/) { print l; continue }
    if (l ~ /^(data|stringData):/) { sub(/:.*/, "", l); print l ": {}  # redacted by Pulse: values not shown"; continue }
    if (sec && l ~ /^[^ ]/) sec = 0
    if (!sec || l ~ /^[ \t]*$/ || l ~ /^[ \t]*#/) { if (!sec || l !~ /^ /) print l; continue }
    ind = indent(l)
    if (keyind < 0) keyind = ind
    if (ind != keyind) continue
    m = index(l, ":")
    if (m == 0) continue
    key = substr(l, 1, m - 1)
    val = substr(l, m + 1)
    sub(/^[ \t]+/, "", val); sub(/[ \t]+$/, "", val)
    for (j = i + 1; j <= nl && (doc[j] ~ /^[ \t]*$/ || indent(doc[j]) > keyind) && doc[j] !~ /^[^ ]/; j++) {
      l = doc[j]; sub(/^[ \t]+/, "", l); sub(/[ \t]+$/, "", l); val = val "\n" l
    }
    i = j - 1
    print key ": \"(redacted sha256:" hash(val) ")\""
  }
  nl = 0
}
/^---[ \t]*$/ { flush(); print; next }
{ doc[++nl] = $0 }
END { if (!failed) flush() }
`;

/** Renders, then prints the manifests only after redaction succeeded. "$@" are helm's arguments. */
export const TEMPLATE_SCRIPT = [
  'set -eu',
  'work="${PULSE_WORK:-/tmp/work}"',
  `salt="$(cat "\${PULSE_SALT_FILE:-${VALUES_MOUNT}/salt}")"`,
  'helm "$@" > "$work/rendered.yaml"',
  "cat > \"$work/redact.awk\" <<'PULSE_AWK'",
  REDACT_AWK.trim(),
  'PULSE_AWK',
  'LC_ALL=C awk -v salt="$salt" -v work="$work" -f "$work/redact.awk" "$work/rendered.yaml" > "$work/redacted.yaml"',
  'cat "$work/redacted.yaml"',
  '',
].join('\n');

export interface TemplateJobNames {
  job: string;
  valuesSecret: string;
  chartSecret?: string;
}

export function templateJobNames(releaseName: string, suffix: string, stored: boolean): TemplateJobNames {
  return {
    job: `helm-template-${releaseName}`.slice(0, 50) + `-${suffix}`,
    valuesSecret: `helm-preview-values-${suffix}`,
    ...(stored ? { chartSecret: `helm-preview-chart-${suffix}` } : {}),
  };
}

export function buildHelmTemplateJob(input: {
  namespace: string;
  runnerImage: string;
  names: TemplateJobNames;
  releaseName: string;
  chart: TemplateChart;
  isUpgrade?: boolean;
  kubeVersion?: string;
  apiVersions?: string[];
}) {
  assertDigestPinnedImage(input.runnerImage);
  const args = helmArgs({
    action: 'template', releaseName: input.releaseName, chart: input.chart, valuesSecretName: input.names.valuesSecret,
    isUpgrade: input.isUpgrade, kubeVersion: input.kubeVersion, apiVersions: input.apiVersions,
  }, input.namespace);
  const labels = { app: 'helm-preview', release: input.releaseName };
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: input.names.job, namespace: input.namespace, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 300,
      ttlSecondsAfterFinished: 60,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'Never',
          // No token: helm template makes no API calls.
          serviceAccountName: 'default',
          automountServiceAccountToken: false,
          securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
          containers: [{
            name: 'helm',
            image: input.runnerImage,
            imagePullPolicy: 'IfNotPresent',
            command: ['/bin/sh', '-c', TEMPLATE_SCRIPT, 'helm-template'],
            args,
            env: [
              { name: 'HELM_CACHE_HOME', value: '/tmp/helm/cache' },
              { name: 'HELM_CONFIG_HOME', value: '/tmp/helm/config' },
              { name: 'HELM_DATA_HOME', value: '/tmp/helm/data' },
            ],
            volumeMounts: [
              { name: 'helm-home', mountPath: '/tmp/helm' },
              { name: 'tmp', mountPath: '/tmp/work' },
              { name: 'values', mountPath: VALUES_MOUNT, readOnly: true },
              ...(input.names.chartSecret ? [{ name: 'chart', mountPath: CHART_MOUNT, readOnly: true }] : []),
            ],
            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, runAsNonRoot: true, capabilities: { drop: ['ALL'] } },
          }],
          volumes: [
            { name: 'helm-home', emptyDir: {} },
            { name: 'tmp', emptyDir: {} },
            { name: 'values', secret: { secretName: input.names.valuesSecret } },
            ...(input.names.chartSecret ? [{ name: 'chart', secret: { secretName: input.names.chartSecret } }] : []),
          ],
        },
      },
    },
  };
}

export function buildPreviewSecret(namespace: string, name: string, job: { name: string; uid: string }, data: { stringData?: Record<string, string>; data?: Record<string, string> }) {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name, namespace, labels: { app: 'helm-preview' },
      ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: job.name, uid: job.uid }],
    },
    type: 'Opaque',
    ...data,
  };
}

export { CHART_ARCHIVE_KEY };
