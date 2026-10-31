/**
 * Helm 3 release records.
 *
 * Helm stores each revision of a release as a Secret labelled
 * owner=helm,name=<release>,version=<revision>,status=<status>. Its
 * `data.release` is base64 (the Secret encoding) of base64 of a gzipped JSON
 * document holding the chart metadata, the user-supplied values (`config`)
 * and the rendered manifest.
 */
import type { Secret } from './types';

export interface HelmRevision {
  name: string;
  namespace: string;
  revision: number;
  status: string;
  /** Chart name/version and app version, when the record could be decoded. */
  chart?: string;
  chartVersion?: string;
  appVersion?: string;
  /** User-supplied values for this revision. */
  values?: Record<string, unknown>;
  updated?: string;
  description?: string;
  secretName: string;
}

export interface HelmReleaseSummary extends HelmRevision {
  revisions: HelmRevision[];
}

function bytesFromBinaryString(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const body = new Response(bytes as BodyInit).body;
  if (!body) throw new Error('empty release record');
  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Decode a release Secret's `data.release`. Returns null when it cannot be read. */
export async function decodeHelmRelease(encoded: string | undefined): Promise<Record<string, any> | null> {
  if (!encoded) return null;
  try {
    const inner = atob(encoded); // Secret data encoding
    const raw = bytesFromBinaryString(atob(inner)); // Helm's own base64
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw) : new TextDecoder().decode(raw);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function revisionFromSecret(s: Secret): Promise<HelmRevision> {
  const labels = s.metadata.labels || {};
  const base: HelmRevision = {
    name: labels['name'] || s.metadata.name,
    namespace: s.metadata.namespace || '',
    revision: Number(labels['version'] || '1'),
    status: labels['status'] || 'unknown',
    secretName: s.metadata.name,
  };
  const rel = await decodeHelmRelease((s.data as Record<string, string> | undefined)?.release);
  if (!rel) return base;
  return {
    ...base,
    chart: rel.chart?.metadata?.name,
    chartVersion: rel.chart?.metadata?.version,
    appVersion: rel.chart?.metadata?.appVersion,
    values: rel.config ?? {},
    updated: rel.info?.last_deployed,
    description: rel.info?.description,
    status: rel.info?.status || base.status,
  };
}

/** One summary per release (namespace + name): its highest revision, with every revision attached. */
export async function summarizeHelmReleases(secrets: Secret[]): Promise<HelmReleaseSummary[]> {
  const revisions = await Promise.all(secrets.map(revisionFromSecret));
  const byRelease = new Map<string, HelmRevision[]>();
  for (const r of revisions) {
    const key = `${r.namespace}/${r.name}`;
    if (!byRelease.has(key)) byRelease.set(key, []);
    byRelease.get(key)!.push(r);
  }
  return [...byRelease.values()].map((revs) => {
    revs.sort((a, b) => b.revision - a.revision);
    return { ...revs[0], revisions: revs };
  }).sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}
