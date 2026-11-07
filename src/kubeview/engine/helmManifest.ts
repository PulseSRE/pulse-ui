/**
 * Rendered Helm manifests: parse `helm template` output and a release
 * record's manifest into objects, tell hooks apart, diff one set against
 * another object by object, and read a chart archive's values.yaml and
 * values.schema.json. Pure functions; the runner Job and the dry run live in
 * views/create/helmPreview.ts.
 */
import { dump, load, loadAll } from 'js-yaml';
import { resolveKind } from './kindRegistry';

/** A parsed Kubernetes object or JSON Schema node: arbitrary JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface HookInfo {
  /** helm.sh/hook events, e.g. pre-install, post-upgrade, test. */
  events: string[];
  weight: number;
  deletePolicies: string[];
}

export interface RenderedObject {
  /** group/Kind/namespace/name: stable across API versions of the same kind. */
  key: string;
  apiVersion: string;
  kind: string;
  name: string;
  /** '' for cluster-scoped kinds. */
  namespace: string;
  doc: Record<string, Json>;
  /** Template path from the `# Source:` comment, when present. */
  source?: string;
  hook?: HookInfo;
}

function groupOf(apiVersion: string): string {
  return apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
}

export function objectKey(apiVersion: string, kind: string, namespace: string, name: string): string {
  return `${groupOf(apiVersion)}/${kind}/${namespace}/${name}`;
}

function hookOf(doc: Record<string, Json>): HookInfo | undefined {
  const ann = doc?.metadata?.annotations ?? {};
  const raw = ann['helm.sh/hook'];
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const list = (v: unknown) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const weight = Number(ann['helm.sh/hook-weight'] ?? 0);
  return { events: list(raw), weight: Number.isFinite(weight) ? weight : 0, deletePolicies: list(ann['helm.sh/hook-delete-policy']) };
}

function toObject(doc: unknown, releaseNamespace: string, source?: string): RenderedObject | null {
  const d = doc as Record<string, Json> | null;
  if (!d || typeof d !== 'object' || typeof d.kind !== 'string') return null;
  const apiVersion = String(d.apiVersion ?? '');
  const kind = d.kind;
  const name = String(d.metadata?.name ?? '');
  // Helm installs namespaced objects without a namespace into the release's.
  const namespaced = resolveKind(kind, apiVersion).namespaced;
  const namespace = d.metadata?.namespace ? String(d.metadata.namespace) : namespaced === false ? '' : releaseNamespace;
  return { key: objectKey(apiVersion, kind, namespace, name), apiVersion, kind, name, namespace, doc: d, source, hook: hookOf(d) };
}

export interface ParsedRender {
  objects: RenderedObject[];
  /** Lines before the first document that are not YAML (helm warnings). */
  warnings: string[];
}

/**
 * Parse multi-document YAML as helm prints it. Throws when a document cannot
 * be parsed, so a garbled render is an error and not an empty preview.
 */
