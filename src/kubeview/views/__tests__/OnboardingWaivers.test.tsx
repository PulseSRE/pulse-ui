// @vitest-environment jsdom
/**
 * Readiness waivers are kept (with reason and author) and counted the same way
 * on every recount, so re-verifying a gate cannot drop the score.
 *
 * These cover the fallback for an agent without `/readiness/waivers` (it
 * answers 404): waivers persist in this browser through the existing
 * onboarding store (localStorage key `openshiftpulse-onboarding`). The
 * agent-backed path is in OnboardingClusterWaivers.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));
vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: (s: { isHyperShift: boolean }) => unknown) => selector({ isHyperShift: false }),
}));
vi.mock('../../components/onboarding/InstallationReadinessPanel', () => ({ InstallationReadinessPanel: () => null }));

const k8sGet = vi.fn();
vi.mock('../../engine/query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../engine/query');
  return { ...actual, k8sGet: (...a: unknown[]) => k8sGet(...a) };
});

// An older agent: no waiver endpoint.
const agentFetch = vi.fn();
vi.mock('../../engine/safeQuery', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../engine/safeQuery');
  return { ...actual, agentFetch: (...a: unknown[]) => agentFetch(...a) };
});

const gate1 = vi.fn();
const evaluateAllGates = vi.fn();
vi.mock('../../engine/readiness/gates', () => ({
  ALL_GATES: [
    { id: 'gate-1', category: 'prerequisites', evaluate: (...a: unknown[]) => gate1(...a) },
    { id: 'gate-2', category: 'security', evaluate: vi.fn() },
  ],
  evaluateAllGates: (...a: unknown[]) => evaluateAllGates(...a),
}));

// The checklist is reduced to the two callbacks and what it is told.
vi.mock('../../components/onboarding/ReadinessChecklist', () => ({
  ReadinessChecklist: ({
    score,
    categories,
    onWaive,
    onReVerify,
  }: {
    score: number;
    categories: Array<{ results: Record<string, { status: string; detail: string }> }>;
    onWaive: (id: string, reason: string) => void;
    onReVerify: (id: string) => void;
  }) => {
    const results = Object.assign({}, ...categories.map((c) => c.results));
    return (
      <div>
        <span data-testid="score">{score}</span>
        <span data-testid="gate-2">{results['gate-2']?.status}: {results['gate-2']?.detail}</span>
        <button onClick={() => onWaive('gate-2', 'accepted risk until Q1')}>waive gate-2</button>
        <button onClick={() => onReVerify('gate-1')}>re-verify gate-1</button>
      </div>
    );
  },
}));

import OnboardingView from '../OnboardingView';
import { useOnboardingStore } from '../../store/onboardingStore';

const result = (gateId: string, status: string, detail = '') => ({ gateId, status, detail, fixGuidance: '', evaluatedAt: 0 });

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <OnboardingView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.setItem('openshiftpulse:onboarding-completed', 'true');
  useOnboardingStore.setState({ waivers: {} });
  k8sGet.mockResolvedValue({ metadata: { name: 'alice' } });
  evaluateAllGates.mockResolvedValue({ 'gate-1': result('gate-1', 'passed'), 'gate-2': result('gate-2', 'failed', 'No NetworkPolicy') });
  gate1.mockResolvedValue(result('gate-1', 'passed'));
  agentFetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('readiness waivers', () => {
  it('records the reason and who waived it, and counts the gate as passed', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('50'));
    await waitFor(() => expect(k8sGet).toHaveBeenCalledWith('/apis/user.openshift.io/v1/users/~', 'local'));
    fireEvent.click(screen.getByText('waive gate-2'));

    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('100'));
    expect(screen.getByTestId('gate-2').textContent).toBe('waived: Waived by alice: accepted risk until Q1');
    // Filed under the cluster the readiness checks describe.
    const saved = useOnboardingStore.getState().waivers['local/gate-2'];
    expect(saved).toMatchObject({ reason: 'accepted risk until Q1', approvedBy: 'alice' });
    expect(localStorage.getItem('openshiftpulse-onboarding')).toContain('accepted risk until Q1');
  });

  it('a waiver survives a reload', async () => {
    useOnboardingStore.setState({ waivers: { 'local/gate-2': { reason: 'accepted', waivedAt: 1, approvedBy: 'bob' } } });
    renderView();
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('100'));
    expect(screen.getByTestId('gate-2').textContent).toContain('Waived by bob: accepted');
  });

  it('re-verifying another gate does not drop the score', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('50'));
    fireEvent.click(screen.getByText('waive gate-2'));
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('100'));
    fireEvent.click(screen.getByText('re-verify gate-1'));
    await waitFor(() => expect(gate1).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('100'));
  });

  it('records no made-up author when the user cannot be looked up', async () => {
    k8sGet.mockRejectedValue(new Error('403'));
    renderView();
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('50'));
    fireEvent.click(screen.getByText('waive gate-2'));
    await waitFor(() => expect(screen.getByTestId('gate-2').textContent).toBe('waived: Waived: accepted risk until Q1'));
    expect(useOnboardingStore.getState().waivers['local/gate-2'].approvedBy).toBe('');
  });

  it('only asks the agent for its list, and writes nothing to it, on the fallback', async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('50'));
    fireEvent.click(screen.getByText('waive gate-2'));
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('100'));
    expect(agentFetch).toHaveBeenCalledTimes(1);
    expect(agentFetch).toHaveBeenCalledWith('/api/agent/readiness/waivers');
  });

  it("ignores another cluster's waivers", async () => {
    useOnboardingStore.setState({ waivers: { 'other-cluster/gate-2': { reason: 'theirs', waivedAt: 1, approvedBy: 'eve' } } });
    renderView();
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('50'));
    expect(screen.getByTestId('gate-2').textContent).toContain('failed');
  });

  it('Retry re-runs the evaluation instead of reloading the page', async () => {
    evaluateAllGates.mockRejectedValueOnce(new Error('agent unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderView();
    expect(await screen.findByText(/Evaluation failed: agent unreachable/)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByTestId('score').textContent).toBe('50'));
    expect(evaluateAllGates).toHaveBeenCalledTimes(2);
  });
});
