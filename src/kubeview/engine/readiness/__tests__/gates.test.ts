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

  it('when the Backup API is not served, says so and points at cluster-backup.sh, not OADP', async () => {
    const fetchJson = vi.fn(async () => notFound());

    const result = await findGate('etcd-backup').evaluate(makeCtx(fetchJson));

    expect(result.status).toBe('needs_attention');
    expect(result.detail).toMatch(/Backup API \(config\.openshift\.io\/v1alpha1\) is not enabled/);
    expect(result.fixGuidance).toContain('cluster-backup.sh');
    expect(result.fixGuidance).toContain('OADP does not back up etcd');
    expect(result.fixGuidance).not.toMatch(/using OADP/);
    // No link to a create form for an API the cluster does not serve, and none to OADP.
    expect(result.action).toBeUndefined();
  });

  it('when the Backup API is served but empty, offers to create an etcd Backup (not OADP)', async () => {
    const fetchJson = vi.fn(async () => ({ items: [] }));

    const result = await findGate('etcd-backup').evaluate(makeCtx(fetchJson));

    expect(result.status).toBe('needs_attention');
    expect(result.detail).toBe('No automated etcd backup configured');
    expect(result.action).toEqual({ label: 'Create etcd Backup', path: '/create/config.openshift.io~v1alpha1~backups' });
    expect(result.fixGuidance).toContain('OADP does not back up etcd');
  });

  it('a 403 on the Backup list is not a pass', async () => {
    const fetchJson = vi.fn(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); });

    const result = await findGate('etcd-backup').evaluate(makeCtx(fetchJson));

    expect(result.status).not.toBe('passed');
  });
});

