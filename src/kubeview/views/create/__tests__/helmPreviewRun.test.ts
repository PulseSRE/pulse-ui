// @vitest-environment jsdom
/**
 * The preview Job's lifecycle and checks, below the UI: the Job is deleted on
 * every path (success, render error, time-out, unreadable log, cancel, failed
 * input Secret); CRDs, adoption, ownership reads, kept and gone objects, and
 * objects outside the runner's namespace are judged as helm would.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, json, k8sStatus } from '../../../__tests__/actionHarness';
import { HelmRenderError, runHelmPreview, checkObject, type PreviewRequest } from '../helmPreview';
import { canSkipPreview, previewDisabledReason } from '../HelmPreviewPanel';
import { previewHandler, PLAIN_MANIFEST } from './helmTestUtils';
import { readCapped } from '../../../engine/helmManifest';

const h = createHarness();
const RUNNER = `quay.io/pulse/helm-runner@sha256:${'d'.repeat(64)}`;
const req = (over: Partial<PreviewRequest> = {}): PreviewRequest => ({
  clusterId: 'local', namespace: 'team-a', releaseName: 'shop',
  chart: { from: 'repo', chartName: 'nginx', repoUrl: 'https://charts.example.com' }, valuesYaml: '', timeoutMs: 200, pollMs: 10, ...over,
});
const deletedJobs = () => h.writes().filter((w) => w.method === 'DELETE' && w.path.includes('/jobs/helm-template-shop-'));
const base = () => json({});

beforeEach(() => {
  h.setup();
  (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__ = { helmInstall: { runnerImage: RUNNER } };
});
afterEach(() => { h.teardown(); delete (window as unknown as { __OPENSHIFTPULSE_CONFIG__?: unknown }).__OPENSHIFTPULSE_CONFIG__; });

describe('preview Job cleanup', () => {
  it('deletes the Job after a successful render', async () => {
    h.state.handler = previewHandler(base, { log: PLAIN_MANIFEST });
    await runHelmPreview(req());
    expect(deletedJobs()).toHaveLength(1);
  });

  it('finds the pod by batch.kubernetes.io/controller-uid, falling back to controller-uid on older clusters', async () => {
    const inner = previewHandler(base, { log: PLAIN_MANIFEST });
    h.state.handler = (r) => (r.path.includes('labelSelector=batch.kubernetes.io%2Fcontroller-uid') ? json({ items: [] }) : inner(r));
    await runHelmPreview(req());
    const lookups = h.state.requests.filter((r) => r.path.includes('/pods?labelSelector='));
    expect(lookups.map((r) => decodeURIComponent(r.path.split('labelSelector=')[1]))).toEqual(['batch.kubernetes.io/controller-uid=tpl-uid-1', 'controller-uid=tpl-uid-1']);
  });

  it('an old runner image is not a render error, and the Job is still deleted', async () => {
    h.state.handler = previewHandler(base, { log: 'PULSE_RUNNER_TOO_OLD: sha256sum is missing from the Helm runner image', phase: 'Failed' });
    const err = await runHelmPreview(req()).catch((e) => e);
    expect(err).not.toBeInstanceOf(HelmRenderError);
    expect(err.message).toMatch(/too old for previews; update Pulse/);
    expect(deletedJobs()).toHaveLength(1);
  });

  it('deletes the Job when helm fails to render', async () => {
    h.state.handler = previewHandler(base, { log: 'Error: template: nginx/templates/x.yaml:3: bad', phase: 'Failed' });
    await expect(runHelmPreview(req())).rejects.toBeInstanceOf(HelmRenderError);
    expect(deletedJobs()).toHaveLength(1);
  });

  it('deletes the Job when it does not finish in time', async () => {
    h.state.handler = previewHandler(base, { log: '', pods: () => json({ items: [{ metadata: { name: 'helm-pod-1' }, status: { phase: 'Running' } }] }) });
    await expect(runHelmPreview(req())).rejects.toThrow(/did not finish within/);
    expect(deletedJobs()).toHaveLength(1);
  });

  it('deletes the Job when its log cannot be read', async () => {
    h.state.handler = previewHandler(base, { log: '', logResponse: () => k8sStatus(403, 'pods "helm-pod-1" is forbidden: cannot get resource "pods/log"') });
    await expect(runHelmPreview(req())).rejects.toThrow(/its log could not be read: .*pods\/log/);
    expect(deletedJobs()).toHaveLength(1);
  });

  it('deletes the Job when the preview is cancelled', async () => {
    h.state.handler = previewHandler(base, { log: '', pods: () => json({ items: [] }) });
    const c = new AbortController();
    const p = runHelmPreview(req({ signal: c.signal, timeoutMs: 5000 }));
    setTimeout(() => c.abort(), 30);
    await expect(p).rejects.toThrow(/cancelled/);
    expect(deletedJobs()).toHaveLength(1);
  });

  it('deletes the Job when its values Secret cannot be created', async () => {
    const inner = previewHandler(base, { log: PLAIN_MANIFEST });
    h.state.handler = (r) => (r.method === 'POST' && r.path.endsWith('/secrets') ? k8sStatus(403, 'secrets is forbidden') : inner(r));
    await expect(runHelmPreview(req())).rejects.toThrow('secrets is forbidden');
    expect(deletedJobs()).toHaveLength(1);
  });
});

describe('what the preview checks', () => {
  const CRD = `---
# Source: nginx/crds/widget.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.example.com
---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: gadgets.example.com
`;
  it('a missing CRD would fail (the runner cannot create one); an existing one is skipped', async () => {
    h.state.handler = previewHandler((r) => (r.path.endsWith('/customresourcedefinitions/widgets.example.com') ? json({}) : r.path.includes('/customresourcedefinitions/') ? k8sStatus(404, 'not found') : json({})), { log: CRD });
    const p = await runHelmPreview(req());
    const crds = p.entries.filter((e) => e.kind === 'CustomResourceDefinition');
    expect(crds.map((e) => [e.name, e.check.status, e.check.message])).toEqual([
      ['widgets.example.com', 'ok', 'Already exists, so helm skips it.'],
      ['gadgets.example.com', 'fail', expect.stringMatching(/cannot create a CustomResourceDefinition/)],
    ]);
    // A CRD is never dry-run.
    expect(h.writes().some((w) => w.path.includes('customresourcedefinitions'))).toBe(false);
  });

  const svc = { change: 'added' as const, key: '/Service/team-a/shop', apiVersion: 'v1', kind: 'Service', name: 'shop', namespace: 'team-a', doc: { apiVersion: 'v1', kind: 'Service', metadata: { name: 'shop' } } };
  const rel = { name: 'shop', namespace: 'team-a' };
  const conflict = (existing: Response) => (r: { path: string; method: string }) => (r.method === 'POST' ? k8sStatus(409, 'already exists') : r.path === '/api/v1/namespaces/team-a/services/shop' ? existing : json({}));

  it('adopts an existing object only with the release annotations and the managed-by: Helm label', async () => {
    const meta = (labels: Record<string, string>) => json({ metadata: { labels, annotations: { 'meta.helm.sh/release-name': 'shop', 'meta.helm.sh/release-namespace': 'team-a' } } });
    h.state.handler = conflict(meta({ 'app.kubernetes.io/managed-by': 'Helm' }));
    expect((await checkObject('local', svc, rel)).status).toBe('ok');
    h.state.handler = conflict(meta({}));
    expect(await checkObject('local', svc, rel)).toEqual({ status: 'fail', message: expect.stringMatching(/without the app\.kubernetes\.io\/managed-by: Helm label/) });
  });

  it('an existing object that cannot be read is "could not check", not "not part of this release"', async () => {
    h.state.handler = conflict(k8sStatus(403, 'forbidden'));
    expect(await checkObject('local', svc, rel)).toEqual({ status: 'unknown', message: expect.stringMatching(/Could not check: it already exists, and Pulse could not read it/) });
  });

  it('an object in another namespace is outside the runner Role', async () => {
    expect(await checkObject('local', { ...svc, namespace: 'other' }, rel)).toEqual({ status: 'fail', message: expect.stringMatching(/in namespace other; the Helm runner's Role covers only team-a/) });
  });

  it('removed objects: kept by policy, or an API that no longer exists', async () => {
    expect((await checkObject('local', { ...svc, change: 'removed', keep: true }, rel)).message).toMatch(/Kept: the chart marks it helm\.sh\/resource-policy: keep/);
    h.state.handler = () => new Response('404 page not found', { status: 404 });
    expect((await checkObject('local', { ...svc, change: 'removed' }, rel)).message).toBe('Its API no longer exists on this cluster, so nothing is deleted.');
  });

  it('dry-runs a Secret with placeholders, never the redacted marker', async () => {
    h.state.handler = () => json({});
    const doc = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 's' }, data: { password: '(redacted sha256:0123456789abcdef)' } };
    await checkObject('local', { ...svc, kind: 'Secret', name: 's', doc }, rel);
    expect(h.writes()[0].body.data).toEqual({ password: 'cmVkYWN0ZWQ=' });
  });
});

describe('when installing without a preview is offered', () => {
  it('never while checking, without a namespace, for render errors or when Jobs are denied; yes for infra errors and denied logs', () => {
    const infra = { status: 'error' as const, key: 'k', error: 'x', kind: 'infra' as const };
    const render = { ...infra, kind: 'render' as const };
    expect(canSkipPreview({ state: 'checking' }, infra)).toBe(false);
    expect(previewDisabledReason({ state: 'checking' })).toBe('Checking your permissions…');
    expect(canSkipPreview({ state: 'no-namespace', reason: '' }, infra)).toBe(false);
    expect(canSkipPreview({ state: 'denied', reason: 'jobs', logsOnly: false }, null)).toBe(false);
    expect(canSkipPreview({ state: 'allowed' }, render)).toBe(false);
    expect(canSkipPreview({ state: 'allowed' }, infra)).toBe(true);
    expect(canSkipPreview({ state: 'denied', reason: 'logs', logsOnly: true }, null)).toBe(true);
  });
});

describe('chart archive download cap', () => {
  it('refuses a declared or streamed body over the limit', async () => {
    await expect(readCapped(new Response('x', { headers: { 'content-length': '999' } }), 10)).rejects.toThrow(/larger than/);
    await expect(readCapped(new Response('x'.repeat(50)), 10)).rejects.toThrow(/larger than/);
    expect((await readCapped(new Response('abc'), 10)).length).toBe(3);
  });
});
