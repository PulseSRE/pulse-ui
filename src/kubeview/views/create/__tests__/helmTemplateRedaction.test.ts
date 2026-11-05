// @vitest-environment node
/**
 * The preview Job's script, run for real with sh, awk and sha256sum and a fake
 * `helm` that prints a fixed render: rendered Secret values never reach the
 * output, the output matches the browser's own redaction of the same text
 * (so a diff compares like with like), and if redaction cannot run nothing
 * is printed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TEMPLATE_SCRIPT } from '../helmTemplateJob';
import { redactSecretValues } from '../../../engine/helmManifest';

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

let dir = '';
const SALT = '00112233445566778899aabbccddeeff';
const hasTools = spawnSync('sh', ['-c', 'command -v awk && command -v sha256sum']).status === 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pulse-redact-'));
  writeFileSync(join(dir, 'render.yaml'), RENDER);
  writeFileSync(join(dir, 'helm'), `#!/bin/sh\ncat "${join(dir, 'render.yaml')}"\n`);
  chmodSync(join(dir, 'helm'), 0o755);
  writeFileSync(join(dir, 'salt'), SALT);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function runScript(path: string) {
  return spawnSync('sh', ['-c', TEMPLATE_SCRIPT, 'helm-template', 'template', 'app', 'chart'], {
    env: { PATH: path, PULSE_WORK: dir, PULSE_SALT_FILE: join(dir, 'salt') }, encoding: 'utf8',
  });
}

describe.skipIf(!hasTools)('preview Job redaction', () => {
  it('prints no Secret value, and matches the browser\'s redaction byte for byte', async () => {
    const r = runScript(`${dir}:${process.env.PATH}`);
    expect(r.status).toBe(0);
    for (const secret of ['czNjcjN0LXBhc3M=', 'dmFsdWU=', 'hunter2-plain', 'also-secret', 'leaked-flow']) expect(r.stdout).not.toContain(secret);
    expect(r.stdout).toContain('greeting: hello'); // ConfigMaps are untouched
    expect(r.stdout).toMatch(/ {2}password: "\(redacted sha256:[0-9a-f]{16}\)"/);
    expect(r.stdout).toContain('data: {}');
    expect(r.stdout).toContain('stringData: {}  # redacted by Pulse: values not shown');
    expect(r.stdout).toBe(await redactSecretValues(RENDER, SALT));
    // The hash is of salt + value, so the browser can tell an unchanged value.
    const expected = execFileSync('sh', ['-c', `printf '%s%s' "${SALT}" 'czNjcjN0LXBhc3M=' | sha256sum`], { encoding: 'utf8' }).slice(0, 16);
    expect(r.stdout).toContain(`password: "(redacted sha256:${expected})"`);
  });

  it('prints nothing when redaction cannot run', () => {
    // A PATH with helm and cat but no awk or sha256sum.
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(execFileSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).trim(), join(bin, 'cat'));
    const sh = execFileSync('sh', ['-c', 'command -v sh'], { encoding: 'utf8' }).trim();
    const r = spawnSync(sh, ['-c', TEMPLATE_SCRIPT, 'helm-template', 'template'], {
      env: { PATH: `${dir}:${bin}`, PULSE_WORK: dir, PULSE_SALT_FILE: join(dir, 'salt') }, encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('czNjcjN0LXBhc3M=');
    expect(r.stdout).not.toContain('kind: Secret');
  });
});
