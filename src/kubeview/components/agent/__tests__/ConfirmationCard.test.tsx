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

/* ---- The person's permission (SelfSubjectAccessReview) ---- */
let mockCan = { allowed: true, isLoading: false };
const canICalls: unknown[][] = [];
vi.mock('../../../hooks/useCanI', () => ({
  useCanI: (...args: unknown[]) => { canICalls.push(args); return mockCan; },
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
  mockCan = { allowed: true, isLoading: false };
  canICalls.length = 0;
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

  it.each(['y', 'Y'])('Observe blocks keyboard %s approval', (key) => {
    mockTrustState.trustLevel = 0;
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(mockTrustState.recordConfirmation).not.toHaveBeenCalled();
  });

  it('revokes keyboard approval when switching an open card to Observe', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    mockTrustState.trustLevel = 0;
    rerender(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'n' });
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('shows trust level label', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByText(/Trust: Confirm \(L1\)/)).toBeTruthy();
  });

  it('says where the write lands and as whom, with the tool parameters and no dry run', () => {
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('write-where').textContent).toMatch(/^default · cluster .+ · acting as you, through the agent/);
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
    expect(screen.getByLabelText('Parameters').textContent).toContain('"replicas": 3');
  });

  it('RBAC-denied: no Approve, Y does nothing, N still denies, and it says why', () => {
    mockCan = { allowed: false, isLoading: false };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    // Asked for the exact call the agent will make with the person's token.
    expect(canICalls[0].slice(0, 5)).toEqual(['patch', 'apps', 'deployments', 'default', 'scale']);
    expect(screen.getByText(/You do not have permission to patch deployments\/scale in default/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'n' });
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('while the permission check runs, nothing can approve', () => {
    mockCan = { allowed: false, isLoading: true };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={scaleConfirm} onConfirm={onConfirm} />);
    expect(screen.getByText('Checking your permission…')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a tool with no known access review is left to the API server', () => {
    mockCan = { allowed: false, isLoading: false };
    render(<ConfirmationCard confirm={{ tool: 'apply_yaml', input: { yaml: 'kind: ConfigMap' } }} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeTruthy();
  });
});
