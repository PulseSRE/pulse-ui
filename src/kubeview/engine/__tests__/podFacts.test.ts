import { describe, it, expect } from 'vitest';
import { lastTermination, primaryContainer, probeTiming, containerRefs } from '../podFacts';

describe('podFacts', () => {
  it('reads lastState.terminated with how long it ran; none is null', () => {
    const t = lastTermination({ name: 'a', ready: false, restartCount: 2, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, startedAt: '2026-11-02T14:20:26Z', finishedAt: '2026-11-02T14:21:07Z' } } });
    expect(t).toMatchObject({ reason: 'OOMKilled', exitCode: 137, ranForMs: 41_000 });
    expect(lastTermination({ name: 'a', ready: true, restartCount: 0 })).toBeNull();
  });

  it('picks the container whose last instance ended most recently', () => {
    const pod = {
      spec: { containers: [{ name: 'sidecar', image: 'x' }, { name: 'app', image: 'y' }] },
      status: { containerStatuses: [
        { name: 'sidecar', ready: true, restartCount: 0 },
        { name: 'app', ready: false, restartCount: 3, lastState: { terminated: { reason: 'Error', exitCode: 1, finishedAt: '2026-11-02T10:00:00Z' } } },
      ] },
    };
    expect(primaryContainer(pod as never)?.name).toBe('app');
  });

  it('shows probe defaults for unset fields', () => {
    expect(probeTiming({ tcpSocket: { port: 5432 } })).toBe('TCP :5432 · delay 0s · every 10s · timeout 1s · 3 failures');
  });

  it('lists only volumes the container mounts', () => {
    const pod = {
      metadata: { namespace: 'ns' },
      spec: {
        containers: [],
        volumes: [{ name: 'a', configMap: { name: 'cm-a' } }, { name: 'b', secret: { secretName: 's-b' } }],
      },
    };
    const refs = containerRefs(pod as never, { name: 'c', image: 'i', volumeMounts: [{ name: 'a', mountPath: '/a' }], envFrom: [{ secretRef: { name: 'env-s' } }] } as never);
    expect(refs.map((r) => `${r.kind}/${r.name}`)).toEqual(['ConfigMap/cm-a', 'Secret/env-s']);
  });
});
