// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

/* ---- Mutable trust state ---- */

let mockTrustState = {
  trustLevel: 1,
  shouldAutoApprove: (_t: string, _r: string) => false,
  recordConfirmation: vi.fn(),
  history: [],
  setTrustLevel: vi.fn(),
  getUpgradeEligibility: () => ({
    eligible: false,
    currentLevel: 1,
    nextLevel: 2,
    consecutiveApprovals: 0,
    approvalsNeeded: 10,
  }),
  clearHistory: vi.fn(),
};

vi.mock('../../../store/trustStore', () => ({
  useTrustStore: vi.fn((selector: any) => {
    const state = mockTrustState;
    return typeof selector === 'function' ? selector(state) : state;
  }),
  TRUST_LABELS: { 0: 'Observe', 1: 'Confirm', 2: 'Batch', 3: 'Bounded' } as Record<number, string>,
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: vi.fn((selector: any) => {
    const state = { addToast: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

vi.mock('../../../hooks/useAgentSession', () => ({
  useAgentSession: vi.fn(() => ({
    connected: false,
    messages: [],
    streaming: false,
    streamingText: '',
    thinkingText: '',
    activeTools: [],
    streamingComponents: [],
    pendingConfirm: null,
    error: null,
    send: vi.fn(),
    confirm: vi.fn(),
    clear: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock('../MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: any) => <div>{content}</div>,
}));

import { ConfirmationCard } from '../ConfirmationCard';

afterEach(() => cleanup());

beforeEach(() => {
  mockTrustState = {
    trustLevel: 1,
    shouldAutoApprove: (_t: string, _r: string) => false,
    recordConfirmation: vi.fn(),
    history: [],
    setTrustLevel: vi.fn(),
    getUpgradeEligibility: () => ({
      eligible: false,
      currentLevel: 1,
      nextLevel: 2,
      consecutiveApprovals: 0,
      approvalsNeeded: 10,
    }),
    clearHistory: vi.fn(),
  };
});

const scaleConfirm = {
  tool: 'scale_deployment',
  input: { namespace: 'default', name: 'web', replicas: 3 },
};

const drainConfirm = {
  tool: 'drain_node',
  input: { node_name: 'node-1' },
};

describe('ConfirmationCard', () => {
  it('shows MEDIUM risk badge with amber color for scale_deployment', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    const badge = screen.getByText('MEDIUM RISK');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('amber');
  });

  it('shows HIGH risk badge with red color for drain_node', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={drainConfirm} onConfirm={onConfirm} />);
    const badge = screen.getByText('HIGH RISK');
    expect(badge).toBeTruthy();
    expect(badge.className).toContain('red');
  });

  it('shows impact description for scale_deployment', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByText('3 pod(s) will be scheduled')).toBeTruthy();
  });

  it('shows rollback info for scale_deployment', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByText('Scale back to the original replica count')).toBeTruthy();
  });

  it('shows "What If?" button', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByLabelText('Simulate impact')).toBeTruthy();
    expect(screen.getByText('What If?')).toBeTruthy();
  });

  it('keyboard Y calls onConfirm(true)', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('keyboard N calls onConfirm(false)', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('trust level 0 shows "Observe mode" text and no Approve button', () => {
    mockTrustState.trustLevel = 0;
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByText(/Observe mode/)).toBeTruthy();
    expect(screen.queryByLabelText('Approve operation (Y)')).toBeFalsy();
  });

  it('shows trust level label', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByText(/Trust: Confirm \(L1\)/)).toBeTruthy();
  });
});
