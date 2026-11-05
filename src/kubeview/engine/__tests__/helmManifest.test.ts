import { describe, expect, it } from 'vitest';
import { gzipSync } from 'zlib';
import { diffHunks, diffObjects, hooksFor, leafPaths, lineDiff, mergeValues, parseRendered, parseValues, readChartArchive, schemaHints, yamlLinePaths } from '../helmManifest';
import { tar } from '../helmChartArchive';

const enc = new TextEncoder();

describe('parseRendered', () => {
  it('reads objects with their source and hooks, and defaults the namespace by scope', () => {
    const { objects, warnings } = parseRendered(`---
# Source: c/templates/svc.yaml
apiVersion: v1
kind: Service
metadata: {name: a}
---
# Source: c/templates/cr.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: {name: a}
---
# Source: c/templates/hook.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: h
  annotations: {helm.sh/hook: "pre-upgrade,pre-install", helm.sh/hook-weight: "-1"}
`, 'ns1');
    expect(warnings).toEqual([]);
    expect(objects.map((o) => [o.key, o.source])).toEqual([
      ['/Service/ns1/a', 'c/templates/svc.yaml'],
      ['rbac.authorization.k8s.io/ClusterRole//a', 'c/templates/cr.yaml'],
      ['batch/Job/ns1/h', 'c/templates/hook.yaml'],
    ]);
    expect(objects[2].hook).toEqual({ events: ['pre-upgrade', 'pre-install'], weight: -1, deletePolicies: [] });
    expect(hooksFor(objects, 'install').map((o) => o.name)).toEqual(['h']);
    expect(hooksFor(objects, 'rollback')).toEqual([]);
  });

  it('throws on a garbled document rather than returning fewer objects', () => {
    expect(() => parseRendered('---\n# Source: c/t.yaml\nkind: [\n', 'ns')).toThrow(/from c\/t\.yaml could not be parsed/);
  });
});

describe('diffObjects', () => {
  const doc = (kind: string, name: string, extra: Record<string, unknown> = {}) => ({ apiVersion: 'v1', kind, metadata: { name }, ...extra });
  const objs = (...ds: Record<string, unknown>[]) => parseRendered(ds.map((d) => `---\n${JSON.stringify(d)}\n`).join(''), 'ns').objects;

  it('classifies added, changed, removed and unchanged, ignoring key order and hooks', () => {
    const cur = objs(doc('ConfigMap', 'a', { data: { x: '1', y: '2' } }), doc('ConfigMap', 'b'), doc('Service', 'gone'));
    const next = objs(doc('ConfigMap', 'a', { data: { y: '2', x: '1' } }), doc('ConfigMap', 'b', { data: { z: '1' } }), doc('Secret', 'new'),
      { ...doc('Pod', 't'), metadata: { name: 't', annotations: { 'helm.sh/hook': 'test' } } });
    expect(diffObjects(cur, next).map((c) => `${c.change} ${c.kind}/${c.name}`)).toEqual([
      'unchanged ConfigMap/a', 'changed ConfigMap/b', 'added Secret/new', 'removed Service/gone',
    ]);
  });
});

describe('line diff', () => {
  it('marks added and removed lines and folds long unchanged runs', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i'].join('\n');
    const lines = lineDiff(before, after);
    expect(lines.filter((l) => l.type !== 'same')).toEqual([{ type: 'del', text: 'e' }, { type: 'add', text: 'E' }]);
    const hunks = diffHunks(lines, 1);
    expect(hunks[0]).toEqual({ type: 'gap', skipped: 3 });
    expect(hunks.at(-1)).toEqual({ type: 'gap', skipped: 3 });
  });
});

describe('values', () => {
  it('merges like --reuse-values: maps merge, lists and scalars replace, null deletes', () => {
    expect(mergeValues({ a: { b: 1, c: 2 }, l: [1, 2], gone: 1 }, { a: { c: 3 }, l: [9], gone: null })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });

  it('parses only a mapping', () => {
    expect(parseValues('')).toEqual({});
    expect(() => parseValues('- a')).toThrow('Values must be a YAML mapping');
  });

  it('finds the leaf paths of overrides and the key path of each default line', () => {
    expect(leafPaths({ a: { b: 1 }, c: [], d: {} })).toEqual(['a.b', 'c', 'd']);
    expect(yamlLinePaths('# c\na:\n  b: 1\n  c:\n    - x\nd: 2')).toEqual([undefined, 'a', 'a.b', 'a.c', undefined, 'd']);
  });

  it('checks types, enums and unknown keys from the schema', () => {
    const schema = { type: 'object', additionalProperties: false, properties: { n: { type: 'integer' }, m: { type: 'number' }, e: { enum: ['x'] }, o: { type: 'object', properties: {} } } };
    expect(schemaHints(schema, { n: 1, m: 1.5, e: 'x', o: { free: 1 } })).toEqual([]);
    expect(schemaHints(schema, { n: 1.5, e: 'y', z: 1 }).map((h) => `${h.path} ${h.message}`)).toEqual([
      'n must be integer, not number', 'e must be one of "x"', 'z is not a value this chart accepts',
    ]);
    expect(schemaHints(undefined, { anything: 1 })).toEqual([]);
  });
});

describe('readChartArchive', () => {
  it('returns the top-level values.yaml (comments kept) and schema, not a subchart\'s', async () => {
    const tgz = gzipSync(Buffer.from(tar([
      { path: 'c/charts/sub/values.yaml', data: enc.encode('sub: 1\n') },
      { path: 'c/values.yaml', data: enc.encode('# keep me\nx: 1\n') },
      { path: 'c/values.schema.json', data: enc.encode('{"type":"object"}') },
    ])));
    const d = await readChartArchive(new Uint8Array(tgz));
    expect(d.valuesYaml).toBe('# keep me\nx: 1\n');
    expect(d.schema).toEqual({ type: 'object' });
  });

  it('rejects something that is not a gzip archive', async () => {
    await expect(readChartArchive(enc.encode('<html>not a chart</html>'))).rejects.toThrow();
  });
});
