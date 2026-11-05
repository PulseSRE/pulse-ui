import { describe, it, expect } from 'vitest';
import { proposeFixes, proposeMemoryLimit, roundMemoryUp, withServiceAccount, withChangeCause, dryRunRequest, rolloutImpact } from '../podFixes';
import { parseRevisions } from '../../views/detail/RolloutHistory';
import * as F from '../../views/detail/__tests__/fixFixtures';

const MiB = 1024 * 1024;

describe('memory limit proposal', () => {
  it('uses p95 + 25% when that exceeds 1.5× the limit, rounded up to 64Mi', () => {
    expect(proposeMemoryLimit(256 * MiB, 410 * MiB).limit).toBe(576 * MiB);
    expect(proposeMemoryLimit(256 * MiB, 200 * MiB).limit).toBe(384 * MiB);
    expect(proposeMemoryLimit(256 * MiB, undefined).basis).toMatch(/usage is unknown/);
    expect(roundMemoryUp(2100 * MiB)).toBe(2304 * MiB);
  });
});

describe('proposeFixes', () => {
  it('OOMKilled: raises the owner\'s memory limit (and request to p95) with a resourceVersion test', () => {
    const [fix] = proposeFixes({ pod: F.oomPod() as never, owner: F.oomOwner() as never, usage: F.oomUsage });
    expect(fix.kind).toBe('memory');
    expect(fix.title).toBe('Raise the memory limit to 576Mi on Deployment api');
    expect(fix.diff).toEqual([
      { field: 'limits.memory', before: '256Mi', after: '576Mi' },
      { field: 'requests.memory', before: '128Mi', after: '448Mi' },
    ]);
    expect(fix.request).toEqual({
      method: 'PATCH', path: '/apis/apps/v1/namespaces/payments/deployments/api', patchType: 'application/json-patch+json',
      body: [
        { op: 'test', path: '/metadata/resourceVersion', value: '777' },
        { op: 'test', path: '/spec/template/spec/containers/0/name', value: 'api' },
        { op: 'add', path: '/spec/template/spec/containers/0/resources/limits/memory', value: '576Mi' },
        { op: 'add', path: '/spec/template/spec/containers/0/resources/requests/memory', value: '448Mi' },
      ],
    });
    expect(fix.impact).toBe('Rolling restart of 3 pods (maxUnavailable 1, maxSurge 25%)');
    expect(fix.undo).toMatch(/^Roll back to the revision before this change \(revision 14\)/);
    expect(fix.memoryDelta).toEqual({ requests: 320 * MiB, limits: 320 * MiB, replicas: 3 });
  });

  it('OOMKilled without a container limit proposes no memory fix (the node ran out)', () => {
    const fixes = proposeFixes({ pod: F.oomPod() as never, owner: F.deployment({}) as never, usage: F.oomUsage });
    expect(fixes.find((f) => f.kind === 'memory')).toBeUndefined();
  });

  it('no owner, no template fixes', () => {
    expect(proposeFixes({ pod: F.oomPod() as never, owner: null, usage: F.oomUsage })).toEqual([]);
  });

  it('killed by liveness while starting: adds a startup probe with the liveness check', () => {
    const [fix] = proposeFixes({ pod: F.livenessPod() as never, owner: F.livenessOwner() as never });
    expect(fix.kind).toBe('startup-probe');
    const body = fix.request.body as Array<Record<string, unknown>>;
    expect(body[2]).toEqual({ op: 'add', path: '/spec/template/spec/containers/0/startupProbe', value: { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10, failureThreshold: 30 } });
  });

  it('CPU at its limit on an unhealthy container: raises the CPU limit', () => {
    const [fix] = proposeFixes({ pod: F.cpuPod() as never, owner: F.cpuOwner() as never, usage: F.cpuUsage });
    expect(fix.kind).toBe('cpu');
    expect(fix.diff).toEqual([{ field: 'limits.cpu', before: '500m', after: '800m' }]);
  });

  it('unauthorized image pull: attaches an unused registry secret to the ServiceAccount', () => {
    const [fix] = proposeFixes({ pod: F.pullPod() as never, owner: F.deployment({}) as never, pullSecrets: ['acme-quay'] });
    expect(fix.kind).toBe('pull-secret');
    expect(fix.target).toMatchObject({ kind: 'ServiceAccount', name: 'api-sa', plural: 'serviceaccounts' });
    const filled = withServiceAccount(fix, { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'api-sa', resourceVersion: '5' }, imagePullSecrets: [{ name: 'other' }] } as never);
    expect(filled.request.body).toEqual([
      { op: 'test', path: '/metadata/resourceVersion', value: '5' },
      { op: 'add', path: '/imagePullSecrets/-', value: { name: 'acme-quay' } },
    ]);
    expect(filled.diff).toEqual([{ field: 'imagePullSecrets', before: 'other', after: 'other, acme-quay' }]);
    expect(filled.watchable).toBe(false);
  });

  it('failing pods of the current revision: rolls back to the previous one, template without the hash label', () => {
    const owner = F.rollbackOwner();
    const revisions = parseRevisions(owner as never, F.replicaSets() as never);
    const fixes = proposeFixes({ pod: F.rollbackPod() as never, owner: owner as never, revisions });
    const fix = fixes.find((f) => f.kind === 'rollback')!;
    expect(fix.title).toBe('Roll back Deployment api to revision 13');
    const body = fix.request.body as Array<{ op: string; value: { metadata: { labels: Record<string, string> } } }>;
    expect(body[1].op).toBe('replace');
    expect(body[1].value.metadata.labels['pod-template-hash']).toBeUndefined();
    expect(fix.diff[0].field).toContain('image quay.io/acme/api:1.9.0 -> quay.io/acme/api:1.8.2');
  });

  it('records a change cause on workload fixes and builds the dry run path', () => {
    const [fix] = proposeFixes({ pod: F.oomPod() as never, owner: F.oomOwner() as never, usage: F.oomUsage });
    const req = withChangeCause(fix, F.oomOwner() as never, 'cache grew');
    expect((req.body as unknown[]).at(-1)).toEqual({ op: 'add', path: '/metadata/annotations/kubernetes.io~1change-cause', value: 'Pulse: Raise the memory limit to 576Mi on Deployment api (cache grew)' });
    expect(dryRunRequest(req).path).toBe('/apis/apps/v1/namespaces/payments/deployments/api?dryRun=All');
  });

  it('describes Recreate as downtime', () => {
    expect(rolloutImpact(F.deployment({}, { spec: { replicas: 2, strategy: { type: 'Recreate' }, template: {} } }) as never)).toMatch(/down meanwhile/);
  });

  it('a container that ran 4h and then hung gets no startup-probe fix', () => {
    const hung = F.pod({
      state: { waiting: { reason: 'CrashLoopBackOff' } },
      lastState: { terminated: { reason: 'Error', exitCode: 137, startedAt: '2026-11-02T10:00:00Z', finishedAt: '2026-11-02T14:00:00Z' } },
    });
    const events = [{ reason: 'Unhealthy', message: 'Liveness probe failed: timeout', involvedObject: { name: 'api-7f9c4d-x2k8q' } }];
    expect(proposeFixes({ pod: hung as never, owner: F.livenessOwner() as never, events: events as never }).find((f) => f.kind === 'startup-probe')).toBeUndefined();
  });

  it('caps the proposed start budget at 10 minutes and says so', () => {
    const slow = F.pod({
      state: { waiting: { reason: 'CrashLoopBackOff' } },
      lastState: { terminated: { reason: 'Error', exitCode: 137, startedAt: '2026-11-02T14:00:00Z', finishedAt: '2026-11-02T14:06:00Z' } },
    });
    const owner = F.deployment({ livenessProbe: { httpGet: { path: '/h', port: 8080 }, initialDelaySeconds: 60, periodSeconds: 30, failureThreshold: 5 } });
    const killed = [{ reason: 'Unhealthy', message: 'Liveness probe failed: connection refused', involvedObject: { name: 'api-7f9c4d-x2k8q' } }] as never;
    const [fix] = proposeFixes({ pod: slow as never, owner: owner as never, events: killed });
    expect(fix.kind).toBe('startup-probe');
    expect((fix.request.body as Array<{ value?: { failureThreshold?: number } }>)[2].value?.failureThreshold).toBe(60);
    expect(fix.basis).toMatch(/capped at 10 minutes \(twice the observed run would be longer\)/);
    const withStartup = F.deployment({ livenessProbe: { httpGet: { path: '/h', port: 8080 }, initialDelaySeconds: 60, periodSeconds: 30, failureThreshold: 5 }, startupProbe: { httpGet: { path: '/h', port: 8080 }, periodSeconds: 10, failureThreshold: 40 } });
    const [f2] = proposeFixes({ pod: slow as never, owner: withStartup as never, events: killed });
    expect((f2.request.body as Array<{ value?: number }>)[2].value).toBe(60);
  });

  it('when the template lists imagePullSecrets, the secret goes into the template, not the ServiceAccount', () => {
    const owner = F.deployment({}, {});
    (owner.spec.template.spec as Record<string, unknown>).imagePullSecrets = [{ name: 'old-creds' }];
    const [fix] = proposeFixes({ pod: F.pullPod() as never, owner: owner as never, pullSecrets: ['acme-quay'] });
    expect(fix.target.kind).toBe('Deployment');
    expect(fix.request.body).toEqual([
      { op: 'test', path: '/metadata/resourceVersion', value: '777' },
      { op: 'add', path: '/spec/template/spec/imagePullSecrets/-', value: { name: 'acme-quay' } },
    ]);
    expect(fix.watchable).toBe(true);
    expect(fix.basis).toMatch(/ServiceAccount ones are not applied/);
  });

  it('an OnDelete StatefulSet fix is not watchable and says pods must be deleted', () => {
    const sts = { ...F.oomOwner(), kind: 'StatefulSet', spec: { ...F.oomOwner().spec, updateStrategy: { type: 'OnDelete' } } };
    const [fix] = proposeFixes({ pod: F.oomPod() as never, owner: sts as never, usage: F.oomUsage });
    expect(fix.watchable).toBe(false);
    expect(fix.impact).toMatch(/only when you delete it/);
  });
});
