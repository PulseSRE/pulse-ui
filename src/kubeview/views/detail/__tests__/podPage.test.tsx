// @vitest-environment jsdom
/**
 * The pod page header and container cards (Wave 11): owner and
 * revision, node, last exit from lastState, restarts and memory p95 / limit;
 * per-container facts with links. A read that fails shows "unknown" and why,
 * never a number.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const readK8s = vi.fn();
const queryInstant = vi.fn();
let metricsLocal = true;
const askPulse = vi.fn();

vi.mock('../../../engine/readResult', async (orig) => ({ ...(await orig<object>()), readK8s: (...a: unknown[]) => readK8s(...a) }));
vi.mock('../../../components/metrics/prometheus', async (orig) => ({
  ...(await orig<object>()),
  queryInstant: (...a: unknown[]) => queryInstant(...a),
  metricsAvailableFor: () => metricsLocal,
}));
vi.mock('../../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sLogs: vi.fn().mockResolvedValue('') }));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../components/metrics/Sparkline', () => ({ MetricCard: () => null }));
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: false, isLoading: false }) }));

import { PodDetailLayout } from '../PodDetailLayout';
import { useAgentStore } from '../../../store/agentStore';
import { useFleetStore } from '../../../store/fleetStore';

const MiB = 1024 * 1024;

function makePod() {
  return {
    apiVersion: 'v1', kind: 'Pod',
    metadata: {
      name: 'api-7f9c4d-x2k8q', namespace: 'payments', uid: 'p1', creationTimestamp: '2026-11-02T10:00:00Z',
      ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'api-7f9c4d', controller: true, uid: 'rs1' }],
    },
    spec: {
      nodeName: 'worker-2',
      imagePullSecrets: [{ name: 'acme-quay' }],
      volumes: [
        { name: 'data', persistentVolumeClaim: { claimName: 'data-api' } },
        { name: 'cfg', configMap: { name: 'api-cfg' } },
      ],
      containers: [{
        name: 'api', image: 'quay.io/acme/api:1.8.2',
        resources: { limits: { cpu: '500m', memory: '256Mi' }, requests: { cpu: '250m', memory: '128Mi' } },
        readinessProbe: { httpGet: { path: '/healthz', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 1, failureThreshold: 3 },
        volumeMounts: [{ name: 'data', mountPath: '/data' }, { name: 'cfg', mountPath: '/etc/api' }],
        env: [{ name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db', key: 'pass' } } }],
      }],
    },
    status: {
      phase: 'Running',
      containerStatuses: [{
        name: 'api', ready: false, restartCount: 6,
        state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 2m40s restarting failed container' } },
        lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, startedAt: '2026-11-02T14:20:26Z', finishedAt: '2026-11-02T14:21:07Z' } },
      }],
    },
  };
}

const rs = {
  apiVersion: 'apps/v1', kind: 'ReplicaSet',
  metadata: { name: 'api-7f9c4d', namespace: 'payments', annotations: { 'deployment.kubernetes.io/revision': '14' }, ownerReferences: [{ kind: 'Deployment', name: 'api', controller: true }] },
};

function renderPage(go = vi.fn(), pod: unknown = makePod()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PodDetailLayout resource={pod as never} namespace="payments" events={[]} relatedResources={[]} metaTarget={{ apiPath: '/api/v1/namespaces/payments/pods/x', group: '', plural: 'pods' }} go={go} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return go;
}

beforeEach(() => {
  vi.clearAllMocks();
  metricsLocal = true;
  readK8s.mockResolvedValue({ state: 'ok', data: rs });
  queryInstant.mockImplementation(async (q: string) => (q.includes('memory') ? [{ metric: { container: 'api' }, value: 410 * MiB }] : [{ metric: { container: 'api' }, value: 0.2 }]));
});
afterEach(() => { cleanup(); useAgentStore.getState().setPageContext(null); useFleetStore.setState({ activeClusterId: 'local' }); });

describe('pod header', () => {
  it('shows owner with revision, node and the three tiles', async () => {
    const go = renderPage();
    expect(await screen.findByText('Deployment api')).toBeDefined();
    expect(screen.getByTestId('pod-lineage').textContent).toContain('(revision 14)');
    expect(screen.getByTestId('pod-lineage').textContent).toContain('node worker-2');
    expect(screen.getByText('OOMKilled · 137')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
    expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '410 Mi / 256 Mi')).toBeDefined();
    fireEvent.click(screen.getByText('Deployment api'));
    expect(go).toHaveBeenCalledWith('/r/apps~v1~deployments/payments/api', 'api');
    expect(readK8s).toHaveBeenCalledWith('/apis/apps/v1/namespaces/payments/replicasets/api-7f9c4d', 'local');
  });

  it('a forbidden ReplicaSet read keeps the ReplicaSet as owner and says the revision is unknown', async () => {
    readK8s.mockResolvedValue({ state: 'error', reason: 'Permission denied (403)' });
    renderPage();
    expect(await screen.findByText(/revision unknown: Permission denied \(403\)/)).toBeDefined();
    expect(screen.getByText('ReplicaSet api-7f9c4d')).toBeDefined();
    expect(screen.queryByText('Deployment api')).toBeNull();
  });

  it('a failed metrics query (500) shows memory as unknown with the reason, not a number', async () => {
    queryInstant.mockRejectedValue(new Error('Prometheus query failed: 500 Internal Server Error'));
    renderPage();
    expect(await screen.findByText(/Unknown: Prometheus query failed: 500/)).toBeDefined();
    expect(screen.queryByText(/410 Mi/)).toBeNull();
  });

  it('a forbidden metrics query (403) shows memory as unknown', async () => {
    queryInstant.mockRejectedValue(new Error('Prometheus query failed: 403 Forbidden'));
    renderPage();
    expect(await screen.findByText(/Unknown: Prometheus query failed: 403/)).toBeDefined();
  });

  it('a remote cluster says metrics are local-only without querying', () => {
    metricsLocal = false;
    renderPage();
    expect(screen.getByText('Unknown: metrics are only available for the local cluster')).toBeDefined();
    expect(queryInstant).not.toHaveBeenCalled();
  });

  it('no samples is unknown, not zero', async () => {
    queryInstant.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Unknown: no samples in the last 6h')).toBeDefined();
  });
});

describe('container section', () => {
  it('shows state, last termination with run time, image, resources, probe timing and links', () => {
    const go = renderPage();
    const card = screen.getByRole('region', { name: 'Container api' });
    const t = card.textContent ?? '';
    expect(t).toContain('Waiting · CrashLoopBackOff');
    expect(t).toMatch(/OOMKilled · exit 137 · .* · ran 41s/);
    expect(t).toContain('quay.io/acme/api:1.8.2');
    expect(t).toContain('cpu 500m / 250m · memory 256Mi / 128Mi');
    expect(t).toContain('HTTP /healthz :8080 · delay 5s · every 10s · timeout 1s · 3 failures');
    fireEvent.click(within(card).getByText('Secret acme-quay'));
    expect(go).toHaveBeenCalledWith('/r/v1~secrets/payments/acme-quay', 'acme-quay');
    fireEvent.click(within(card).getByText('PVC data-api'));
    expect(go).toHaveBeenCalledWith('/r/v1~persistentvolumeclaims/payments/data-api', 'data-api');
    fireEvent.click(within(card).getByText('ConfigMap api-cfg'));
    expect(go).toHaveBeenCalledWith('/r/v1~configmaps/payments/api-cfg', 'api-cfg');
    expect(within(card).getByText('Secret db')).toBeDefined();
  });
});

describe('chat context', () => {
  it('the page tells the dock it is about this pod, and the ask box sends it as context', () => {
    renderPage();
    expect(useAgentStore.getState().pageContext).toEqual({ kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments', gvr: 'v1/pods' });
    fireEvent.change(screen.getByLabelText('Question for Pulse'), { target: { value: 'why OOM?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(askPulse).toHaveBeenCalledWith('why OOM?', { kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments', gvr: 'v1/pods' });
  });

  it('leaving the page clears the context', () => {
    renderPage();
    cleanup();
    expect(useAgentStore.getState().pageContext).toBeNull();
  });
});

describe('review fixes (#186)', () => {
  it('Init:CrashLoopBackOff: the init container is the one shown, its restarts count, and it has a card marked init', async () => {
    const pod = makePod();
    (pod.spec as Record<string, unknown>).initContainers = [{ name: 'migrate', image: 'quay.io/acme/migrate:1', resources: { limits: { memory: '500M' } } }];
    pod.status = {
      phase: 'Pending',
      initContainerStatuses: [{ name: 'migrate', ready: false, restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'Error', exitCode: 2, startedAt: '2026-11-02T14:00:00Z', finishedAt: '2026-11-02T14:00:05Z' } } }],
      containerStatuses: [{ name: 'api', ready: false, restartCount: 0, state: { waiting: { reason: 'PodInitializing' } } }],
    } as never;
    queryInstant.mockImplementation(async (q: string) => (q.includes('memory') ? [{ metric: { container: 'migrate' }, value: 410 * MiB }] : []));
    renderPage(vi.fn(), pod);
    expect(screen.getByText('Error · 2')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getAllByText('init container migrate').length).toBeGreaterThan(0);
    const card = screen.getByRole('region', { name: 'Init container migrate' });
    expect(card.textContent).toContain('init');
    expect(card.textContent).toMatch(/Error · exit 2 · .* · ran 5s/);
    // Decimal limit (500M) read correctly and shown in the same units as p95.
    expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '410 Mi / 477 Mi')).toBeDefined();
  });

  it('a failed restartPolicy: Never pod shows how it ended though it never restarted', () => {
    const pod = makePod();
    pod.status = { phase: 'Failed', containerStatuses: [{ name: 'api', ready: false, restartCount: 0, state: { terminated: { reason: 'Error', exitCode: 1, startedAt: '2026-11-02T14:00:00Z', finishedAt: '2026-11-02T14:01:00Z' } } }] } as never;
    renderPage(vi.fn(), pod);
    expect(screen.getByText('Error · 1')).toBeDefined();
    expect(screen.getByRole('region', { name: 'Container api' }).textContent).toMatch(/Error · exit 1 · .* · ran 1m/);
  });

  it('a static pod links its owner to the cluster-scoped Node', () => {
    const pod = makePod();
    pod.metadata.ownerReferences = [{ apiVersion: 'v1', kind: 'Node', name: 'master-0', controller: true, uid: 'n' }];
    const go = renderPage(vi.fn(), pod);
    fireEvent.click(screen.getByText('Node master-0'));
    expect(go).toHaveBeenCalledWith('/r/v1~nodes/_/master-0', 'master-0');
    expect(readK8s).not.toHaveBeenCalled();
  });

  it('a custom-resource owner keeps its group and version', () => {
    const pod = makePod();
    pod.metadata.ownerReferences = [{ apiVersion: 'kubevirt.io/v1', kind: 'VirtualMachineInstance', name: 'vm-1', controller: true, uid: 'v' }];
    const go = renderPage(vi.fn(), pod);
    fireEvent.click(screen.getByText('VirtualMachineInstance vm-1'));
    expect(go).toHaveBeenCalledWith('/r/kubevirt.io~v1~virtualmachineinstances/payments/vm-1', 'vm-1');
  });

  it('shows ports and mounts', () => {
    const pod = makePod();
    (pod.spec.containers[0] as Record<string, unknown>).ports = [{ containerPort: 8080, name: 'http' }];
    renderPage(vi.fn(), pod);
    const t = screen.getByRole('region', { name: 'Container api' }).textContent ?? '';
    expect(t).toContain('8080/TCP (http)');
    expect(t).toContain('/data ← data');
  });

  it('on a remote cluster the ask box is disabled and says Pulse AI is local-only', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    renderPage();
    expect(screen.getByTestId('ask-pulse-note').textContent).toBe('Pulse AI answers about the local cluster only.');
    expect((screen.getByLabelText('Question for Pulse') as HTMLInputElement).disabled).toBe(true);
    expect(askPulse).not.toHaveBeenCalled();
  });
});
