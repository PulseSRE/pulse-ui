/**
 * Run one Helm action (install, upgrade, rollback, uninstall) as a Job in the
 * release's namespace, using the digest-pinned runner image and the
 * namespace-scoped ServiceAccount/Role the install path already sets up.
 */
import { k8sFetch } from '../../engine/query';
import { getHelmInstallRuntimeConfig } from '../../config/runtime';
import { buildHelmChartSecret, buildHelmInstallResources, buildHelmJob, buildHelmValuesSecret, type HelmAction } from './helmInstall';
import { bytesToB64 } from '../../engine/helmChartArchive';

/** What the caller asks for: a stored-chart upgrade carries the rebuilt archive, the runner makes its Secret. */
export type HelmRequest =
  | Exclude<HelmAction, { action: 'upgrade-stored' }>
  | { action: 'upgrade-stored'; releaseName: string; chartArchive: Uint8Array };

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
    if (request.action === 'upgrade-stored') {
      const chart = await post<{ metadata: { name: string } }>(clusterId, `/api/v1/namespaces/${namespace}/secrets`, buildHelmChartSecret(namespace, request.releaseName, bytesToB64(request.chartArchive)));
      created.push(chart.metadata.name);
      action = { action: 'upgrade-stored', releaseName: request.releaseName, chartSecretName: chart.metadata.name };
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
