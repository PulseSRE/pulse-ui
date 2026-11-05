// @vitest-environment jsdom
/**
 * Silence writes from chat: the card shows the agent's preview (exact matchers,
 * end time, who it is created as, what it hides, undo); an invalid preview
 * cannot be approved, and an older agent's missing preview is said, not hidden.
 */
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

const createInput = { matchers: 'node="worker-5", alertname=~"KubeNodeUnreachable|KubeletDown"', duration_minutes: 120, comment: 'Planned disk replacement' };
const goodPreview = {
  kind: 'silence_create', valid: true,
  matchers: [{ name: 'node', value: 'worker-5', isRegex: false, isEqual: true, text: 'node="worker-5"' }, { name: 'alertname', value: 'KubeNodeUnreachable|KubeletDown', isRegex: true, isEqual: true, text: 'alertname=~"KubeNodeUnreachable|KubeletDown"' }],
  durationMinutes: 120, duration: '2 hours', startsAt: '2026-11-05T14:35:00Z', endsAt: '2026-11-05T16:35:00Z',
  createdBy: 'alice@acme.com', comment: 'Planned disk replacement',
  hides: [{ alertname: 'KubeNodeUnreachable', severity: 'warning' }, { alertname: 'KubeletDown', severity: 'warning' }],
};

describe('ConfirmationCard for silences', () => {
  it('shows the preview: matchers, duration, creator, comment and what it hides', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'create_silence', input: createInput, nonce: 'n', preview: goodPreview }} onConfirm={onConfirm} />);
    const p = screen.getByTestId('silence-preview');
    expect(p.textContent).toContain('+ node="worker-5"');
    expect(p.textContent).toContain('+ alertname=~"KubeNodeUnreachable|KubeletDown"');
    expect(p.textContent).toContain('2 hours, until');
    expect(p.textContent).toContain('alice@acme.com');
    expect(p.textContent).toContain('KubeletDown');
    expect(p.textContent).toContain('Expire it any time');
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve high-risk operation' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('an invalid preview cannot be approved and says why; deny still works', () => {
    const onConfirm = vi.fn();
    const preview = { kind: 'silence_create', valid: false, error: 'These matchers would match every alert' };
    render(<ConfirmationCard confirm={{ tool: 'create_silence', input: { ...createInput, matchers: 'alertname=~".*"' }, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(screen.getByRole('alert').textContent).toContain('would match every alert');
    const approve = screen.getByRole('button', { name: 'Approve high-risk operation' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deny operation' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('when the firing alerts could not be read it says "Could not check", not "nothing"', () => {
    render(<ConfirmationCard confirm={{ tool: 'create_silence', input: createInput, nonce: 'n', preview: { ...goodPreview, hides: null, hidesError: 'Alertmanager refused this (403)' } }} onConfirm={vi.fn()} />);
    expect(screen.getByText(/Could not check: Alertmanager refused this \(403\)/)).toBeTruthy();
    expect(screen.queryByText(/No alert firing now matches/)).toBeNull();
  });

  it('an older agent without a preview shows the input and says what is missing', () => {
    render(<ConfirmationCard confirm={{ tool: 'create_silence', input: createInput, nonce: 'n' }} onConfirm={vi.fn()} />);
    const p = screen.getByTestId('silence-preview');
    expect(p.textContent).toContain('node="worker-5", alertname=~"KubeNodeUnreachable|KubeletDown"');
    expect(p.textContent).toContain('you (the signed-in user)');
    expect(p.textContent).toContain('sent no preview');
  });

  it('expire shows the silence it ends', () => {
    const preview = { kind: 'silence_expire', valid: true, silenceId: 's', state: 'active', matchers: [{ text: 'node="worker-5"' }], createdBy: 'dave', comment: 'disk', endsAt: '' };
    render(<ConfirmationCard confirm={{ tool: 'expire_silence', input: { silence_id: 's' }, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    const p = screen.getByTestId('silence-preview');
    expect(p.textContent).toContain('node="worker-5"');
    expect(p.textContent).toContain('Created by dave: disk');
    expect(screen.getByText('MEDIUM RISK')).toBeTruthy();
  });

  it('a refused silence is never auto-approved, even at a trust level that auto-approves', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 4, shouldAutoApprove: () => true };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'create_silence', input: createInput, nonce: 'n', preview: { kind: 'silence_create', valid: false, error: 'no' } }} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('silence-preview')).toBeTruthy();
  });
});
