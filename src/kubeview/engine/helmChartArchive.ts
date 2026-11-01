/**
 * Rebuild a chart archive from the copy Helm keeps in its release record.
 *
 * Helm 3 stores the release's chart (metadata, default values, schema,
 * templates and other files) inside every release Secret. That is enough to
 * run "helm upgrade" with edited values and the same chart version when the
 * chart's repository is not configured in Pulse. Helm does not store
 * subcharts — declared dependencies or charts vendored in charts/ — so a
 * release that rendered any subchart cannot be rebuilt this way: the rebuilt
 * chart would lack them and the upgrade would delete what they rendered.
 */
import { dump } from 'js-yaml';

export interface StoredChartFile {
  name: string;
  /** Base64, as Helm serialises []byte. */
  data: string;
}

export interface StoredChart {
  metadata: Record<string, unknown>;
  values: Record<string, unknown>;
  templates: StoredChartFile[];
  files: StoredChartFile[];
  /** Base64 of values.schema.json, when the chart has one. */
  schema?: string;
  /** Subcharts the release rendered (from its manifest and hooks), which the record does not contain. */
  renderedSubcharts: string[];
}

/**
 * Subcharts a release rendered, by name. Helm marks each rendered document
 * with `# Source: <chart>/charts/<sub>/templates/…` and each hook with its
 * path, whether or not Chart.yaml declares the subchart.
 */
export function renderedSubcharts(rel: Record<string, any> | null): string[] {
  const names = new Set<string>();
  const add = (path: string) => {
    const m = /^[^/\n]+\/charts\/([^/\n]+)\//.exec(path);
    if (m) names.add(m[1]);
  };
  if (typeof rel?.manifest === 'string') {
    for (const m of rel.manifest.matchAll(/^# Source: (.+)$/gm)) add(m[1].trim());
  }
  for (const h of Array.isArray(rel?.hooks) ? rel!.hooks : []) {
    if (typeof h?.path === 'string') add(h.path);
    if (typeof h?.manifest === 'string') for (const m of h.manifest.matchAll(/^# Source: (.+)$/gm)) add(m[1].trim());
  }
  return [...names].sort();
}

/** The chart as stored in a decoded release record, or undefined when it is not there. */
export function storedChartFromRelease(rel: Record<string, any> | null): StoredChart | undefined {
  const chart = rel?.chart;
  if (!chart?.metadata?.name || !chart?.metadata?.version || !Array.isArray(chart.templates)) return undefined;
  const files = (list: unknown): StoredChartFile[] => (Array.isArray(list) ? list : [])
    .filter((f): f is StoredChartFile => typeof f?.name === 'string' && typeof f?.data === 'string');
  return {
    metadata: chart.metadata,
    values: chart.values && typeof chart.values === 'object' ? chart.values : {},
    templates: files(chart.templates),
    files: files(chart.files),
    schema: typeof chart.schema === 'string' && chart.schema ? chart.schema : undefined,
    renderedSubcharts: renderedSubcharts(rel),
  };
}

/** Why this stored chart cannot be rebuilt, or null when it can. */
export function storedChartBlocker(chart: StoredChart | undefined): string | null {
  if (!chart) return 'The release record does not include a readable copy of its chart.';
  const deps = chart.metadata.dependencies;
  if (Array.isArray(deps) && deps.length > 0) {
    const names = deps.map((d: { name?: string }) => d?.name).filter(Boolean).join(', ');
    return `The chart depends on ${names || 'subcharts'}, and Helm does not keep subcharts in the release record, so the chart cannot be rebuilt from it.`;
  }
  if (chart.renderedSubcharts.length > 0) {
    return `The release rendered the subchart${chart.renderedSubcharts.length === 1 ? '' : 's'} ${chart.renderedSubcharts.join(', ')} (vendored in charts/), and Helm does not keep subcharts in the release record: an upgrade with the rebuilt chart would delete everything they rendered.`;
  }
  return null;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

const enc = new TextEncoder();

function writeString(buf: Uint8Array, offset: number, length: number, value: string) {
  const bytes = enc.encode(value);
  if (bytes.length > length) throw new Error(`"${value}" is too long for a tar header field`);
  buf.set(bytes, offset);
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number) {
  writeString(buf, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

/** ustar name/prefix split for paths over 100 bytes. */
function splitName(path: string): { name: string; prefix: string } {
  if (enc.encode(path).length <= 100) return { name: path, prefix: '' };
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100) return { name, prefix };
  }
  throw new Error(`The chart file path "${path}" is too long to archive`);
}

function tarHeader(path: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(512);
  const { name, prefix } = splitName(path);
  writeString(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, mtime);
  h.fill(0x20, 148, 156); // checksum is computed with this field as spaces
  h[156] = 0x30; // '0': regular file
  writeString(h, 257, 6, 'ustar\0');
  writeString(h, 263, 2, '00');
  writeString(h, 345, 155, prefix);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  writeString(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

/** A ustar archive of the given files. */
export function tar(entries: Array<{ path: string; data: Uint8Array }>, mtime = 0): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    parts.push(tarHeader(e.path, e.data.length, mtime), e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024)); // end-of-archive marker
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a chart directory, rooted at `<chart name>/`, as Helm's archive loader expects. */
export function chartEntries(chart: StoredChart): Array<{ path: string; data: Uint8Array }> {
  const root = String(chart.metadata.name);
  const entries: Array<{ path: string; data: Uint8Array }> = [
    { path: `${root}/Chart.yaml`, data: enc.encode(dump(chart.metadata)) },
    { path: `${root}/values.yaml`, data: enc.encode(Object.keys(chart.values).length ? dump(chart.values) : '{}\n') },
  ];
  if (chart.schema) entries.push({ path: `${root}/values.schema.json`, data: b64ToBytes(chart.schema) });
  for (const f of [...chart.templates, ...chart.files]) {
    if (f.name.startsWith('/') || f.name.split('/').includes('..')) throw new Error(`The chart file path "${f.name}" is not relative`);
    entries.push({ path: `${root}/${f.name}`, data: b64ToBytes(f.data) });
  }
  return entries;
}

/** The chart as a .tgz Helm can install from. Throws when it cannot be rebuilt. */
export async function buildChartArchive(chart: StoredChart | undefined): Promise<Uint8Array> {
  const blocker = storedChartBlocker(chart);
  if (blocker) throw new Error(blocker);
  return gzip(tar(chartEntries(chart!)));
}
