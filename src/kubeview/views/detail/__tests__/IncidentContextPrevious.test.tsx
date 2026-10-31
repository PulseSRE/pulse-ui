// @vitest-environment jsdom
/** The incident card's "Previous" checkbox used to change nothing in the request. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const k8sLogs = vi.fn();
vi.mock('../../../engine/query', () => ({ k8sLogs: (...a: unknown[]) => k8sLogs(...a) }));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../components/metrics/Sparkline', () => ({ MetricCard: () => null }));

import { IncidentContext } from '../IncidentContext';

const pod = {
  apiVersion: 'v1', kind: 'Pod',
  metadata: { name: 'web-1', namespace: 'shop' },
  spec: { containers: [{ name: 'app' }] },
  status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: false, restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
};

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IncidentContext resource={pod as never} managedPods={[]} events={[]} namespace="shop" go={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); k8sLogs.mockResolvedValue('current line'); });
afterEach(() => cleanup());

describe('IncidentContext logs', () => {
  it('Previous instance requests previous=true logs', async () => {
    renderIt();
    await screen.findByText('current line');
    expect(k8sLogs).toHaveBeenLastCalledWith('shop', 'web-1', 'app', { tailLines: 80, previous: false }, 'local');
    k8sLogs.mockResolvedValue('before the crash');
    fireEvent.click(screen.getByLabelText('Previous instance'));
    await screen.findByText('before the crash');
    expect(k8sLogs).toHaveBeenLastCalledWith('shop', 'web-1', 'app', { tailLines: 80, previous: true }, 'local');
  });

  it('says when there is no previous instance instead of showing nothing', async () => {
    renderIt();
    await screen.findByText('current line');
    k8sLogs.mockRejectedValue(new Error('previous terminated container "app" not found'));
    fireEvent.click(screen.getByLabelText('Previous instance'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No logs from a previous instance/));
  });
});
