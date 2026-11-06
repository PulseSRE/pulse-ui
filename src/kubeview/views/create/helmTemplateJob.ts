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

/**
 * Line-based redaction of Secret data in a multi-document manifest, failing
 * closed. Mirrored exactly in TS by engine/helmManifest.redactSecretValues.
 *
 * Per document:
 * - no content (only blanks and comments): printed as is;
 * - a `kind: Secret` anywhere but a top-level `kind:` line (a List item, a
 *   flow mapping, a nested object): the document is withheld and replaced by
 *   a PulsePreviewWithheld marker;
 * - no top-level `kind:` line: withheld too (its kind cannot be told);
 * - a top-level Secret: every `data`/`stringData` value is replaced by
 *   "(redacted sha256:<16 hex of salt+value>)". A block starts at
 *   `data:`/`stringData:` (optionally followed by a comment) and ends only at
 *   a column-0 line that is not blank or a comment; comments inside it are
 *   dropped. Any other form (`data: {a: b}`, multi-line flow) is printed as
 *   `data: {}` and its lines are dropped.
 */
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
function blank(s) { return s ~ /^[ \t]*$/ }
function comment(s) { return s ~ /^[ \t]*#/ }
function withhold(reason,   i) {
  for (i = 1; i <= nl; i++) if (doc[i] ~ /^# Source: /) print doc[i]
  wn++
  print "# Pulse withheld this document from the preview: " reason "."
  print "apiVersion: v1"
  print "kind: PulsePreviewWithheld"
  print "metadata:"
  print "  name: withheld-" wn
  print "reason: \"" reason "\""
  nl = 0
}
function flush(   i, j, l, content, top, secret, nested, sec, ind, keyind, key, val, m, k, rest) {
  content = 0; top = 0; secret = 0; nested = 0
  for (i = 1; i <= nl; i++) {
    l = doc[i]
    if (blank(l) || comment(l)) continue
    content = 1
    if (l ~ /^kind:[ \t]*["']?[A-Za-z0-9.]+["']?[ \t]*(#.*)?$/) {
      top = 1
      if (l ~ /^kind:[ \t]*["']?Secret["']?[ \t]*(#.*)?$/) { secret = 1; continue }
    }
    if (l ~ /kind["']?[ \t]*:[ \t]*["']?Secret(["' \t,}#]|$)/) nested = 1
  }
  if (!content) { for (i = 1; i <= nl; i++) print doc[i]; nl = 0; return }
  if (nested) { withhold("it contains a Secret inside a list or another object"); return }
  if (!top) { withhold("its kind could not be determined"); return }
  if (!secret) { for (i = 1; i <= nl; i++) print doc[i]; nl = 0; return }
  sec = 0
  for (i = 1; i <= nl; i++) {
    l = doc[i]
    if (sec && l ~ /^[^ \t#]/ && !(sec == 2 && l ~ /^[]}]/)) sec = 0
    if (sec == 2) continue
    if (sec == 1) {
      if (blank(l) || comment(l)) continue
      ind = indent(l)
      if (keyind < 0) keyind = ind
      if (ind != keyind) continue
      m = index(l, ":")
      if (m == 0) continue
      key = substr(l, 1, m - 1)
      val = substr(l, m + 1)
      sub(/^[ \t]+/, "", val); sub(/[ \t]+$/, "", val)
      for (j = i + 1; j <= nl && (blank(doc[j]) || indent(doc[j]) > keyind); j++) {
        l = doc[j]; sub(/^[ \t]+/, "", l); sub(/[ \t]+$/, "", l); val = val "\n" l
      }
      i = j - 1
      print key ": \"(redacted sha256:" hash(val) ")\""
      continue
    }
    if (l ~ /^["']?(data|stringData)["']?[ \t]*:/) {
      m = index(l, ":")
      k = substr(l, 1, m - 1); gsub(/["' \t]/, "", k)
      rest = substr(l, m + 1)
      if (rest ~ /^[ \t]*(#.*)?$/) { sec = 1; keyind = -1; print k ":"; continue }
      if (rest ~ /^[ \t]*\{[ \t]*\}[ \t]*(#.*)?$/) { print k ": {}"; continue }
      sec = 2; print k ": {}  # redacted by Pulse: values not shown"; continue
    }
    print l
  }
  nl = 0
}
/^---/ { flush(); print "---"; r = substr($0, 4); if (r !~ /^[ \t]*(#.*)?$/) doc[++nl] = r; next }
{ doc[++nl] = $0 }
END { if (!failed) flush() }
`;

/** Printed (and exit 42) when the runner image lacks the tools redaction needs; the UI treats it as an infrastructure failure. */
export const RUNNER_TOO_OLD_MARKER = 'PULSE_RUNNER_TOO_OLD';

/** Renders, then prints the manifests only after redaction succeeded. "$@" are helm's arguments. */
export const TEMPLATE_SCRIPT = [
  'set -eu',
  `for t in awk sha256sum cat; do command -v "$t" >/dev/null 2>&1 || { echo "${RUNNER_TOO_OLD_MARKER}: $t is missing from the Helm runner image"; exit 42; }; done`,
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
