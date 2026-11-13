// @vitest-environment jsdom
/**
 * restart_consumers from chat: the card lists every workload the agent will restart
 * (order, strategy, Services, Argo CD owner), what it leaves alone, and the dry run;
 * an invalid preview cannot be approved; an older agent without a preview is said.
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

// The card's permission check (useCanI) only covers workload/node tools; restart_consumers is not checked here: the dry run as you is.
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));

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

const input = { kind: 'ConfigMap', name: 'api-cfg', namespace: 'payments' };
const goodPreview = {
  kind: 'restart_consumers', valid: true,
  target: { kind: 'ConfigMap', name: 'api-cfg', namespace: 'payments' },
  restart: [
    { kind: 'Deployment', name: 'worker', strategy: '2 · rolling, maxUnavailable 0, maxSurge 1', services: [], uses: ['envFrom: all keys in w'], gitops: 'payments-app' },
    { kind: 'StatefulSet', name: 'db', strategy: '3 · rolling one ordinal at a time, highest first', services: [], uses: ['volume mounted at /etc/my.cnf (subPath)'], gitops: null },
    { kind: 'Deployment', name: 'api', strategy: '3 · rolling, maxUnavailable 0, maxSurge 1', services: ['api'], uses: ['env CACHE_SIZE in api from key CACHE_SIZE via configMapKeyRef'], gitops: null },
  ],
  skipped: [{ kind: 'DaemonSet', name: 'agent', reason: 'DaemonSet uses the OnDelete update strategy' }],
  notRestarted: [{ kind: 'CronJob', name: 'nightly', pickUp: 'at the next scheduled run' }],
  incomplete: ['Jobs'],
  notScanned: 'bare Pods, other namespaces',
  orderUnknown: false,
  sequence: 'One after another in this order, without waiting for each rollout to finish.',
  dryRun: { passed: true, errors: [] },
  undo: 'A restart has no undo.',
};

describe('ConfirmationCard for restart_consumers', () => {
  it('lists every workload in order with strategy, Services and the Argo CD owner, and what it leaves alone', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'restart_consumers', input, nonce: 'n', preview: goodPreview }} onConfirm={onConfirm} />);
    const p = screen.getByTestId('restart-consumers-preview');
    const items = Array.from(p.querySelectorAll('ol > li')).map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Deployment worker');
    expect(items[0]).toContain('Managed by Argo CD (payments-app)');
    expect(items[1]).toContain('StatefulSet db');
    expect(items[2]).toContain('serves api');
    expect(p.textContent).toContain('agent: DaemonSet uses the OnDelete update strategy');
    expect(p.textContent).toContain('nightly: picks up changes at the next scheduled run');
    expect(p.textContent).toContain('Could not check Jobs: there may be more consumers.');
    expect(screen.getByText('Rolling-restart the workloads that use ConfigMap payments/api-cfg')).toBeTruthy();
    expect(screen.getByTestId('write-dry-run').textContent).toBe('Passed · the API server accepted all 3 restarts as you (dry run)');
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve high-risk operation' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('a refused dry run cannot be approved and names the workload; deny still works', () => {
    const onConfirm = vi.fn();
    const preview = { ...goodPreview, valid: false, error: 'The server-side dry run refused Deployment api', dryRun: { passed: false, errors: [{ kind: 'Deployment', name: 'api', error: 'admission webhook denied' }] } };
    render(<ConfirmationCard confirm={{ tool: 'restart_consumers', input, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(screen.getByRole('alert').textContent).toContain('dry run refused Deployment api');
    expect(screen.getByText('Dry run refused Deployment api: admission webhook denied')).toBeTruthy();
    expect(screen.getByTestId('write-dry-run').textContent).toBe('Failed · The server-side dry run refused Deployment api');
    const approve = screen.getByRole('button', { name: 'Approve high-risk operation' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deny operation' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('a refused restart is never auto-approved, even at a trust level that auto-approves', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 4, shouldAutoApprove: () => true };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'restart_consumers', input, nonce: 'n', preview: { kind: 'restart_consumers', valid: false, error: 'token forwarding is off' } }} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('token forwarding is off');
  });

  it('an older agent without a preview says the workloads are not listed, with no dry run', () => {
    render(<ConfirmationCard confirm={{ tool: 'restart_consumers', input, nonce: 'n' }} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('restart-consumers-preview').textContent).toContain('sent no preview');
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
  });

  it('says when Services could not be read', () => {
    const preview = { ...goodPreview, orderUnknown: true, restart: [{ ...goodPreview.restart[0], services: null }] };
    render(<ConfirmationCard confirm={{ tool: 'restart_consumers', input, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    const p = screen.getByTestId('restart-consumers-preview');
    expect(p.textContent).toContain('Services: could not check');
    expect(p.textContent).toContain('the order is as listed, not by traffic');
    expect(screen.getByTestId('write-dry-run').textContent).toBe('Passed · the API server accepted the restart as you (dry run)');
  });
});
