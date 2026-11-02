// @vitest-environment jsdom
/** A Job's attempts and a CronJob's runs lead to the failed pod's log on the page. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const k8sLogs = vi.fn();
let jobsResult: { data?: unknown[]; isLoading: boolean; isError?: boolean; error?: unknown; refetch?: () => void } = { data: [], isLoading: false };
vi.mock('../../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sLogs: (...a: unknown[]) => k8sLogs(...a) }));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => jobsResult }));

import { JobRuns } from '../JobRuns';
import { PulseError } from '../../../engine/errors';

const job = { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: 'report-28', namespace: 'ops', uid: 'j1' }, spec: {}, status: {} };
function pod(name: string, phase: string, created: string, exit?: number, owner = 'report-28') {
  return {
    apiVersion: 'v1', kind: 'Pod',
    metadata: { name, namespace: 'ops', uid: name, creationTimestamp: created, ownerReferences: [{ kind: 'Job', name: owner }] },
    spec: { containers: [{ name: 'main' }] },
    status: { phase, startTime: created, containerStatuses: [{ name: 'main', ready: false, restartCount: 0, state: exit !== undefined ? { terminated: { reason: exit ? 'Error' : 'Completed', exitCode: exit, finishedAt: created } } : {} }] },
  };
}

function renderIt(resource: unknown, pods: unknown[], go = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JobRuns resource={resource as never} managedPods={pods as never} go={go} />
    </QueryClientProvider>,
  );
  return go;
}

beforeEach(() => { vi.clearAllMocks(); jobsResult = { data: [], isLoading: false }; k8sLogs.mockResolvedValue('panic: cannot open /data/report.csv'); });
afterEach(cleanup);

describe('Job attempts', () => {
  it('lists attempts newest first and opens the latest failed attempt with its log', async () => {
    const go = renderIt(job, [pod('report-28-a', 'Failed', '2026-11-02T10:00:00Z', 1), pod('report-28-b', 'Failed', '2026-11-02T10:05:00Z', 2)]);
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    expect(screen.getByText('Error · exit 2')).toBeDefined();
    expect(await screen.findByText('panic: cannot open /data/report.csv')).toBeDefined();
    expect(k8sLogs).toHaveBeenCalledWith('ops', 'report-28-b', 'main', { tailLines: 60, previous: false }, 'local');
    expect(k8sLogs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('report-28-a'));
    expect(go).toHaveBeenCalledWith('/r/v1~pods/ops/report-28-a', 'report-28-a');
  });

  it('a log read that fails (403) shows the error with Retry, not an empty log', async () => {
    k8sLogs.mockRejectedValue(new PulseError({ message: 'pods "report-28-a" is forbidden', statusCode: 403 } as never));
    renderIt(job, [pod('report-28-a', 'Failed', '2026-11-02T10:00:00Z', 1)]);
    expect((await screen.findByRole('alert')).textContent).toContain('The log could not be loaded');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('says when no pods are left', () => {
    renderIt(job, []);
    expect(screen.getByText(/No pods: they may have been cleaned up/)).toBeDefined();
  });
});

describe('CronJob runs', () => {
  const cron = { apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'report', namespace: 'ops', uid: 'c1' }, spec: {} };
  const owned = (name: string, created: string, status: unknown) => ({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name, namespace: 'ops', uid: name, creationTimestamp: created, ownerReferences: [{ kind: 'CronJob', name: 'report', uid: 'c1' }] }, status });

  it('lists its Jobs, opens the failed run and shows its failed pod log', async () => {
    jobsResult = {
      isLoading: false,
      data: [
        owned('report-27', '2026-11-02T09:00:00Z', { conditions: [{ type: 'Complete', status: 'True' }] }),
        owned('report-28', '2026-11-02T10:00:00Z', { conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }] }),
        { ...owned('other-1', '2026-11-02T10:00:00Z', {}), metadata: { name: 'other-1', namespace: 'ops', ownerReferences: [{ kind: 'CronJob', name: 'other', uid: 'c2' }] } },
      ],
    };
    renderIt(cron, [pod('report-28-x', 'Failed', '2026-11-02T10:00:01Z', 1)]);
    expect(screen.getByText('2 jobs')).toBeDefined();
    expect(screen.queryByText('other-1')).toBeNull();
    expect(screen.getByText('BackoffLimitExceeded')).toBeDefined();
    expect(screen.getByText('Complete')).toBeDefined();
    expect(await screen.findByText('panic: cannot open /data/report.csv')).toBeDefined();
  });

  it('a forbidden Jobs list shows the error, not "no runs"', () => {
    jobsResult = { isLoading: false, isError: true, error: new Error('jobs.batch is forbidden'), data: undefined, refetch: vi.fn() };
    renderIt(cron, []);
    expect(screen.getByRole('alert').textContent).toContain('Runs could not be loaded');
    expect(screen.queryByText(/No runs kept/)).toBeNull();
  });
});
