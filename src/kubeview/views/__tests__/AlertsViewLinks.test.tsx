// @vitest-environment jsdom
/**
 * Alert → resource links. `job` is the Prometheus scrape job, not a batch Job;
 * Node alerts carry the exporter's namespace, which a Node link must drop.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const goMock = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => selector({ addTab: vi.fn(), addToast: vi.fn(), setSelectedNamespace: vi.fn(), selectedNamespace: '*' }),
    { getState: () => ({ setSelectedNamespace: vi.fn(), addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(), impersonateUser: '', impersonateGroups: [] }) },
  ),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: () => null, Sparkline: () => null }));
vi.mock('../../components/metrics/prometheus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
queryRange: vi.fn().mockResolvedValue([]), getTimeRange: vi.fn().mockReturnValue([0, 1]) }));

const jsonHeaders = { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) };
function rulesWith(alerts: Array<{ name: string; labels: Record<string, string> }>) {
  return {
    data: {
      groups: [{
        name: 'g',
        rules: alerts.map((a) => ({
          name: a.name, query: 'q', state: 'firing', type: 'alerting', labels: { severity: 'warning' }, annotations: {},
          alerts: [{ labels: { alertname: a.name, severity: 'warning', ...a.labels }, annotations: {}, state: 'firing', activeAt: '2026-01-01T00:00:00Z' }],
        })),
      }],
    },
  };
}

import AlertsView from '../AlertsView';

function renderWith(alerts: Array<{ name: string; labels: Record<string, string> }>) {
  global.fetch = vi.fn((url: string) => Promise.resolve({
    ok: true,
    headers: jsonHeaders,
    json: () => Promise.resolve(url.includes('/rules') ? rulesWith(alerts) : []),
  })) as any;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter><AlertsView /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AlertsView resource links', () => {
  afterEach(() => { cleanup(); goMock.mockReset(); });

  it('links a Node alert to the cluster-scoped Node page', async () => {
    renderWith([{ name: 'NodeFilesystemFull', labels: { node: 'worker-1', namespace: 'openshift-monitoring', job: 'node-exporter' } }]);
    fireEvent.click(await screen.findByText('Node/worker-1'));
    expect(goMock).toHaveBeenCalledWith('/r/v1~nodes/_/worker-1', 'worker-1');
  });

  it('does not invent a batch Job from the scrape job label', async () => {
    renderWith([{ name: 'TargetDown', labels: { job: 'kube-state-metrics', namespace: 'openshift-monitoring' } }]);
    await screen.findAllByText('TargetDown');
    expect(screen.queryByText(/^Job\//)).toBeNull();
  });

  it('links a kube-state-metrics job_name to the batch Job', async () => {
    renderWith([{ name: 'KubeJobFailed', labels: { job_name: 'backup-1', namespace: 'ops', job: 'kube-state-metrics' } }]);
    fireEvent.click(await screen.findByText('Job/backup-1'));
    expect(goMock).toHaveBeenCalledWith('/r/batch~v1~jobs/ops/backup-1', 'backup-1');
  });

  it('a Deployment alert links to apps/v1', async () => {
    renderWith([{ name: 'KubeDeploymentReplicasMismatch', labels: { deployment: 'web', namespace: 'shop' } }]);
    fireEvent.click(await screen.findByText('Deployment/web'));
    expect(goMock).toHaveBeenCalledWith('/r/apps~v1~deployments/shop/web', 'web');
  });
});
