import { gzipSync } from 'zlib';
export { helmArgs } from '../helmInstall';
import { parseHelmIndex } from '../HelmTab';
export const parseIndexForTest = (text: string) => parseHelmIndex(text, 'repo', 'https://repo');

/** A Helm 3 release Secret: base64(base64(gzip(release JSON))). */
export function releaseSecret(name: string, ns: string, revision: number, status: string, chartVersion: string, values: Record<string, unknown> = {}) {
  const record = { name, namespace: ns, version: revision, info: { status, last_deployed: '2026-10-01T00:00:00Z' }, chart: { metadata: { name: 'nginx', version: chartVersion, appVersion: '1.27' } }, config: values };
  const helmEncoded = gzipSync(Buffer.from(JSON.stringify(record))).toString('base64');
  return {
    metadata: { name: `sh.helm.release.v1.${name}.v${revision}`, namespace: ns, labels: { owner: 'helm', name, version: String(revision), status } },
    data: { release: Buffer.from(helmEncoded).toString('base64') },
  };
}

