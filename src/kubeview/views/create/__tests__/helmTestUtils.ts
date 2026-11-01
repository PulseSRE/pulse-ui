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

