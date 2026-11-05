/**
 * Run one Helm action (install, upgrade, rollback, uninstall) as a Job in the
 * release's namespace, using the digest-pinned runner image and the
 * namespace-scoped ServiceAccount/Role the install path already sets up.
 */
import { k8sFetch } from '../../engine/query';
import { getHelmInstallRuntimeConfig } from '../../config/runtime';
import { buildHelmChartSecret, buildHelmInstallResources, buildHelmJob, buildHelmValuesSecret, type HelmAction, type UpgradeOptions } from './helmInstall';
import { bytesToB64 } from '../../engine/helmChartArchive';
import { buildHelmTemplateJob, buildPreviewSecret, CHART_ARCHIVE_KEY, templateJobNames } from './helmTemplateJob';

/** What the caller asks for: a stored-chart upgrade carries the rebuilt archive, the runner makes its Secret. */
export type HelmRequest =
  | Exclude<HelmAction, { action: 'upgrade-stored' } | { action: 'template' }>
  | ({ action: 'upgrade-stored'; releaseName: string; chartArchive: Uint8Array } & UpgradeOptions);

/** A preview render. Runs apart from runHelmAction: no Role, RoleBinding or ServiceAccount (helmTemplateJob.ts). */
export interface TemplateRequest {
  releaseName: string;
  chart: { from: 'repo'; chartName: string; repoUrl: string; version?: string } | { from: 'stored'; chartArchive: Uint8Array };
  isUpgrade?: boolean;
  kubeVersion?: string;
  apiVersions?: string[];
  valuesYaml: string;
  /** Hex salt for the Secret value hashes; only the values Secret and the browser hold it. */
  salt: string;
}

async function failure(res: Response): Promise<Error> {
  const err = await res.json().catch(() => ({ message: res.statusText }));
  return new Error(err.message || `${res.status} ${res.statusText}`);
}

export async function applyResource(clusterId: string, path: string, resource: unknown): Promise<void> {
  const res = await k8sFetch(clusterId, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/apply-patch+yaml' },
    body: JSON.stringify(resource),
  });
  if (!res.ok) throw await failure(res);
}

