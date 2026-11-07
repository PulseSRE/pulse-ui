// @vitest-environment jsdom
/**
 * Every guided fix (memory, startup probe, CPU, pull secret, rollback) goes
 * through the same confirm: the exact diff, a dryRun=All request first, and
 * Apply only after it passes. Cancel sends nothing; a failed dry run keeps
 * Apply disabled; without RBAC the fix cannot be opened; a failed apply stays
 * in the dialog. The owner read failing (403/500) offers no fix, with why.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as F from './fixFixtures';

const readK8s = vi.fn();
const listK8s = vi.fn();
const k8sPatch = vi.fn();
const k8sGet = vi.fn();
const k8sList = vi.fn();
const k8sFetch = vi.fn();
let canPatch = true;
let rsData: unknown[] = [];
const askPulse = vi.fn();

vi.mock('../../../engine/readResult', async (orig) => ({ ...(await orig<object>()), readK8s: (...a: unknown[]) => readK8s(...a), listK8s: (...a: unknown[]) => listK8s(...a) }));
vi.mock('../../../engine/query', async (orig) => ({
  ...(await orig<object>()),
  k8sPatch: (...a: unknown[]) => k8sPatch(...a),
  k8sGet: (...a: unknown[]) => k8sGet(...a),
  k8sList: (...a: unknown[]) => k8sList(...a),
  k8sFetch: (...a: unknown[]) => k8sFetch(...a),
}));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: rsData, isLoading: false }) }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: canPatch, isLoading: false }) }));
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import { FixCard } from '../FixCard';
import { useFixWatchStore } from '../../../store/fixWatchStore';
import { PulseError } from '../../../engine/errors';

function pulseError(statusCode: number, message: string) {
  return new PulseError({ message, statusCode, category: 'unknown', context: {}, userMessage: message, suggestions: [] } as never);
}

interface Scenario { name: string; title: RegExp; pod: () => unknown; owner: () => unknown; usage?: unknown; watchable: boolean; targetPath: string; setup?: () => void }

const DEPLOY = '/apis/apps/v1/namespaces/payments/deployments/api';
const SA = '/api/v1/namespaces/payments/serviceaccounts/api-sa';
const scenarios: Scenario[] = [
  { name: 'memory limit', title: /Raise the memory limit to 576Mi/, pod: F.oomPod, owner: F.oomOwner, usage: F.oomUsage, watchable: true, targetPath: DEPLOY },
  { name: 'startup probe', title: /Add a startup probe/, pod: F.livenessPod, owner: F.livenessOwner, watchable: true, targetPath: DEPLOY },
  { name: 'CPU limit', title: /Raise the CPU limit to 800m/, pod: F.cpuPod, owner: F.cpuOwner, usage: F.cpuUsage, watchable: true, targetPath: DEPLOY },
  { name: 'pull secret', title: /Attach pull secret acme-quay/, pod: F.pullPod, owner: () => F.deployment({}), watchable: false, targetPath: SA },
  { name: 'rollback', title: /Roll back Deployment api to revision 13/, pod: F.rollbackPod, owner: F.rollbackOwner, watchable: true, targetPath: DEPLOY, setup: () => { rsData = F.replicaSets(); } },
];

function renderCard(s: Scenario) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FixCard pod={s.pod() as never} ownerApiPath={DEPLOY} usage={s.usage as never} events={[]} ownerPage={{ path: '/r/apps~v1~deployments/payments/api', label: 'Deployment api' }} go={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const realPatches = () => k8sPatch.mock.calls.filter((c) => !String(c[0]).includes('dryRun=All'));
const dryRuns = () => k8sPatch.mock.calls.filter((c) => String(c[0]).includes('dryRun=All'));

beforeEach(() => {
  vi.clearAllMocks();
  canPatch = true;
  rsData = [];
  listK8s.mockResolvedValue({ state: 'ok', data: [] });
  k8sFetch.mockImplementation(async (_c: string, path: string) => ({
    ok: true, status: 200,
    json: async () => ({ items: path.includes(encodeURIComponent('type=kubernetes.io/dockerconfigjson')) ? [{ metadata: { name: 'acme-quay' } }] : [] }),
  }));
  k8sPatch.mockResolvedValue({ metadata: { generation: 15 } });
  k8sList.mockResolvedValue([]);
});
afterEach(() => {
  for (const k of Object.keys(useFixWatchStore.getState().watches)) useFixWatchStore.getState().dismiss(k);
  cleanup();
});

describe.each(scenarios)('$name fix', (s) => {
  beforeEach(() => {
    s.setup?.();
    readK8s.mockImplementation(async (path: string) => (path === SA
      ? { state: 'ok', data: { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'api-sa', resourceVersion: '5' } } }
      : { state: 'ok', data: s.owner() }));
    k8sGet.mockResolvedValue(s.owner());
  });

  async function openReview() {
    const primary = await screen.findByTestId('primary-fix');
    expect(primary.textContent).toMatch(s.title);
    fireEvent.click(screen.getByRole('button', { name: 'Review and apply' }));
    return screen.findByRole('dialog');
  }

  it('confirm: dry run first, then the exact request to the owner on the pinned cluster', async () => {
    const dialog = await openReview();
    expect(dialog.textContent).toContain('What will change');
    await waitFor(() => expect(screen.getByTestId('write-dry-run').textContent).toBe('Passed · admitted by the API server'));
    expect(dryRuns()[0][0]).toBe(`${s.targetPath}?dryRun=All`);
    expect(dryRuns()[0][3]).toBe('local');
    expect(realPatches()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Apply to / }));
    await waitFor(() => expect(realPatches()).toHaveLength(1));
    const [path, body, type, cluster] = realPatches()[0];
    expect(path).toBe(s.targetPath);
    expect(type).toBe('application/json-patch+json');
    expect(cluster).toBe('local');
    expect((body as Array<{ op: string }>)[0].op).toBe('test');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const watches = Object.values(useFixWatchStore.getState().watches);
    expect(watches.length).toBe(s.watchable ? 1 : 0);
  });

  it('cancel sends nothing but the dry run', async () => {
    await openReview();
    await waitFor(() => expect(dryRuns()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(realPatches()).toHaveLength(0);
  });

  it('a failed dry run is shown and Apply stays disabled', async () => {
    k8sPatch.mockRejectedValue(pulseError(422, 'admission webhook "quota" denied the request'));
    await openReview();
    await waitFor(() => expect(screen.getByTestId('write-dry-run').textContent).toContain('Failed · admission webhook "quota" denied the request'));
    expect((screen.getByRole('button', { name: /^Apply to / }) as HTMLButtonElement).disabled).toBe(true);
    expect(realPatches()).toHaveLength(0);
  });

  it('RBAC-denied: the fix cannot be opened and says why', async () => {
    canPatch = false;
    renderCard(s);
    const btn = await screen.findByRole('button', { name: 'Review and apply' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You do not have permission to patch/)).toBeDefined();
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(k8sPatch).not.toHaveBeenCalled();
  });

  it('a failed apply (403) stays in the dialog', async () => {
    k8sPatch.mockImplementation(async (path: string) => {
      if (path.includes('dryRun=All')) return {};
      throw pulseError(403, 'forbidden: cannot patch');
    });
    await openReview();
    await waitFor(() => expect(screen.getByTestId('write-dry-run').textContent).toContain('Passed'));
    fireEvent.click(screen.getByRole('button', { name: /^Apply to / }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Apply failed: Permission denied: forbidden: cannot patch/);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(Object.keys(useFixWatchStore.getState().watches)).toHaveLength(0);
  });

  it.each([[409, 'Operation cannot be fulfilled: the object has been modified'], [422, 'the test operation failed: resourceVersion']])('an apply conflict (%s) says the object changed and nothing was changed', async (code, msg) => {
    k8sPatch.mockImplementation(async (path: string) => {
      if (path.includes('dryRun=All')) return {};
      throw pulseError(code, msg);
    });
    await openReview();
    await waitFor(() => expect(screen.getByTestId('write-dry-run').textContent).toContain('Passed'));
    fireEvent.click(screen.getByRole('button', { name: /^Apply to / }));
    expect((await screen.findByRole('alert')).textContent).toBe('Apply failed: The object changed since this page loaded it, so nothing was changed. Reload and try again.');
    expect(Object.keys(useFixWatchStore.getState().watches)).toHaveLength(0);
  });

  it('re-reads the owner when Review opens and builds the fix from it', async () => {
    await screen.findByTestId('primary-fix');
    const before = readK8s.mock.calls.filter((c) => c[0] === DEPLOY).length;
    fireEvent.click(screen.getByRole('button', { name: 'Review and apply' }));
    await screen.findByRole('dialog');
    expect(readK8s.mock.calls.filter((c) => c[0] === DEPLOY).length).toBe(before + 1);
    expect(readK8s).toHaveBeenLastCalledWith(expect.any(String), 'local');
  });

  // Render per test (describe.each beforeEach runs first).
  beforeEach(() => { if (!expect.getState().currentTestName?.includes('RBAC')) renderCard(s); });
});

describe('owner read', () => {
  it.each([[403, 'Permission denied (403)'], [500, 'Request failed (500)']])('an owner read that fails (%s) offers no fix and says why', async (_code, reason) => {
    readK8s.mockResolvedValue({ state: 'error', reason });
    renderCard(scenarios[0]);
    expect((await screen.findByRole('alert')).textContent).toContain(`No fix can be proposed: the owner could not be read${reason}`);
    expect(screen.queryByRole('button', { name: 'Review and apply' })).toBeNull();
  });

  it('renders the rule diagnoses and asks Pulse why with the pod as context', async () => {
    readK8s.mockResolvedValue({ state: 'ok', data: F.oomOwner() });
    renderCard(scenarios[0]);
    expect(await screen.findByText('Container api was killed due to OOM.')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Pulse why' }));
    expect(askPulse).toHaveBeenCalledWith(expect.stringMatching(/^Why "Raise the memory limit to 576Mi/), { kind: 'Pod', name: 'api-7f9c4d-x2k8q', namespace: 'payments' });
  });
});

describe('review details', () => {
  it('the pull secret list is metadata-only and covers both registry secret types', async () => {
    readK8s.mockImplementation(async (path: string) => (path === SA ? { state: 'ok', data: { metadata: { name: 'api-sa' } } } : { state: 'ok', data: F.deployment({}) }));
    renderCard(scenarios[3]);
    await screen.findByTestId('primary-fix');
    const paths = k8sFetch.mock.calls.map((c) => String(c[1]));
    expect(paths.some((p) => p.includes(encodeURIComponent('type=kubernetes.io/dockerconfigjson')))).toBe(true);
    expect(paths.some((p) => p.includes(encodeURIComponent('type=kubernetes.io/dockercfg')))).toBe(true);
    for (const c of k8sFetch.mock.calls) expect((c[2] as RequestInit).headers).toEqual({ Accept: 'application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1' });
  });

  it('a forbidden secret list is said, and no pull secret is proposed', async () => {
    k8sFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    readK8s.mockResolvedValue({ state: 'ok', data: F.deployment({}) });
    renderCard(scenarios[3]);
    expect(await screen.findByText(/could not be listed \(Permission denied \(403\)\)/)).toBeDefined();
  });

  it('when the owner changed so the fix no longer applies, Review says so and opens nothing', async () => {
    readK8s.mockResolvedValue({ state: 'ok', data: F.oomOwner() });
    renderCard(scenarios[0]);
    await screen.findByTestId('primary-fix');
    // A fresh owner without the OOM container's limit: no memory fix any more.
    readK8s.mockResolvedValue({ state: 'ok', data: F.deployment({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Review and apply' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/changed since this page loaded it, and this fix no longer applies/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the watch can be dismissed', async () => {
    readK8s.mockResolvedValue({ state: 'ok', data: F.oomOwner() });
    k8sGet.mockResolvedValue(F.oomOwner());
    useFixWatchStore.getState().start({ title: 'Raise memory', kind: 'Deployment', name: 'api', namespace: 'payments', apiPath: DEPLOY, clusterId: 'local', generation: 15 });
    renderCard(scenarios[0]);
    expect(await screen.findByTestId('fix-watch')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    await waitFor(() => expect(screen.queryByTestId('fix-watch')).toBeNull());
    expect(useFixWatchStore.getState().watches).toEqual({});
  });
});
