// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: any) => {
    const state = { isHyperShift: false };
    return selector(state);
  },
}));

vi.mock('../../engine/readiness/gates', () => ({
  ALL_GATES: [
    { id: 'gate-1', category: 'prerequisites', evaluate: vi.fn().mockResolvedValue({ status: 'passed', detail: '' }) },
    { id: 'gate-2', category: 'security', evaluate: vi.fn().mockResolvedValue({ status: 'failed', detail: '' }) },
  ],
  evaluateAllGates: vi.fn().mockResolvedValue({
    'gate-1': { status: 'passed', detail: 'OK' },
    'gate-2': { status: 'failed', detail: 'Missing' },
  }),
}));

vi.mock('../../components/onboarding/types', () => ({
  buildCategoryViews: vi.fn().mockReturnValue([
    { id: 'prerequisites', title: 'Prerequisites', gates: [], summary: { passed: 1, failed: 0, needs_attention: 0, not_started: 0, total: 1, score: 100 } },
  ]),
  computeScore: vi.fn().mockReturnValue(75),
}));

vi.mock('../../components/onboarding/ReadinessWizard', () => ({
  ReadinessWizard: ({ score }: { score: number }) => <div data-testid="readiness-wizard">Wizard score={score}</div>,
}));

vi.mock('../../components/onboarding/ReadinessChecklist', () => ({
  ReadinessChecklist: ({ score }: { score: number }) => <div data-testid="readiness-checklist">Checklist score={score}</div>,
}));

vi.mock('../../components/primitives/SectionHeader', () => ({
  SectionHeader: ({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) => (
    <div data-testid="section-header">
      <span>{title}</span>
      <span>{subtitle}</span>
      {actions}
    </div>
  ),
}));

import OnboardingView from '../OnboardingView';

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderView() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <OnboardingView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.removeItem('openshiftpulse:onboarding-completed'); } catch { /* noop */ }
  });
  afterEach(cleanup);

  it('renders page header', () => {
    renderView();
    expect(screen.getByText('Cluster Readiness')).toBeDefined();
    expect(screen.getByRole('region', { name: 'Agent installation readiness' })).toBeDefined();
  });

  it('renders subtitle', () => {
    renderView();
    expect(screen.getByText(/Evaluate production readiness/)).toBeDefined();
  });

  it('renders wizard/checklist mode toggle buttons', () => {
    renderView();
    expect(screen.getByText('Wizard')).toBeDefined();
    expect(screen.getByText('Checklist')).toBeDefined();
  });

  it('shows loading state initially', () => {
    // evaluateAllGates is async, so initially shows loading
    renderView();
    expect(screen.getByText(/Evaluating cluster readiness/)).toBeDefined();
  });

  it('shows wizard after evaluation completes for first-time user', async () => {
    renderView();
    const wizard = await screen.findByTestId('readiness-wizard');
    expect(wizard).toBeDefined();
  });

  it('shows checklist for returning user', async () => {
    localStorage.setItem('openshiftpulse:onboarding-completed', 'true');
    renderView();
    const checklist = await screen.findByTestId('readiness-checklist');
    expect(checklist).toBeDefined();
  });
});
