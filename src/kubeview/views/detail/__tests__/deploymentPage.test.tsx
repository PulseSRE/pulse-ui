// @vitest-environment jsdom
/** The Deployment page has the same cause card, Diagnose, changes and fix (applied to itself), and chat context. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as F from './fixFixtures';

vi.mock('../../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sLogs: vi.fn().mockResolvedValue(''), k8sPatch: vi.fn() }));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../components/metrics/Sparkline', () => ({ MetricCard: () => null }));
vi.mock('../../../components/metrics/prometheus', async (orig) => ({
  ...(await orig<object>()),
  metricsAvailableFor: () => true,
  queryInstant: vi.fn(async (q: string) => (q.includes('memory') ? [{ metric: { container: 'api' }, value: 410 * 1024 * 1024 }] : [])),
}));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));

import { DeploymentDetailLayout, worstPod } from '../DeploymentDetailLayout';
import { useAgentStore } from '../../../store/agentStore';
import { useMonitorStore } from '../../../store/monitorStore';

beforeEach(() => {
  useMonitorStore.setState({ connected: true, connectionError: null, findings: [], dismissedFindingIds: [], investigations: [] });
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as never;
});
afterEach(() => { cleanup(); useAgentStore.getState().setPageContext(null); });

describe('Deployment page', () => {
  it('proposes the fix on the Deployment itself from its worst pod, and shows cause and changes cards', async () => {
    const healthy = { ...F.pod({ restartCount: 0, ready: true, state: { running: {} } }), metadata: { name: 'api-ok', namespace: 'payments' } };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DeploymentDetailLayout resource={F.oomOwner() as never} namespace="payments" managedPods={[healthy, F.oomPod()] as never} events={[]} metaTarget={{ apiPath: '/x', group: 'apps', plural: 'deployments' }} go={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await screen.findByTestId('primary-fix')).textContent).toContain('Raise the memory limit to 576Mi on Deployment api');
    expect(screen.getByText('No open monitor finding for this Deployment.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Diagnose' })).toBeDefined();
    expect((await screen.findByTestId('changes-unavailable')).textContent).toContain('unavailable on this agent');
    expect(useAgentStore.getState().pageContext).toMatchObject({ kind: 'Deployment', name: 'api', namespace: 'payments' });
  });

  it('a finding about one of its pods shows on the Deployment page', () => {
    useMonitorStore.setState({ findings: [{ id: 'f', severity: 'critical', category: 'oom', title: 'api-7f9c4d-x2k8q OOMKilled', summary: '', resources: [{ kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments' }], autoFixable: false, timestamp: Date.now() }] as never });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DeploymentDetailLayout resource={F.oomOwner() as never} namespace="payments" managedPods={[F.oomPod()] as never} events={[]} metaTarget={{ apiPath: '/x', group: 'apps', plural: 'deployments' }} go={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Pulse found a problem' })).toBeDefined();
    expect(screen.getByText('api-7f9c4d-x2k8q OOMKilled')).toBeDefined();
  });

  it('worstPod prefers a crash-looping pod and ignores healthy ones', () => {
    expect(worstPod([F.cpuPod(), F.oomPod()] as never)?.metadata.name).toBe('api-7f9c4d-x2k8q');
    expect(worstPod([{ ...F.pod({ restartCount: 0, ready: true }) }] as never)).toBeNull();
  });
});
