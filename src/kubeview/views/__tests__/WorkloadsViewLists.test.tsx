// @vitest-environment jsdom
/**
 * Workloads page: StatefulSets, DaemonSets, CronJobs and Jobs have lists
 * (not only counts), every row carries the actions menu, and each issue
 * banner opens the list it counts, filtered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { installFetch, setAllow, writes, renderWithProviders } from '../../components/workloads/__tests__/actionHarness';

const mockData: Record<string, unknown[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: mockData[apiPath] || [], isLoading: false }),
}));
const goMock = vi.fn();
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div> }));

import WorkloadsView from '../WorkloadsView';
import { useUIStore } from '../../store/uiStore';

beforeEach(() => {
  installFetch();
  setAllow({ 'patch/statefulsets': true, 'patch/cronjobs': true, 'create/jobs': true, 'patch/daemonsets': true });
  useUIStore.setState({ selectedNamespace: '*' } as never);
  Object.assign(mockData, {
    '/apis/apps/v1/statefulsets': [
      { apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: 'db', namespace: 'shop', uid: 's1', resourceVersion: '2' }, spec: { replicas: 3 }, status: { readyReplicas: 1 } },
      { apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: 'cache', namespace: 'shop', uid: 's2' }, spec: { replicas: 1 }, status: { readyReplicas: 1 } },
    ],
    '/apis/apps/v1/daemonsets': [
      { apiVersion: 'apps/v1', kind: 'DaemonSet', metadata: { name: 'agent', namespace: 'ops', uid: 'd1' }, status: { numberReady: 4, desiredNumberScheduled: 5 } },
    ],
    '/apis/batch/v1/cronjobs': [
      { apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'nightly', namespace: 'shop', uid: 'c1' }, spec: { schedule: '0 2 * * *', suspend: true, jobTemplate: { spec: {} } } },
    ],
    '/apis/batch/v1/jobs': [
      { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: 'migrate', namespace: 'shop', uid: 'j1' }, spec: { completions: 1 }, status: { conditions: [{ type: 'Failed', status: 'True' }] } },
      { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: 'backfill', namespace: 'shop', uid: 'j2' }, spec: { completions: 1 }, status: { succeeded: 1 } },
    ],
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); goMock.mockReset(); Object.keys(mockData).forEach((k) => delete mockData[k]); });

describe('Workloads lists', () => {
  it('lists StatefulSets, DaemonSets, CronJobs and Jobs with their state', () => {
    renderWithProviders(<WorkloadsView />);
    expect(screen.getByText('StatefulSets (2)')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByText('4/5 nodes')).toBeTruthy();
    expect(screen.getByText('0 2 * * *')).toBeTruthy();
    expect(screen.getByText('suspended')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^agent/ }));
    expect(goMock).toHaveBeenCalledWith('/r/apps~v1~daemonsets/ops/agent', 'agent');
  });

  it('each row has the actions menu: a CronJob row can be triggered', async () => {
    renderWithProviders(<WorkloadsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for CronJob nightly' }));
    const item = () => within(screen.getByRole('menu')).getByRole('menuitem', { name: /Trigger now/ }) as HTMLButtonElement;
    await waitFor(() => expect(item().disabled).toBe(false));
    fireEvent.click(item());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/apis/batch/v1/namespaces/shop/jobs' });
  });

  it('the "not ready" StatefulSet banner filters the StatefulSet list', () => {
    renderWithProviders(<WorkloadsView />);
    expect(screen.getByRole('button', { name: /^cache/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /1 StatefulSet not ready/ }));
    expect(screen.queryByRole('button', { name: /^cache/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^db/ })).toBeTruthy();
  });

  it('the failed-jobs banner filters the Jobs list to failed ones', () => {
    renderWithProviders(<WorkloadsView />);
    fireEvent.click(screen.getByRole('button', { name: /1 failed job/ }));
    expect(screen.queryByRole('button', { name: /^backfill/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^migrate/ })).toBeTruthy();
  });

  it('the CrashLoopBackOff banner opens the pod list filtered to it', () => {
    mockData['/api/v1/pods'] = [{
      metadata: { name: 'p', namespace: 'shop', uid: 'p1' },
      status: { phase: 'Running', containerStatuses: [{ name: 'c', restartCount: 9, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
    }];
    renderWithProviders(<WorkloadsView />);
    fireEvent.click(screen.getByRole('button', { name: /pod in CrashLoopBackOff/ }));
    expect(goMock).toHaveBeenCalledWith('/r/v1~pods?q=CrashLoopBackOff', 'Pods (CrashLoopBackOff)');
  });
});
