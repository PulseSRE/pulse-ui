// @vitest-environment node
/**
 * The preview Job's script, run for real with sh, awk and sha256sum and a fake
 * `helm` that prints a fixed render, and the browser's TS copy of the same
 * rules: rendered Secret values never reach the output in any shape helm can
 * print (quoted kind, trailing comments, comments after `data:`, column-0
 * comments inside a block, Secrets inside a List, flow mappings, unknown
 * kinds), both copies produce the same bytes, and a runner without the tools
 * says so with a marker instead of printing anything.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RUNNER_TOO_OLD_MARKER, TEMPLATE_SCRIPT } from '../helmTemplateJob';
import { parseRendered, redactSecretValues, WITHHELD_KIND } from '../../../engine/helmManifest';

const RENDER = `---
# Source: app/templates/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: app
type: Opaque
data:
  password: czNjcjN0LXBhc3M=
  "quoted-key": "dmFsdWU="
stringData:
  token: hunter2-plain
  config.yaml: |
    user: admin
    pass: also-secret

  after: "x"
---
apiVersion: v1
kind: Secret
metadata:
  name: empty
data: {}
---
apiVersion: v1
kind: Secret
metadata:
  name: flow
stringData: {a: leaked-flow}
---
# Source: app/templates/cm.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app
data:
  greeting: hello
`;

/** Each shape the review found leaking, with the value that must not appear. */
const CASES: Array<{ name: string; secret: string; render: string; withheld?: boolean }> = [
  { name: 'quoted kind', secret: 'quoted-kind-pass', render: `---\napiVersion: v1\nkind: "Secret"\nmetadata:\n  name: a\nstringData:\n  p: quoted-kind-pass\n` },
  { name: 'single-quoted kind', secret: 'single-q-pass', render: `---\napiVersion: v1\nkind: 'Secret'\nmetadata:\n  name: a\nstringData:\n  p: single-q-pass\n` },
  { name: 'kind with a trailing comment', secret: 'comment-kind-pass', render: `---\napiVersion: v1\nkind: Secret   # the db password\nmetadata:\n  name: a\nstringData:\n  p: comment-kind-pass\n` },
  { name: 'comment after data:', secret: 'Y29tbWVudC1kYXRh', render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\ndata: # base64\n  p: Y29tbWVudC1kYXRh\n` },
  { name: 'column-0 comment inside stringData', secret: 'after-col0-comment', render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData:\n  a: first-value\n# {{- if .Values.extra }}\n  b: after-col0-comment\n# {{- end }}\n  c: third-value\ntype: Opaque\n` },
  { name: 'Secret inside a List', secret: 'list-item-pass', withheld: true, render: `---\n# Source: app/templates/list.yaml\napiVersion: v1\nkind: List\nitems:\n  - apiVersion: v1\n    kind: Secret\n    metadata:\n      name: in-list\n    stringData:\n      p: list-item-pass\n` },
  { name: 'Secret as a column-0 list item', secret: 'col0-item-pass', withheld: true, render: `---\napiVersion: v1\nkind: List\nitems:\n- kind: Secret\n  stringData:\n    p: col0-item-pass\n` },
  { name: 'Secret in a flow mapping inside a List', secret: 'flow-list-pass', withheld: true, render: `---\napiVersion: v1\nkind: List\nitems: [{kind: Secret, stringData: {p: flow-list-pass}}]\n` },
  { name: 'unknown kind (JSON document)', secret: 'json-pass', withheld: true, render: `---\n{"apiVersion": "v1", "kind": "Secret", "stringData": {"p": "json-pass"}}\n` },
  { name: 'quoted "kind" key', secret: 'quoted-key-pass', withheld: true, render: `---\napiVersion: v1\n"kind": Secret\nstringData:\n  p: quoted-key-pass\n` },
  { name: 'content after a document separator', secret: 'sep-pass', withheld: true, render: `--- {kind: Secret, stringData: {p: sep-pass}}\n` },
  { name: 'multi-line flow data', secret: 'multi-flow-pass', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\ndata: {\n  p: multi-flow-pass\n}\ntype: Opaque\n` },
  { name: 'quoted data key', secret: 'quoted-data-pass', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n"stringData":\n  p: quoted-data-pass\n` },
  // Round 3: shapes an allow-list closes.
  { name: 'flow mapping continued at column 0', secret: 'LEAK-flow-col0', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData: {a: x,\npassword: LEAK-flow-col0}\n` },
  { name: 'escaped key', secret: 'LEAK-escaped', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n"d\\x61ta":\n  p: LEAK-escaped\n` },
  { name: 'anchor in metadata, alias as stringData', secret: 'LEAK-anchor', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n  annotations: &x {password: LEAK-anchor}\nstringData: *x\n` },
  { name: 'alias value', secret: 'LEAK-alias', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n  labels: {l: &pw LEAK-alias}\nstringData:\n  password: *pw\n` },
  { name: 'merge key', secret: 'LEAK-merge', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n  annotations: &m {password: LEAK-merge}\nstringData: {<<: *m}\n` },
  { name: 'block scalar followed by a column-0 key', secret: 'LEAK-proc-type', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData:\n  key.pem: |\n    -----BEGIN RSA PRIVATE KEY-----\nProc-Type: LEAK-proc-type\n` },
  { name: 'comment carrying a value', secret: 'LEAK-comment', render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n# password was LEAK-comment\nstringData:\n  p: x\n` },
  // Round 4: flow collections spanning lines, and nested kinds that are tagged or folded.
  { name: 'stringData flow mapping closed by a column-0 type: line', secret: 's3cret-type', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData: {user: admin,\ntype: s3cret-type}\n` },
  { name: 'stringData flow mapping closed by a column-0 metadata: line', secret: 's3cret-meta', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData: {user: admin,\nmetadata: s3cret-meta}\n` },
  { name: 'data value flow mapping closed by a column-0 kind: line', secret: 's3cret-kind', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData:\n  a: {x: y,\nkind: s3cret-kind}\n` },
  { name: 'data value flow sequence left open', secret: 's3cret-seq', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData:\n  a: [x,\ntype: s3cret-seq]\n` },
  { name: 'metadata flow mapping left open', secret: 's3cret-md', withheld: true, render: `---\napiVersion: v1\nkind: Secret\nmetadata: {name: a,\napiVersion: s3cret-md}\nstringData:\n  p: x\n` },
  { name: 'tagged kind inside a List', secret: 'tagged-list-pass', withheld: true, render: `---\napiVersion: v1\nkind: List\nitems:\n  - apiVersion: v1\n    kind: !!str Secret\n    stringData:\n      p: tagged-list-pass\n` },
  { name: 'folded kind inside a List', secret: 'folded-list-pass', withheld: true, render: `---\napiVersion: v1\nkind: List\nitems:\n  - apiVersion: v1\n    kind: >-\n      Secret\n    stringData:\n      p: folded-list-pass\n` },
  { name: 'folded kind inside a Template', secret: 'folded-tpl-pass', withheld: true, render: `---\napiVersion: template.openshift.io/v1\nkind: Template\nobjects:\n- apiVersion: v1\n  kind: >-\n    Secret\n  stringData:\n    p: folded-tpl-pass\n` },
  { name: 'tagged kind in a flow mapping inside a List', secret: 'tagged-flow-pass', withheld: true, render: `---\napiVersion: v1\nkind: List\nitems: [{kind: !!str Secret, stringData: {p: tagged-flow-pass}}]\n` },
  { name: 'nested content under type', secret: 'LEAK-under-type', withheld: true, render: `---\napiVersion: v1\nkind: Secret\ntype: |\n  LEAK-under-type\nstringData:\n  p: x\n` },
];

/** Valid Secrets that must still be shown (not withheld), with values redacted. */
const SHOWN: Array<{ name: string; secret: string; render: string }> = [
  { name: 'flow mapping value that closes on an indented line', secret: 'closed-flow-pass', render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\nstringData:\n  url: {a: closed-flow-pass,\n    b: c}\n` },
  { name: 'ampersand inside a value', secret: 'a=1&b=2', render: `---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: a\n  annotations:\n    note: "see https://x.example/?a=1&b=2"\ntype: Opaque\nimmutable: true\nstringData:\n  url: https://x.example/?a=1&b=2\n` },
];

let dir = '';
const SALT = '00112233445566778899aabbccddeeff';
const PULSE_WITHHELD = 'PulsePreviewWithheld';
const hasTools = spawnSync('sh', ['-c', 'command -v awk && command -v sha256sum']).status === 0;
const SH = execFileSync('sh', ['-c', 'command -v sh'], { encoding: 'utf8' }).trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pulse-redact-'));
  writeFileSync(join(dir, 'salt'), SALT);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

let n = 0;
/** Run the Job's script with a fake helm that prints `render`. */
function runScript(render: string, path = `${dir}:${process.env.PATH}`) {
  const sub = join(dir, `run${n++}`);
  mkdirSync(sub);
  writeFileSync(join(sub, 'render.yaml'), render);
  writeFileSync(join(dir, 'helm'), `#!/bin/sh\ncat "$PULSE_RENDER"\n`);
  chmodSync(join(dir, 'helm'), 0o755);
  return spawnSync(SH, ['-c', TEMPLATE_SCRIPT, 'helm-template', 'template', 'app', 'chart'], {
    env: { PATH: path, PULSE_WORK: sub, PULSE_SALT_FILE: join(dir, 'salt'), PULSE_RENDER: join(sub, 'render.yaml') }, encoding: 'utf8',
  });
}

describe('TS redaction (browser copy)', () => {
  it.each(CASES)('$name: the value is not shown', async ({ render, secret, withheld }) => {
    const out = await redactSecretValues(render, SALT);
    expect(out).not.toContain(secret);
    const objs = parseRendered(out, 'ns').objects;
    if (withheld) expect(objs.map((o) => o.kind)).toEqual([WITHHELD_KIND]);
    else expect(objs.some((o) => o.kind === 'Secret')).toBe(true);
  });

  it.each(SHOWN)('$name: still shown, value redacted', async ({ render, secret }) => {
    const out = await redactSecretValues(render, SALT);
    const objs = parseRendered(out, 'ns').objects;
    expect(objs.map((o) => o.kind)).toEqual(['Secret']);
    expect(out.split('stringData:')[1]).not.toContain(secret);
    expect(out).toMatch(/url: "\(redacted sha256:[0-9a-f]{16}\)"/);
  });

  it('keeps non-secret values and redacts the documented shape', async () => {
    const out = await redactSecretValues(RENDER, SALT);
    for (const s of ['czNjcjN0LXBhc3M=', 'dmFsdWU=', 'hunter2-plain', 'also-secret', 'leaked-flow']) expect(out).not.toContain(s);
    expect(out).toContain('greeting: hello');
    expect(out).toMatch(/ {2}password: "\(redacted sha256:[0-9a-f]{16}\)"/);
  });

  it('a column-0 comment does not end the block: the keys after it are redacted too, and the next top-level key is kept', async () => {
    const out = await redactSecretValues(CASES.find((c) => c.name.startsWith('column-0'))!.render, SALT);
    expect(out.match(/redacted sha256/g)).toHaveLength(3);
    expect(out).toContain('type: Opaque');
    expect(out).not.toContain('{{- if');
  });

  it('a withheld document keeps its source and says why', async () => {
    const out = await redactSecretValues(CASES.find((c) => c.name === 'Secret inside a List')!.render, SALT);
    expect(out).toBe(`---\n# Source: app/templates/list.yaml\n# Pulse withheld this document from the preview: it contains a Secret inside a list or another object.\napiVersion: v1\nkind: ${WITHHELD_KIND}\nmetadata:\n  name: withheld-1\nreason: "it contains a Secret inside a list or another object"\n`);
  });

  it('documents with no content pass through unchanged', async () => {
    expect(await redactSecretValues('---\n# Source: app/templates/empty.yaml\n', SALT)).toBe('---\n# Source: app/templates/empty.yaml\n');
  });
});

describe.skipIf(!hasTools)('preview Job redaction (real sh and awk)', () => {
  it('prints no Secret value, and matches the browser\'s redaction byte for byte', async () => {
    const r = runScript(RENDER);
    expect(r.status).toBe(0);
    for (const secret of ['czNjcjN0LXBhc3M=', 'dmFsdWU=', 'hunter2-plain', 'also-secret', 'leaked-flow']) expect(r.stdout).not.toContain(secret);
    expect(r.stdout).toContain('greeting: hello'); // ConfigMaps are untouched
    expect(r.stdout).toContain('data: {}');
    expect(r.stdout).toContain('stringData: {}  # redacted by Pulse: values not shown');
    expect(r.stdout).toBe(await redactSecretValues(RENDER, SALT));
    // The hash is of salt + value, so the browser can tell an unchanged value.
    const expected = execFileSync('sh', ['-c', `printf '%s%s' "${SALT}" 'czNjcjN0LXBhc3M=' | sha256sum`], { encoding: 'utf8' }).slice(0, 16);
    expect(r.stdout).toContain(`password: "(redacted sha256:${expected})"`);
  });

  it.each(CASES)('$name: the value never reaches the log, and awk and TS agree', async ({ render, secret }) => {
    const r = runScript(render);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).toBe(await redactSecretValues(render, SALT));
  });

  it.each(SHOWN)('$name: still shown, and awk and TS agree', async ({ render }) => {
    const r = runScript(render);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(await redactSecretValues(render, SALT));
    expect(r.stdout).not.toContain(PULSE_WITHHELD);
  });

  it('all cases in one render: same bytes, withheld markers numbered in order', async () => {
    const all = CASES.map((c) => c.render).join('');
    const r = runScript(all);
    expect(r.status).toBe(0);
    for (const c of CASES) expect(r.stdout).not.toContain(c.secret);
    expect(r.stdout).toBe(await redactSecretValues(all, SALT));
    expect(r.stdout).toContain(`name: withheld-${CASES.filter((c) => c.withheld).length}`);
  });

  it('a runner without awk prints only the too-old marker and exits 42', () => {
    // A PATH with helm and cat but no awk or sha256sum.
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(execFileSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).trim(), join(bin, 'cat'));
    const r = runScript(RENDER, `${dir}:${bin}`);
    expect(r.status).toBe(42);
    expect(r.stdout.trim()).toBe(`${RUNNER_TOO_OLD_MARKER}: awk is missing from the Helm runner image`);
  });
});
