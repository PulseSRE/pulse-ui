import { gzipSync } from 'zlib';
export { helmArgs } from '../helmInstall';
import { parseHelmIndex } from '../HelmTab';
export const parseIndexForTest = (text: string) => parseHelmIndex(text, 'repo', 'https://repo');

/** A Helm 3 release Secret: base64(base64(gzip(release JSON))). */
export const PLAIN_MANIFEST = `---
# Source: nginx/templates/svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: shop
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
`;

export const SVC_TEMPLATE = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n';
const b64 = (s: string) => Buffer.from(s).toString('base64');

export function releaseSecret(name: string, ns: string, revision: number, status: string, chartVersion: string, values: Record<string, unknown> = {}, manifest = PLAIN_MANIFEST, chartMeta: Record<string, unknown> = {}) {
  const chart = {
    metadata: { apiVersion: 'v2', name: 'nginx', version: chartVersion, appVersion: '1.27', ...chartMeta },
    values: { replicaCount: 1 },
    templates: [{ name: 'templates/svc.yaml', data: b64(SVC_TEMPLATE) }],
    files: [{ name: 'README.md', data: b64('# nginx\n') }],
    schema: null,
    lock: null,
  };
  const record = { name, namespace: ns, version: revision, info: { status, last_deployed: '2026-10-01T00:00:00Z' }, chart, config: values, manifest };
  const helmEncoded = gzipSync(Buffer.from(JSON.stringify(record))).toString('base64');
  return {
    metadata: { name: `sh.helm.release.v1.${name}.v${revision}`, namespace: ns, labels: { owner: 'helm', name, version: String(revision), status } },
    data: { release: Buffer.from(helmEncoded).toString('base64') },
  };
}


import type { Handler, Recorded } from '../../../__tests__/actionHarness';

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface PreviewSim {
  /** What `helm template` prints (the Job's log). */
  log: string;
  /** Pod phase the Job ends in. */
  phase?: 'Succeeded' | 'Failed';
  /** Answer for a dry-run request; default: admitted. */
  dryRun?: (r: Recorded) => Response | undefined;
  /** Release records by Secret name, for diffs. */
  records?: Record<string, unknown>;
  /** Existing objects by API path, for ownership lookups after a 409. */
  existing?: Record<string, unknown>;
}

/**
 * The cluster side of a preview: the template Job's pod finishes, its log is
 * the render, /version and /apis answer, and dry runs are admitted unless the
 * sim says otherwise.
 */
export function previewHandler(base: Handler, sim: PreviewSim): Handler {
  return (r) => {
    if (r.method === 'GET' && r.path === '/version') return jsonRes({ gitVersion: 'v1.31.4+abc' });
    if (r.method === 'GET' && r.path === '/apis') return jsonRes({ groups: [{ versions: [{ groupVersion: 'apps/v1' }] }] });
    if (r.method === 'GET' && /\/pods\?labelSelector=job-name%3D/.test(r.path)) return jsonRes({ items: [{ metadata: { name: 'helm-pod-1' }, status: { phase: sim.phase ?? 'Succeeded' } }] });
    if (r.method === 'GET' && r.path.includes('/pods/helm-pod-1/log')) return new Response(sim.log, { status: 200 });
    if (r.method === 'DELETE' && r.path.includes('/jobs/')) return jsonRes({});
    if (r.method === 'POST' && /\/apis\/batch\/v1\/namespaces\/[^/]+\/jobs$/.test(r.path)) {
      const args = r.body.spec.template.spec.containers[0].args;
      return jsonRes({ metadata: { name: `helm-${args[0]}-${args[1]}-abc12`, uid: 'job-uid-1' } });
    }
    if (r.method === 'POST' && /\/secrets$/.test(r.path)) return jsonRes({ metadata: { name: `${r.body.metadata.generateName}x1` } });
    if (r.path.includes('dryRun=All')) return sim.dryRun?.(r) ?? jsonRes(r.body ?? {});
    const rec = /\/secrets\/(sh\.helm\.release\.[^/?]+)$/.exec(r.path);
    if (r.method === 'GET' && rec && sim.records?.[rec[1]]) return jsonRes(sim.records[rec[1]]);
    if (r.method === 'GET' && sim.existing?.[r.path]) return jsonRes(sim.existing[r.path]);
    return base(r);
  };
}

/** Runner Job bodies created so far, by helm sub-command. */
export function jobsBy(writes: Recorded[], cmd: string) {
  return writes.filter((w) => w.method === 'POST' && /\/apis\/batch\/v1\/namespaces\/[^/]+\/jobs$/.test(w.path) && w.body?.spec?.template?.spec?.containers?.[0]?.args?.[0] === cmd);
}