describe('secrets-mgmt gate', () => {
  it('detects an ExternalSecret under the current external-secrets.io/v1 (ESO 0.17+)', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path === '/apis/external-secrets.io/v1/externalsecrets') {
        return { items: [{ metadata: { name: 'db-creds' } }] };
      }
      return notFound();
    });

    const result = await findGate('secrets-mgmt').evaluate(makeCtx(fetchJson));

    expect(fetchJson).toHaveBeenCalledWith('/apis/external-secrets.io/v1/externalsecrets');
    expect(result.status).toBe('passed');
    expect(result.detail).toBe('1 ExternalSecret');
  });

  it('still detects a legacy external-secrets.io/v1beta1 ExternalSecret (ESO <0.17)', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path === '/apis/external-secrets.io/v1beta1/externalsecrets') {
        return { items: [{ metadata: { name: 'db-creds' } }] };
      }
      return notFound();
    });

    const result = await findGate('secrets-mgmt').evaluate(makeCtx(fetchJson));

    expect(fetchJson).toHaveBeenCalledWith('/apis/external-secrets.io/v1beta1/externalsecrets');
    expect(result.status).toBe('passed');
    expect(result.detail).toBe('1 ExternalSecret');
  });

  it('falls back to SealedSecrets when no ExternalSecret is found on either version', async () => {
    const fetchJson = vi.fn(async (path: string) => {
      if (path === '/apis/bitnami.com/v1alpha1/sealedsecrets') {
        return { items: [{ metadata: { name: 'sealed-1' } }] };
      }
      return notFound();
    });

    const result = await findGate('secrets-mgmt').evaluate(makeCtx(fetchJson));

    expect(result.status).toBe('passed');
    expect(result.detail).toBe('1 SealedSecret');
  });

  it('reports needs_attention when no external secrets operator is detected on any version', async () => {
    const fetchJson = vi.fn(async () => notFound());

    const result = await findGate('secrets-mgmt').evaluate(makeCtx(fetchJson));

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

describe('gate actions open the page that fixes them', () => {
  // A cluster with nothing configured, so every gate below wants an action.
  const empty = vi.fn(async (path: string) => {
    if (path.includes('clusterversions')) return { spec: { channel: 'candidate-4.16' }, status: { availableUpdates: [{ version: '4.16.1' }] } };
    if (path.includes('oauths')) return { spec: { identityProviders: [] } };
    if (path.includes('apiservers')) return { spec: { tlsSecurityProfile: { type: 'Old' }, encryption: { type: 'identity' } } };
    if (path.includes('ingresscontrollers')) return { spec: {}, status: {} };
    if (path.includes('ingresses')) return { spec: { domain: '' } };
    return { items: [] };
  }) as unknown as GateContext['fetchJson'];

  it.each([
    ['identity-providers', '/admin?tab=config'],
    ['tls-profile', '/admin?tab=config'],
    ['encryption', '/admin?tab=config'],
    ['resource-quotas', '/admin?tab=quotas'],
    ['limit-ranges', '/admin?tab=quotas'],
    ['update-channel', '/admin?tab=updates'],
    ['cluster-updated', '/admin?tab=updates'],
    ['ingress-cert', '/admin?tab=config'],
    ['custom-domain', '/admin?tab=config'],
    ['logging-operator', '/operators?q=cluster-logging'],
    ['coo', '/operators?q=observability'],
    ['etcd-backup', '/create/config.openshift.io~v1alpha1~backups'],
  ])('%s → %s', async (id, path) => {
    const result = await findGate(id).evaluate(makeCtx(empty));
    expect(result.action?.path).toBe(path);
  });
});

describe('cluster-updated gate', () => {
  const evaluate = (cv: unknown) => findGate('cluster-updated').evaluate(makeCtx(vi.fn(async () => cv) as GateContext['fetchJson']));

  it('is not a pass when the cluster could not retrieve updates (RetrievedUpdates=False)', async () => {
    const result = await evaluate({
      status: {
        availableUpdates: null,
        conditions: [{ type: 'RetrievedUpdates', status: 'False', reason: 'RemoteFailed', message: 'Unable to retrieve available updates: connection refused' }],
      },
    });
    expect(result.status).toBe('not_started');
    expect(result.detail).toMatch(/^Could not check/);
    expect(result.detail).toContain('connection refused');
    expect(result.detail).not.toMatch(/up to date/i);
  });

  it('counts conditional updates as available updates', async () => {
    const result = await evaluate({
      status: {
        availableUpdates: [],
        conditionalUpdates: [
          { release: { version: '4.16.9' }, risks: [{ name: 'SomeRisk' }], conditions: [{ type: 'Recommended', status: 'False' }] },
          { release: { version: '4.16.10' }, risks: [], conditions: [{ type: 'Recommended', status: 'True' }] },
        ],
        conditions: [{ type: 'RetrievedUpdates', status: 'True' }],
      },
    });
    expect(result.status).toBe('needs_attention');
    expect(result.detail).toBe('2 updates available');
  });

  it('does not double-count a version listed as both available and conditional', async () => {
    const result = await evaluate({
      status: {
        availableUpdates: [{ version: '4.16.10' }],
        conditionalUpdates: [{ release: { version: '4.16.10' }, conditions: [{ type: 'Recommended', status: 'True' }] }],
        conditions: [{ type: 'RetrievedUpdates', status: 'True' }],
      },
    });
    expect(result.detail).toBe('1 update available');
  });

  it('passes only when updates were retrieved and none are listed', async () => {
    const result = await evaluate({ status: { availableUpdates: null, conditions: [{ type: 'RetrievedUpdates', status: 'True' }] } });
    expect(result.status).toBe('passed');
    expect(result.detail).toBe('Up to date');
  });

  it.each([403, 500])('reports unknown, not up to date, when ClusterVersion read fails with %i', async (status) => {
    const fetchJson = vi.fn(async () => { throw Object.assign(new Error(`${status}`), { status }); }) as GateContext['fetchJson'];
    const result = await findGate('cluster-updated').evaluate(makeCtx(fetchJson));
    expect(result.status).toBe('not_started');
    expect(result.detail).not.toMatch(/up to date/i);
  });
});
