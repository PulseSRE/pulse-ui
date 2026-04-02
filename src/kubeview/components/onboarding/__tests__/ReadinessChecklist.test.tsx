// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../primitives/Card', () => ({
  Card: ({ children, className }: any) => <div data-testid="card" className={className}>{children}</div>,
}));

vi.mock('../../primitives/Badge', () => ({
  Badge: ({ children, variant, size }: any) => <span data-testid={`badge-${variant}`}>{children}</span>,
}));

vi.mock('../ReadinessScore', () => ({
  ReadinessScore: ({ score }: { score: number }) => <div data-testid="readiness-score">Score: {score}</div>,
}));

vi.mock('../GateCard', () => ({
  GateCard: ({ gate, result, onReVerify, onWaive }: any) => (
    <div data-testid={`gate-card-${gate.id}`}>
      <span>{gate.title}</span>
    </div>
  ),
}));

vi.mock('../WaiverDialog', () => ({
  WaiverDialog: ({ open, gateTitle, onConfirm, onClose }: any) =>
    open ? <div data-testid="waiver-dialog">Waiver for {gateTitle}</div> : null,
}));

import { ReadinessChecklist } from '../ReadinessChecklist';
import type { CategoryView } from '../types';

function makeCategories(): CategoryView[] {
  return [
    {
      id: 'prerequisites', label: 'Prerequisites', description: 'Cluster basics',
      gates: [{ id: 'g1', title: 'Gate 1', description: '', whyItMatters: '', category: 'prerequisites', priority: 'blocking', evaluate: vi.fn() }],
      results: { 'g1': { gateId: 'g1', status: 'passed', detail: 'OK', fixGuidance: '', evaluatedAt: Date.now() } },
      summary: { passed: 1, failed: 0, needs_attention: 0, not_started: 0, total: 1, score: 100 },
    },
    {
      id: 'security', label: 'Security', description: 'Auth gates',
      gates: [{ id: 'g2', title: 'Gate 2', description: '', whyItMatters: '', category: 'security', priority: 'blocking', evaluate: vi.fn() }],
      results: { 'g2': { gateId: 'g2', status: 'failed', detail: 'Missing', fixGuidance: '', evaluatedAt: Date.now() } },
      summary: { passed: 0, failed: 1, needs_attention: 0, not_started: 0, total: 1, score: 0 },
    },
  ];
}

describe('ReadinessChecklist', () => {
  const onWaive = vi.fn();
  const onReVerify = vi.fn();
  const onSwitchToWizard = vi.fn();

  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders all category labels', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    expect(screen.getByText('Prerequisites')).toBeDefined();
    expect(screen.getByText('Security')).toBeDefined();
  });

  it('renders score component in sidebar', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    expect(screen.getByTestId('readiness-score')).toBeDefined();
    expect(screen.getByText('Score: 50')).toBeDefined();
  });

  it('shows passed/failed badges', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    const successBadges = screen.getAllByTestId('badge-success');
    expect(successBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('badge-error')).toBeDefined();
  });

  it('auto-expands categories with failures', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    // Security has failures, so gate-card-g2 should be visible
    expect(screen.getByTestId('gate-card-g2')).toBeDefined();
  });

  it('does not auto-expand all-passing categories', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    // Prerequisites has no failures, should be collapsed
    expect(screen.queryByTestId('gate-card-g1')).toBeNull();
  });

  it('toggles category expansion on click', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    // Expand Prerequisites
    fireEvent.click(screen.getByText('Prerequisites'));
    expect(screen.getByTestId('gate-card-g1')).toBeDefined();
    // Collapse it
    fireEvent.click(screen.getByText('Prerequisites'));
    expect(screen.queryByTestId('gate-card-g1')).toBeNull();
  });

  it('shows Open guided wizard button and calls onSwitchToWizard', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    fireEvent.click(screen.getByText('Open guided wizard'));
    expect(onSwitchToWizard).toHaveBeenCalled();
  });

  it('shows pass counts in summary', () => {
    render(<ReadinessChecklist score={50} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToWizard={onSwitchToWizard} />);
    expect(screen.getByText('1/1')).toBeDefined();
    expect(screen.getByText('0/1')).toBeDefined();
  });
});
