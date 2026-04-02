// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../ReadinessScore', () => ({
  ReadinessScore: ({ score }: { score: number }) => <div data-testid="readiness-score">Score: {score}</div>,
}));

vi.mock('../WaiverDialog', () => ({
  WaiverDialog: ({ open, gateTitle, onConfirm, onClose }: any) =>
    open ? (
      <div data-testid="waiver-dialog">
        <span>Waiver for {gateTitle}</span>
        <button onClick={() => onConfirm('test reason')}>Confirm Waiver</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock('../steps/CategoryStep', () => ({
  CategoryStep: ({ category, onReVerify, onWaive }: any) => (
    <div data-testid="category-step">
      <span>{category.label}</span>
      {category.gates.map((g: any) => (
        <div key={g.id}>
          <span>{g.title}</span>
          <button onClick={() => onReVerify?.(g.id)}>ReVerify-{g.id}</button>
          <button onClick={() => onWaive?.(g.id)}>Waive-{g.id}</button>
        </div>
      ))}
    </div>
  ),
}));

import { ReadinessWizard } from '../ReadinessWizard';
import type { CategoryView } from '../types';

function makeCategories(): CategoryView[] {
  return [
    { id: 'prerequisites', label: 'Prerequisites', description: 'Basics', gates: [{ id: 'g1', title: 'Gate 1', description: '', whyItMatters: '', category: 'prerequisites', priority: 'blocking', evaluate: vi.fn() }], results: {}, summary: { passed: 1, failed: 0, needs_attention: 0, not_started: 0, total: 1, score: 100 } },
    { id: 'security', label: 'Security', description: 'Auth', gates: [{ id: 'g2', title: 'Gate 2', description: '', whyItMatters: '', category: 'security', priority: 'blocking', evaluate: vi.fn() }], results: {}, summary: { passed: 0, failed: 1, needs_attention: 0, not_started: 0, total: 1, score: 0 } },
    { id: 'reliability', label: 'Reliability', description: 'HA', gates: [], results: {}, summary: { passed: 0, failed: 0, needs_attention: 0, not_started: 1, total: 1, score: 0 } },
    { id: 'observability', label: 'Observability', description: 'Mon', gates: [], results: {}, summary: { passed: 0, failed: 0, needs_attention: 0, not_started: 1, total: 1, score: 0 } },
    { id: 'operations', label: 'Operations', description: 'Ops', gates: [], results: {}, summary: { passed: 0, failed: 0, needs_attention: 0, not_started: 1, total: 1, score: 0 } },
    { id: 'gitops', label: 'GitOps', description: 'Git', gates: [], results: {}, summary: { passed: 0, failed: 0, needs_attention: 0, not_started: 1, total: 1, score: 0 } },
  ];
}

describe('ReadinessWizard', () => {
  const onWaive = vi.fn();
  const onReVerify = vi.fn();
  const onSwitchToChecklist = vi.fn();

  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders score component', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    expect(screen.getByTestId('readiness-score')).toBeDefined();
    expect(screen.getByText('Score: 75')).toBeDefined();
  });

  it('renders sidebar navigation with all category labels', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    // "Prerequisites" appears in both sidebar and CategoryStep, so use getAllByText
    expect(screen.getAllByText('Prerequisites').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Security').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Reliability').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Observability').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Operations').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('GitOps').length).toBeGreaterThanOrEqual(1);
  });

  it('shows step counter starting at 1 / 6', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    expect(screen.getByText('1 / 6')).toBeDefined();
  });

  it('starts on prerequisites step', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    const step = screen.getByTestId('category-step');
    expect(step.textContent).toContain('Prerequisites');
  });

  it('navigates to next step on Next click', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('2 / 6')).toBeDefined();
    const step = screen.getByTestId('category-step');
    expect(step.textContent).toContain('Security');
  });

  it('navigates back on Previous click', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Previous'));
    expect(screen.getByText('1 / 6')).toBeDefined();
  });

  it('Previous is disabled on first step', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    const prevBtn = screen.getByText('Previous');
    expect(prevBtn.hasAttribute('disabled')).toBe(true);
  });

  it('navigates to step via sidebar click', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    fireEvent.click(screen.getByText('Reliability'));
    expect(screen.getByText('3 / 6')).toBeDefined();
  });

  it('calls onSwitchToChecklist when switch link is clicked', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    fireEvent.click(screen.getByText('Switch to checklist view'));
    expect(onSwitchToChecklist).toHaveBeenCalled();
  });

  it('opens waiver dialog when waive is triggered from CategoryStep', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    fireEvent.click(screen.getByText('Waive-g1'));
    expect(screen.getByTestId('waiver-dialog')).toBeDefined();
  });

  it('calls onWaive when waiver is confirmed', () => {
    render(<ReadinessWizard score={75} categories={makeCategories()} onWaive={onWaive} onReVerify={onReVerify} onSwitchToChecklist={onSwitchToChecklist} />);
    fireEvent.click(screen.getByText('Waive-g1'));
    fireEvent.click(screen.getByText('Confirm Waiver'));
    expect(onWaive).toHaveBeenCalledWith('g1', 'test reason');
  });
});