async function post<T>(clusterId: string, path: string, body: unknown): Promise<T> {
  const res = await k8sFetch(clusterId, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return res.json();
}

/** Returns the name of the Job that runs the action. */
export async function runHelmAction(clusterId: string, namespace: string, request: HelmRequest, valuesYaml?: string): Promise<string> {
  const runtime = getHelmInstallRuntimeConfig();
  // The RBAC objects are shared with install; build them through the same function.
  const rbac = buildHelmInstallResources({
    namespace,
    releaseName: request.releaseName,
    chartName: 'chartName' in request ? request.chartName : request.releaseName,
    repoUrl: 'repoUrl' in request ? request.repoUrl : 'https://unused.invalid',
    runnerImage: runtime.runnerImage,
    serviceAccountName: runtime.serviceAccountName,
  });

  await applyResource(clusterId, `/api/v1/namespaces/${namespace}/serviceaccounts/${rbac.serviceAccount.metadata.name}?fieldManager=openshiftpulse&force=true`, rbac.serviceAccount);
  await applyResource(clusterId, `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/roles/${rbac.role.metadata.name}?fieldManager=openshiftpulse&force=true`, rbac.role);
  await applyResource(clusterId, `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings/${rbac.roleBinding.metadata.name}?fieldManager=openshiftpulse&force=true`, rbac.roleBinding);

  // Secrets created for this Job: tied to it once it exists, removed if it is never created.
  const created: string[] = [];
  const removeCreated = async () => {
    await Promise.all(created.map((name) => k8sFetch(clusterId, `/api/v1/namespaces/${namespace}/secrets/${name}`, { method: 'DELETE' }).catch(() => undefined)));
  };

  let action: HelmAction;
  try {
    const storeChart = async (archive: Uint8Array) => {
      const chart = await post<{ metadata: { name: string } }>(clusterId, `/api/v1/namespaces/${namespace}/secrets`, buildHelmChartSecret(namespace, request.releaseName, bytesToB64(archive)));
      created.push(chart.metadata.name);
      return chart.metadata.name;
    };
    if (request.action === 'upgrade-stored') {
      const { chartArchive, ...rest } = request;
      action = { ...rest, chartSecretName: await storeChart(chartArchive) };
    } else {
      action = request;
    }
    if (valuesYaml !== undefined && valuesYaml.trim() !== '' && (action.action === 'install' || action.action === 'upgrade' || action.action === 'upgrade-stored')) {
      const secret = await post<{ metadata: { name: string } }>(clusterId, `/api/v1/namespaces/${namespace}/secrets`, buildHelmValuesSecret(namespace, request.releaseName, valuesYaml));
      created.push(secret.metadata.name);
      action = { ...action, valuesSecretName: secret.metadata.name };
    }
  } catch (e) {
    await removeCreated();
    throw e;
  }

  let job: { metadata: { name: string; uid?: string } };
  try {
    job = await post<{ metadata: { name: string; uid?: string } }>(clusterId, `/apis/batch/v1/namespaces/${namespace}/jobs`, buildHelmJob({
      namespace,
      runnerImage: runtime.runnerImage,
      serviceAccountName: runtime.serviceAccountName,
      helm: action,
      chartLabel: 'chartName' in action ? action.chartName : undefined,
    }));
  } catch (e) {
    await removeCreated();
    throw e;
  }
  // The Secrets belong to the Job: when the Job is deleted (its TTL removes it
  // an hour after it finishes), the garbage collector deletes them with it.
  if (job.metadata.uid) {
    for (const name of created) {
      const res = await k8sFetch(clusterId, `/api/v1/namespaces/${namespace}/secrets/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ metadata: { ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: job.metadata.name, uid: job.metadata.uid }] } }),
      });
      if (!res.ok) throw new Error(`Job ${job.metadata.name} started, but its Secret ${name} could not be tied to it and will not be cleaned up automatically: ${(await failure(res)).message}`);
    }
  }
  return job.metadata.name;
}

export interface HelmJobOutput {
  /** The Job's pod finished with exit code 0. */
  succeeded: boolean;
  /** The helm container's log: the rendered manifests, or helm's error. */
  log: string;
}

function abortError(): Error {
  return new DOMException('The preview was cancelled', 'AbortError');
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(abortError()); return; }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

function randomSuffix(): string {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join('');
}

export function randomSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface StartedTemplateJob { name: string; uid: string }

/**
 * Start a preview render: the Job first (so its uid can own the inputs), then
 * the values Secret and, for a values-only change, the chart Secret. If an
 * input cannot be created, the Job is deleted before the error is thrown.
 */
export async function runHelmTemplate(clusterId: string, namespace: string, req: TemplateRequest): Promise<StartedTemplateJob> {
  const runtime = getHelmInstallRuntimeConfig();
  const names = templateJobNames(req.releaseName, randomSuffix(), req.chart.from === 'stored');
  const chart = req.chart.from === 'stored' ? { from: 'stored' as const, chartSecretName: names.chartSecret! } : req.chart;
  const job = await post<{ metadata: { name: string; uid: string } }>(clusterId, `/apis/batch/v1/namespaces/${namespace}/jobs`, buildHelmTemplateJob({
    namespace, runnerImage: runtime.runnerImage, names, releaseName: req.releaseName, chart,
    isUpgrade: req.isUpgrade, kubeVersion: req.kubeVersion, apiVersions: req.apiVersions,
  }));
  const owner = { name: job.metadata.name, uid: job.metadata.uid };
  try {
    await post(clusterId, `/api/v1/namespaces/${namespace}/secrets`, buildPreviewSecret(namespace, names.valuesSecret, owner, {
      stringData: { 'values.yaml': req.valuesYaml.trim() ? req.valuesYaml : '{}\n', salt: req.salt },
    }));
    if (req.chart.from === 'stored') {
      await post(clusterId, `/api/v1/namespaces/${namespace}/secrets`, buildPreviewSecret(namespace, names.chartSecret!, owner, {
        data: { [CHART_ARCHIVE_KEY]: bytesToB64(req.chart.chartArchive) },
      }));
    }
  } catch (e) {
    await deleteHelmJob(clusterId, namespace, job.metadata.name);
    throw e;
  }
  return owner;
}

/**
 * Wait for a preview Job's pod to finish and read its log (as the user, who
 * needs "list pods" and "get pods/log"). The pod is found by the Job's uid.
 * Throws when the pod cannot be read, does not finish within the timeout, or
 * the signal aborts; the caller says the preview could not be made, never
 * that it is empty.
 */
export async function readHelmJobOutput(clusterId: string, namespace: string, job: StartedTemplateJob, opts: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {}): Promise<HelmJobOutput> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const pollMs = opts.pollMs ?? 1500;
  for (;;) {
    if (opts.signal?.aborted) throw abortError();
    const res = await k8sFetch(clusterId, `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`controller-uid=${job.uid}`)}`, { signal: opts.signal });
    if (!res.ok) throw new Error(`The preview Job's pod could not be read: ${(await failure(res)).message}`);
    const pods = ((await res.json()).items ?? []) as Array<{ metadata: { name: string }; status?: { phase?: string; containerStatuses?: Array<{ state?: { waiting?: { reason?: string; message?: string } } }> } }>;
    const pod = pods[0];
    const phase = pod?.status?.phase;
    if (pod && (phase === 'Succeeded' || phase === 'Failed')) {
      const logRes = await k8sFetch(clusterId, `/api/v1/namespaces/${namespace}/pods/${pod.metadata.name}/log?container=helm`, { signal: opts.signal });
      if (!logRes.ok) throw new Error(`The preview Job finished, but its log could not be read: ${(await failure(logRes)).message}`);
      return { succeeded: phase === 'Succeeded', log: await logRes.text() };
    }
    const waiting = pod?.status?.containerStatuses?.[0]?.state?.waiting;
    if (waiting?.reason && /ImagePull|ErrImage|CreateContainerConfigError|InvalidImageName/.test(waiting.reason)) {
      throw new Error(`The Helm runner could not start: ${waiting.reason}${waiting.message ? ` (${waiting.message})` : ''}`);
    }
    if (Date.now() > deadline) throw new Error(`The preview Job ${job.name} did not finish within ${Math.round((opts.timeoutMs ?? 120_000) / 1000)}s${phase ? ` (pod ${phase})` : ' (no pod yet)'}`);
    await sleep(pollMs, opts.signal);
  }
}

/** Delete a preview Job and its pod (its Secrets go with it). Best effort: the Job's 60s TTL removes it anyway. */
export async function deleteHelmJob(clusterId: string, namespace: string, jobName: string): Promise<void> {
  await k8sFetch(clusterId, `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}?propagationPolicy=Background`, { method: 'DELETE' }).catch(() => undefined);
}
