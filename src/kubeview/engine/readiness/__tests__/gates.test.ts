import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../store/uiStore', () => ({
  useUIStore: {
    getState: () => ({ addDegradedReason: vi.fn() }),
  },
}));

import { ALL_GATES } from '../gates';
import type { GateContext, ReadinessGate } from '../types';

function findGate(id: string): ReadinessGate {
  const gate = ALL_GATES.find((g) => g.id === id);
  if (!gate) throw new Error(`gate not found: ${id}`);
  return gate;
}

function makeCtx(fetchJson: GateContext['fetchJson']): GateContext {
  return {
    fetchJson,
    fetchAgent: vi.fn(),
    isHyperShift: false,
  };
}

/** Simulates the 404 a real cluster returns for a CRD/resource that isn't installed. */
function notFound(): never {
  const err = Object.assign(new Error('not found'), { status: 404 });
  throw err;
}

describe('notification-routing gate', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads receivers through the dedicated /api/alertmanager/ proxy, not the K8s service-proxy subresource', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ name: 'Default' }, { name: 'Critical' }]),
    });

    const result = await findGate('notification-routing').evaluate(makeCtx(vi.fn()));

    // Regression guard: this must NOT be
    // '/api/v1/namespaces/openshift-monitoring/services/alertmanager-main:web/proxy/api/v2/receivers'
    // (the K8s API server's service-proxy subresource) — that path 400s
    // because the apiserver defaults to plain HTTP for the unprefixed "web"
    // port name against Alertmanager's TLS listener, and even corrected for
    // scheme, it does not forward the caller's bearer token to the backend.
    expect(global.fetch).toHaveBeenCalledWith('/api/alertmanager/api/v2/receivers');
    expect(result.status).toBe('passed');
    expect(result.detail).toBe('1 receiver configured');
  });

  it('reports not_started (not an unhandled rejection) when Alertmanager is unreachable', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });

    const result = await findGate('notification-routing').evaluate(makeCtx(vi.fn()));

    expect(result.status).toBe('not_started');
    expect(result.detail).toBe('Alertmanager not reachable');
  });
});

describe('etcd-backup gate', () => {
  it('probes config.openshift.io/v1alpha1/backups, not the nonexistent v1', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path === '/apis/config.openshift.io/v1alpha1/backups') {
        return { items: [{ metadata: { name: 'cluster' } }] };
      }
      return notFound();
    });

    const result = await findGate('etcd-backup').evaluate(makeCtx(fetchJson));

    expect(fetchJson).toHaveBeenCalledWith('/apis/config.openshift.io/v1alpha1/backups');
    expect(fetchJson).not.toHaveBeenCalledWith('/apis/config.openshift.io/v1/backups');
    expect(result.status).toBe('passed');
  });

  it('reports needs_attention when no Backup resource exists', async () => {
    const fetchJson = vi.fn(async () => notFound());

    const result = await findGate('etcd-backup').evaluate(makeCtx(fetchJson));

    expect(result.status).toBe('needs_attention');
  });
});

describe('log-forwarding gate', () => {
  it('detects a ClusterLogForwarder under the current observability.openshift.io group (Logging 6.0+)', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path === '/apis/observability.openshift.io/v1/clusterlogforwarders') {
        return { items: [{ metadata: { name: 'instance' } }] };
      }
      return notFound();
    });

    const result = await findGate('log-forwarding').evaluate(makeCtx(fetchJson));

    expect(fetchJson).toHaveBeenCalledWith('/apis/observability.openshift.io/v1/clusterlogforwarders');
    expect(result.status).toBe('passed');
  });

  it('still detects a legacy logging.openshift.io/v1 ClusterLogForwarder (Logging 5.x)', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path === '/apis/logging.openshift.io/v1/clusterlogforwarders') {
        return { items: [{ metadata: { name: 'instance' } }] };
      }
      return notFound();
    });

    const result = await findGate('log-forwarding').evaluate(makeCtx(fetchJson));

    expect(fetchJson).toHaveBeenCalledWith('/apis/logging.openshift.io/v1/clusterlogforwarders');
    expect(result.status).toBe('passed');
  });

  it('reports needs_attention when neither group has a forwarder', async () => {
    const fetchJson = vi.fn(async () => notFound());

    const result = await findGate('log-forwarding').evaluate(makeCtx(fetchJson));

    expect(result.status).toBe('needs_attention');
  });
});
