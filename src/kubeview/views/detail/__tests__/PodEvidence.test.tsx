// @vitest-environment jsdom
/** Right column of the pod page: what changed, memory vs limit, the last crash's log — each honest on failure. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryRange = vi.fn();
let metricsLocal = true;
vi.mock('../../../components/metrics/prometheus', async (orig) => ({ ...(await orig<object>()), queryRange: (...a: unknown[]) => queryRange(...a), metricsAvailableFor: () => metricsLocal }));
vi.mock('../../../components/metrics/MetricsChart', () => ({ MetricsChart: ({ thresholds }: { thresholds: Array<{ label: string }> }) => <div data-testid="chart">{thresholds.map((t) => t.label).join(',')}</div> }));

import { ChangesCard } from '../ChangesCard';
import { MemoryCard } from '../PodEvidenceCards';
import { useUIStore } from '../../../store/uiStore';
import { useFleetStore } from '../../../store/fleetStore';

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

function changesReply(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body }) as never;
}

afterEach(() => { cleanup(); useFleetStore.setState({ activeClusterId: 'local' }); });

describe('ChangesCard', () => {
  const card = () => wrap(<ChangesCard namespace="payments" kind="Deployment" name="api" until={Date.parse('2026-11-02T15:00:00Z')} />);

  it('lists changes newest first with the actor, and notes sources it could not check and truncation', async () => {
    changesReply(200, {
      available: true, truncated: true, unreadable: ['Secret metadata', 'Argo Applications'],
      changes: [
        { at: '2026-11-02T14:01:00Z', kind: 'Deployment', namespace: 'payments', name: 'api', summary: 'Deployment api rolled out revision 14', actor: null, source: 'rollout' },
        { at: '2026-11-02T13:58:00Z', kind: 'ConfigMap', namespace: 'payments', name: 'api-cfg', summary: 'ConfigMap api-cfg edited', actor: 'alice', source: 'configmap' },
      ],
    });
    card();
    expect(await screen.findByText('Deployment api rolled out revision 14')).toBeDefined();
    expect(screen.getByText('· by alice')).toBeDefined();
    expect(screen.getByTestId('changes-unreadable').textContent).toContain("Couldn't check: Secret metadata, Argo Applications");
    expect(screen.getByTestId('changes-truncated').textContent).toBe('Showing the latest 500 changes.');
    const url = String((global.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]);
    expect(url).toContain('/api/agent/changes?namespace=payments&kind=Deployment&name=api&since=2026-11-02T09%3A00%3A00.000Z&until=2026-11-02T15%3A00%3A00.000Z');
  });

  it.each([
    [404, {}, 'Change history is unavailable on this agent'],
    [404, { code: 'resource_not_found' }, 'No change history: the resource no longer exists.'],
    [200, { available: false, changes: [] }, 'the agent cannot reach the cluster'],
  ])('%s %j is a muted note, not an error', async (status, body, text) => {
    changesReply(status, body);
    card();
    expect((await screen.findByTestId('changes-unavailable')).textContent).toContain(text);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('401 raises the session-expired prompt and says so', async () => {
    useUIStore.setState({ degradedReasons: new Set() } as never);
    changesReply(401, {});
    card();
    expect((await screen.findByTestId('changes-unavailable')).textContent).toContain('session has expired');
    expect([...(useUIStore.getState() as unknown as { degradedReasons: Set<string> }).degradedReasons]).toContain('session_expired');
  });

  it.each([[403, 'Permission denied (403): not allowed to list replicasets'], [500, 'Request failed (500)'], [502, 'Request failed (502)'], [400, 'Request failed (400)']])('%s is an error with Retry, never "no changes"', async (status, text) => {
    changesReply(status, { detail: status === 403 ? 'not allowed to list replicasets' : undefined });
    card();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(text);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByText(/No changes recorded/)).toBeNull();
  });

  it('on a remote cluster it is a muted note and nothing is requested', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    changesReply(200, { available: true, changes: [] });
    card();
    expect(screen.getByTestId('changes-unavailable').textContent).toContain('local cluster only');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('an empty window says so', async () => {
    changesReply(200, { available: true, changes: [] });
    card();
    expect(await screen.findByText('No changes recorded for Deployment api in the last 6h.')).toBeDefined();
  });
});

const crashedPod = {
  apiVersion: 'v1', kind: 'Pod', metadata: { name: 'api-x', namespace: 'payments' },
  spec: { containers: [{ name: 'api', image: 'i', resources: { limits: { memory: '256Mi' } } }] },
  status: { containerStatuses: [{ name: 'api', ready: false, restartCount: 6, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: '2026-11-02T14:21:07Z' } } }] },
};

describe('MemoryCard', () => {
  beforeEach(() => { metricsLocal = true; queryRange.mockReset(); });
  it('draws working set against the limit and lists revisions in the window', async () => {
    queryRange.mockResolvedValue([{ metric: { container: 'api' }, values: [[1, '100']] }]);
    wrap(<MemoryCard pod={crashedPod as never} revisions={[{ revision: '14', at: new Date(Date.now() - 3600_000).toISOString() }, { revision: '12', at: '2020-01-01T00:00:00Z' }]} />);
    expect((await screen.findByTestId('chart')).textContent).toBe('limit 256Mi');
    expect(screen.getByLabelText('Revisions in this window').textContent).toMatch(/^rev 14 at /);
  });
  it.each(['Prometheus query failed: 403 Forbidden', 'Prometheus query failed: 500 Internal Server Error'])('a failed query (%s) is an error, not an empty chart', async (msg) => {
    queryRange.mockRejectedValue(new Error(msg));
    wrap(<MemoryCard pod={crashedPod as never} />);
    expect((await screen.findByRole('alert')).textContent).toContain(msg);
  });
  it('a remote cluster says metrics are local-only and sends nothing', () => {
    metricsLocal = false;
    wrap(<MemoryCard pod={crashedPod as never} />);
    expect(screen.getByRole('note').textContent).toContain('available for the local cluster only');
    expect(queryRange).not.toHaveBeenCalled();
  });
});