export function parseRendered(text: string, releaseNamespace: string): ParsedRender {
  const warnings: string[] = [];
  const chunks = text.split(/^---[ \t]*$/m);
  const objects: RenderedObject[] = [];
  chunks.forEach((chunk, i) => {
    if (!chunk.trim()) return;
    const source = /^# Source: (.+)$/m.exec(chunk)?.[1]?.trim();
    let docs: unknown[];
    try {
      docs = [];
      loadAll(chunk, (d) => docs.push(d));
    } catch (e) {
      // Helm writes warnings to stderr, which the log interleaves before the first document.
      if (i === 0 && !source) {
        warnings.push(...chunk.split('\n').map((l) => l.trim()).filter(Boolean));
        return;
      }
      throw new Error(`The rendered manifest${source ? ` from ${source}` : ''} could not be parsed: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const d of docs) {
      if (d === null || d === undefined) continue;
      // Text before the first document ("WARNING: …") parses as a scalar or a kind-less mapping.
      if (i === 0 && !source && (typeof d !== 'object' || !(d as Record<string, unknown>).kind)) {
        warnings.push(...chunk.split('\n').map((l) => l.trim()).filter(Boolean));
        continue;
      }
      const o = toObject(d, releaseNamespace, source);
      if (o) objects.push(o);
    }
  });
  return { objects, warnings };
}

/** A release record's hooks (Helm stores them apart from the manifest). */
export function recordHooks(hooks: unknown, releaseNamespace: string): RenderedObject[] {
  if (!Array.isArray(hooks)) return [];
  return hooks.flatMap((h) => (typeof h?.manifest === 'string' ? parseRendered(h.manifest, releaseNamespace).objects : []));
}

export type ChangeKind = 'added' | 'changed' | 'removed' | 'unchanged';

export interface ObjectChange {
  change: ChangeKind;
  key: string;
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
  /** Canonical YAML of the current object (changed/removed/unchanged). */
  before?: string;
  /** Canonical YAML of the new object (added/changed/unchanged). */
  after?: string;
  /** The object as it will be sent (added/changed/unchanged). */
  doc?: Record<string, Json>;
  /** Removed, but the chart marks it helm.sh/resource-policy: keep. */
  keep?: boolean;
}

export function canonicalYaml(doc: Record<string, Json>): string {
  return dump(doc, { sortKeys: true, lineWidth: -1, noRefs: true });
}

/**
 * Object-by-object diff of the release's current manifest against the new
 * render. Hooks are not part of either side (Helm creates and deletes them
 * around the action). Order: the new render's, then removals.
 */
export function diffObjects(current: RenderedObject[], next: RenderedObject[]): ObjectChange[] {
  const cur = new Map(current.filter((o) => !o.hook).map((o) => [o.key, o]));
  const out: ObjectChange[] = [];
  const seen = new Set<string>();
  for (const n of next) {
    if (n.hook || seen.has(n.key)) continue;
    seen.add(n.key);
    const after = canonicalYaml(n.doc);
    const c = cur.get(n.key);
    const base = { key: n.key, apiVersion: n.apiVersion, kind: n.kind, name: n.name, namespace: n.namespace, after, doc: n.doc };
    if (!c) out.push({ change: 'added', ...base });
    else {
      const before = canonicalYaml(c.doc);
      out.push({ change: before === after ? 'unchanged' : 'changed', ...base, before });
    }
  }
  for (const c of cur.values()) {
    if (!seen.has(c.key)) {
      const keep = c.doc?.metadata?.annotations?.['helm.sh/resource-policy'] === 'keep';
      out.push({ change: 'removed', key: c.key, apiVersion: c.apiVersion, kind: c.kind, name: c.name, namespace: c.namespace, before: canonicalYaml(c.doc), ...(keep ? { keep } : {}) });
    }
  }
  return out;
}

/** Hooks of the render that run for this action (test hooks run only on `helm test`). */
export function hooksFor(objects: RenderedObject[], action: 'install' | 'upgrade' | 'rollback'): RenderedObject[] {
  return objects
    .filter((o) => o.hook && o.hook.events.some((e) => e === `pre-${action}` || e === `post-${action}`))
    .sort((a, b) => (a.hook!.weight - b.hook!.weight) || a.name.localeCompare(b.name));
}

export function testHooks(objects: RenderedObject[]): RenderedObject[] {
  return objects.filter((o) => o.hook?.events.includes('test') || o.hook?.events.includes('test-success'));
}

export interface DiffLine { type: 'add' | 'del' | 'same'; text: string }

/** Line diff (LCS). Very large inputs fall back to "all removed, all added". */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a[a.length - 1] === '') a.pop();
  if (b[b.length - 1] === '') b.pop();
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ type: 'del' as const, text })), ...b.map((text) => ({ type: 'add' as const, text }))];
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    // Removed lines before added ones, as diffs are read.
    else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  return out;
}

/** Changed lines with `context` unchanged lines around them; gaps become one `…` line. */
export function diffHunks(lines: DiffLine[], context = 3): Array<DiffLine | { type: 'gap'; skipped: number }> {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Array<DiffLine | { type: 'gap'; skipped: number }> = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ type: 'gap', skipped }); skipped = 0; }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ type: 'gap', skipped });
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Helm's --reuse-values: the new values merged over the release's current
 * user values (maps merge, everything else is replaced; null is kept so helm deletes the key).
 */
export function mergeValues(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    // null stays: helm deletes that key from the chart's defaults when it renders.
    if (v === null) out[k] = null;
    else if (isPlainObject(v) && isPlainObject(out[k])) out[k] = mergeValues(out[k] as Record<string, unknown>, v);
    else out[k] = v;
  }
  return out;
}

/** Parse override YAML into a mapping. Throws with a readable message. */
export function parseValues(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const v = load(text);
  if (v === null || v === undefined) return {};
  if (!isPlainObject(v)) throw new Error('Values must be a YAML mapping');
  return v;
}

/** Dotted paths of every leaf in a values mapping (arrays count as leaves). */
export function leafPaths(values: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(values).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return isPlainObject(v) && Object.keys(v).length > 0 ? leafPaths(v, p) : [p];
  });
}

/**
 * For each line of a values.yaml, the dotted key path it sets (from
 * indentation), or undefined for comments, list items and blank lines. Used
 * to mark the default lines an override replaces.
 */
export function yamlLinePaths(text: string): Array<string | undefined> {
  const stack: Array<{ indent: number; key: string }> = [];
  return text.split('\n').map((line) => {
    const m = /^( *)([A-Za-z0-9_.\-"']+):(\s|$)/.exec(line);
    if (!m) return undefined;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key: m[2].replace(/^["']|["']$/g, '') });
    return stack.map((s) => s.key).join('.');
  });
}

export interface SchemaHint {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

type Schema = Record<string, Json>;

function typeOfValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(expected: unknown, v: unknown): boolean {
  const list = Array.isArray(expected) ? expected : [expected];
  const t = typeOfValue(v);
  return list.some((e) => e === t || (e === 'number' && t === 'integer'));
}

/**
 * The checks of values.schema.json that cover what people get wrong most:
 * unknown keys where the schema forbids extra properties, wrong types and
 * values outside an enum. Not a full JSON Schema validator; helm itself
 * validates the full schema when it renders, and the preview reports that.
 */
export function schemaHints(schema: Schema | undefined, values: Record<string, unknown>): SchemaHint[] {
  if (!schema) return [];
  const hints: SchemaHint[] = [];
  const walk = (s: Schema | undefined, v: unknown, path: string) => {
    if (!s || typeof s !== 'object') return;
    if (s.type !== undefined && !typeMatches(s.type, v)) {
      hints.push({ level: 'error', path, message: `must be ${Array.isArray(s.type) ? s.type.join(' or ') : s.type}, not ${typeOfValue(v)}` });
      return;
    }
    if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(v))) {
      hints.push({ level: 'error', path, message: `must be one of ${s.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}` });
    }
    if (isPlainObject(v)) {
      const props: Record<string, Schema> = isPlainObject(s.properties) ? s.properties as Record<string, Schema> : {};
      for (const [k, child] of Object.entries(v)) {
        const p = path ? `${path}.${k}` : k;
        if (props[k]) walk(props[k], child, p);
        else if (s.additionalProperties === false) hints.push({ level: 'error', path: p, message: 'is not a value this chart accepts' });
        else if (isPlainObject(s.additionalProperties)) walk(s.additionalProperties as Schema, child, p);
      }
    }
  };
  walk(schema, values, '');
  return hints;
}

// --- chart archives ---------------------------------------------------------

/** Largest chart archive Pulse downloads, and the most it decompresses. */
export const MAX_CHART_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_CHART_UNPACKED_BYTES = 50 * 1024 * 1024;

/** Read a stream, failing as soon as it passes `max` bytes. */
async function readStreamCapped(stream: ReadableStream<Uint8Array>, max: number, what: string): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${what} is larger than ${Math.round(max / 1024 / 1024)} MB`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A response body, at most `max` bytes. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new Error(`The chart archive is larger than ${Math.round(max / 1024 / 1024)} MB`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  return readStreamCapped(res.body, max, 'The chart archive');
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('gzip'));
  return readStreamCapped(stream, MAX_CHART_UNPACKED_BYTES, 'The unpacked chart');
}

/** Files of a (ustar, GNU or PAX) tar archive by path. */
export function untar(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  const field = (o: number, n: number) => dec.decode(buf.subarray(o, o + n)).replace(/\0.*$/s, '');
  let o = 0;
  let nextName: string | undefined;
  while (o + 512 <= buf.length && buf[o] !== 0) {
    const size = parseInt(field(o + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(buf[o + 156] || 0x30);
    const prefix = field(o + 345, 155);
    const name = (prefix ? `${prefix}/` : '') + field(o, 100);
    const data = buf.subarray(o + 512, o + 512 + size);
    if (type === 'L') nextName = dec.decode(data).replace(/\0.*$/s, '');
    else if (type === 'x') {
      const m = /\d+ path=([^\n]+)\n/.exec(dec.decode(data));
      if (m) nextName = m[1];
    } else if (type === '0' || type === '\0') {
      out.set(nextName ?? name, data);
      nextName = undefined;
    } else nextName = undefined;
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export interface ChartDefaults {
  /** values.yaml as the chart ships it (comments kept). */
  valuesYaml: string;
  /** values.schema.json parsed, when the chart has one. */
  schema?: Schema;
}

/** The top-level chart's values.yaml and values.schema.json from a .tgz. */
export async function readChartArchive(bytes: Uint8Array): Promise<ChartDefaults> {
  const files = untar(await gunzipBytes(bytes));
  const top = (file: string) => [...files.entries()].find(([p]) => /^[^/]+\//.test(p) && p.split('/').length === 2 && p.endsWith(`/${file}`))?.[1];
  const values = top('values.yaml');
  const schema = top('values.schema.json');
  if (!values && !files.size) throw new Error('The chart archive is empty or not a tar archive');
  const dec = new TextDecoder();
  let parsedSchema: Schema | undefined;
  if (schema) {
    try { parsedSchema = JSON.parse(dec.decode(schema)); } catch { parsedSchema = undefined; }
  }
  return { valuesYaml: values ? dec.decode(values) : '', schema: parsedSchema };
}

// --- Secret redaction ---------------------------------------------------------

async function saltedHash(salt: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const indentOf = (s: string) => /^ */.exec(s)![0].length;
const isBlank = (s: string) => /^[ \t]*$/.test(s);
const isComment = (s: string) => /^[ \t]*#/.test(s);
const TOP_KIND = /^kind:[ \t]*["']?[A-Za-z0-9.]+["']?[ \t]*(#.*)?$/;
const TOP_SECRET = /^kind:[ \t]*["']?Secret["']?[ \t]*(#.*)?$/;
const ANY_SECRET = /kind["']?[ \t]*:[ \t]*["']?Secret(["' \t,}#]|$)/;
/** A YAML anchor or alias at the start of a token. */
const ANCHOR = /(^|[ \t[{,])[&*][^\] \t[{},]/;
/** A nested `kind:` whose value is a plain identifier. */
const PLAIN_KIND = /^[ \t-]*kind:[ \t]*["']?[A-Za-z0-9.]+["']?[ \t]*(#.*)?$/;
const SPANS = 'a flow collection in it spans lines';
/** A value that opens a flow mapping or sequence and does not close it on the same line(s). */
const unclosed = (v: string) => /^[ \t]*[[{]/.test(v) && (v.match(/[[{]/g) ?? []).length > (v.match(/[\]}]/g) ?? []).length;
/** The only top-level keys a Secret may have to be shown (literal, unquoted). */
const SECRET_TOP_KEYS = /^(apiVersion|kind|metadata|type|immutable|data|stringData)[ \t]*:/;

/** Kind of the marker document that replaces a withheld one. */
export const WITHHELD_KIND = 'PulsePreviewWithheld';

/**
 * Replace every Secret `data`/`stringData` value in a multi-document manifest
 * with "(redacted sha256:<16 hex of salt+value>)", failing closed: a Secret
 * that is not a plain top-level document, or a document whose kind cannot be
 * told, is withheld and replaced by a PulsePreviewWithheld marker. The same
 * rules, line for line, as the preview Job's awk program
 * (helmTemplateJob.REDACT_AWK), so both produce the same text.
 */
export async function redactSecretValues(text: string, salt: string): Promise<string> {
  const lines = text.split('\n');
  const trailing = lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  const out: string[] = [];
  let doc: string[] = [];
  let withheldCount = 0;
  const withhold = (reason: string) => {
    for (const l of doc) if (/^# Source: /.test(l)) out.push(l);
    withheldCount++;
    out.push(`# Pulse withheld this document from the preview: ${reason}.`, 'apiVersion: v1', `kind: ${WITHHELD_KIND}`, 'metadata:', `  name: withheld-${withheldCount}`, `reason: "${reason}"`);
    doc = [];
  };
  const flush = async () => {
    let content = false;
    let top = false;
    let secret = false;
    let nested = false;
    let oddKind = false;
    for (const l of doc) {
      if (isBlank(l) || isComment(l)) continue;
      content = true;
      if (TOP_KIND.test(l)) {
        top = true;
        if (TOP_SECRET.test(l)) { secret = true; continue; }
      }
      if (ANY_SECRET.test(l)) nested = true;
      // A nested kind that is tagged, folded, quoted oddly or in a flow mapping may hide a Secret.
      if (!/^kind[ \t]*:/.test(l) && /^[ \t-]*["']?kind["']?[ \t]*:/.test(l) && !PLAIN_KIND.test(l)) oddKind = true;
      if (/[{,][ \t]*["']?kind["']?[ \t]*:/.test(l)) oddKind = true;
    }
    if (!content) { out.push(...doc); doc = []; return; }
    if (nested) { withhold('it contains a Secret inside a list or another object'); return; }
    if (oddKind) { withhold('it has a nested kind Pulse cannot read'); return; }
    if (!top) { withhold('its kind could not be determined'); return; }
    if (!secret) { out.push(...doc); doc = []; return; }
    // A Secret is printed only through an allow-list; anything else withholds it.
    for (const l of doc) {
      if (isComment(l)) continue;
      if (ANCHOR.test(l) || /<<[ \t]*:/.test(l)) { withhold('it uses YAML anchors, aliases or merge keys'); return; }
    }
    let sec = 0;
    let keyind = -1;
    let cur = '';
    let bad = '';
    const ob: string[] = [];
    for (let i = 0; i < doc.length; i++) {
      let l = doc[i];
      if (isComment(l)) { if (/^# Source: /.test(l)) ob.push(l); continue; }
      if (sec && /^[^ \t]/.test(l) && !(sec === 2 && /^[\]}]/.test(l))) sec = 0;
      if (sec === 2) continue;
      if (isBlank(l)) { if (!sec) ob.push(l); continue; }
      if (sec === 1) {
        const ind = indentOf(l);
        if (keyind < 0) keyind = ind;
        if (ind !== keyind) continue;
        const m = l.indexOf(':');
        if (m < 0) continue;
        const key = l.slice(0, m);
        let val = l.slice(m + 1).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        let j = i + 1;
        for (; j < doc.length && (isBlank(doc[j]) || indentOf(doc[j]) > keyind); j++) {
          l = doc[j].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
          val = `${val}\n${l}`;
        }
        i = j - 1;
        if (unclosed(val)) { bad = SPANS; break; }
        ob.push(`${key}: "(redacted sha256:${await saltedHash(salt, val)})"`);
        continue;
      }
      if (/^[^ \t]/.test(l)) {
        if (!SECRET_TOP_KEYS.test(l)) { bad = 'it has a top-level key Pulse does not show'; break; }
        const m = l.indexOf(':');
        cur = l.slice(0, m).replace(/[ \t]+$/, '');
        const rest = l.slice(m + 1);
        if (cur === 'data' || cur === 'stringData') {
          if (/^[ \t]*(#.*)?$/.test(rest)) { sec = 1; keyind = -1; ob.push(`${cur}:`); continue; }
          if (/^[ \t]*\{[ \t]*\}[ \t]*(#.*)?$/.test(rest)) { ob.push(`${cur}: {}`); continue; }
          if (unclosed(rest)) { bad = SPANS; break; }
          sec = 2;
          ob.push(`${cur}: {}  # redacted by Pulse: values not shown`);
          continue;
        }
        if (unclosed(rest)) { bad = SPANS; break; }
        ob.push(l);
        continue;
      }
      if (cur !== 'metadata') { bad = `it has nested content under ${cur}`; break; }
      const mm = l.indexOf(':');
      if (mm >= 0 && unclosed(l.slice(mm + 1))) { bad = SPANS; break; }
      ob.push(l);
    }
    if (bad) { withhold(bad); return; }
    out.push(...ob);
    doc = [];
  };
  for (const l of lines) {
    if (l.startsWith('---')) {
      await flush();
      out.push('---');
      const r = l.slice(3);
      if (!/^[ \t]*(#.*)?$/.test(r)) doc.push(r);
    } else doc.push(l);
  }
  await flush();
  return out.join('\n') + (trailing ? '\n' : '');
}

export const REDACTED = /^\(redacted sha256:[0-9a-f]{16}\)$/;

/** A copy of a redacted Secret with placeholder values the API server accepts, for the dry run. */
export function dryRunPlaceholder(doc: Record<string, Json>): Record<string, Json> {
  if (doc?.kind !== 'Secret') return doc;
  const fill = (m: unknown, v: string) => (m && typeof m === 'object' ? Object.fromEntries(Object.keys(m).map((k) => [k, v])) : m);
  return { ...doc, ...(doc.data ? { data: fill(doc.data, 'cmVkYWN0ZWQ=') } : {}), ...(doc.stringData ? { stringData: fill(doc.stringData, 'redacted') } : {}) };
}
