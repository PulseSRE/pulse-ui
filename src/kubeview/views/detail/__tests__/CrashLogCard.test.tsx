// @vitest-environment jsdom
/** "Log of the last crash": the previous instance's log; no previous instance is said in words, other failures are errors. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const k8sLogs = vi.fn();
vi.mock('../../../engine/query', async (orig) => ({ ...(await orig<object>()), k8sLogs: (...a: unknown[]) => k8sLogs(...a) }));

import { CrashLogCard } from '../PodEvidenceCards';

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
afterEach(() => cleanup());

const crashedPod = {
  apiVersion: 'v1', kind: 'Pod', metadata: { name: 'api-x', namespace: 'payments' },
  spec: { containers: [{ name: 'api', image: 'i', resources: { limits: { memory: '256Mi' } } }] },
  status: { containerStatuses: [{ name: 'api', ready: false, restartCount: 6, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: '2026-11-02T14:21:07Z' } } }] },
};

describe('CrashLogCard', () => {
  beforeEach(() => { k8sLogs.mockReset(); });
  const err = (statusCode: number) => Object.assign(new Error(`log read failed (${statusCode})`), { statusCode });
  it('shows the previous instance log of the container that crashed', async () => {
    k8sLogs.mockResolvedValue('14:21:06 WARN GC overhead limit approaching');
    wrap(<CrashLogCard pod={crashedPod as never} go={vi.fn()} />);
    expect(await screen.findByText('14:21:06 WARN GC overhead limit approaching')).toBeDefined();
    expect(k8sLogs).toHaveBeenCalledWith('payments', 'api-x', 'api', { tailLines: 40, previous: true }, 'local');
  });
  it.each([400, 404])('%s means no previous instance, said in words', async (code) => {
    k8sLogs.mockImplementation(async () => { throw err(code); });
    wrap(<CrashLogCard pod={crashedPod as never} go={vi.fn()} />);
    expect(await screen.findByText(/No log from a previous instance/)).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([403, 500])('%s is an error with Retry', async (code) => {
    k8sLogs.mockImplementation(async () => { throw err(code); });
    wrap(<CrashLogCard pod={crashedPod as never} go={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('The log could not be loaded');
  });
  it('a container that never restarted has no crash log and nothing is fetched', () => {
    wrap(<CrashLogCard pod={{ ...crashedPod, status: { containerStatuses: [{ name: 'api', ready: true, restartCount: 0 }] } } as never} go={vi.fn()} />);
    expect(screen.getByText(/has not restarted/)).toBeDefined();
    expect(k8sLogs).not.toHaveBeenCalled();
  });
  it('a restartPolicy: Never container that ended shows the log of that instance', async () => {
    k8sLogs.mockResolvedValue('fatal: missing DB_URL');
    wrap(<CrashLogCard pod={{ ...crashedPod, status: { phase: 'Failed', containerStatuses: [{ name: 'api', ready: false, restartCount: 0, state: { terminated: { reason: 'Error', exitCode: 1 } } }] } } as never} go={vi.fn()} />);
    expect(await screen.findByText('fatal: missing DB_URL')).toBeDefined();
    expect(k8sLogs).toHaveBeenCalledWith('payments', 'api-x', 'api', { tailLines: 40, previous: false }, 'local');
  });
});
