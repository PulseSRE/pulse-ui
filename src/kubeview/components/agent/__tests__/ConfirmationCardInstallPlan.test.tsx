// @vitest-environment jsdom
/**
 * InstallPlan approvals from chat: the card shows the agent's preview (the CSVs
 * installed and replaced, the resources applied, the resourceVersion it is held
 * to, the server's dry run, GitOps ownership); a refused preview cannot be
 * approved, it is never auto-approved, and a missing preview is said.
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

const canI = vi.hoisted(() => ({ allowed: true, calls: [] as unknown[][] }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: (...args: unknown[]) => { canI.calls.push(args); return { allowed: canI.allowed, isLoading: false }; } }));

import { ConfirmationCard } from '../ConfirmationCard';

afterEach(() => cleanup());

beforeEach(() => {
  canI.allowed = true;
  canI.calls.length = 0;
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

const input = { namespace: 'openshift-operators', name: 'install-new', resource_version: '1001' };
const preview = {
  kind: 'installplan_approve', valid: true, approvedBy: 'alice@acme.com', namespace: 'openshift-operators', name: 'install-new',
  resourceVersion: '1001', currentResourceVersion: '1001', operator: 'elasticsearch-operator', subscription: 'es-operator', channel: 'stable-5.8',
  phase: 'RequiresApproval', installs: ['es-operator.v5.8.2'], replaces: ['es-operator.v5.8.1'], current: true,
  steps: [{ kind: 'ClusterServiceVersion', name: 'es-operator.v5.8.2' }, { kind: 'CustomResourceDefinition', name: 'elasticsearches.logging.openshift.io' }],
  stepCount: 2, crdCount: 1, gitops: null, undo: 'x', noDeny: "OLM has no 'deny' for an InstallPlan.", dryRun: 'passed',
};

describe('ConfirmationCard for InstallPlan approvals', () => {
  it('shows what the plan installs and replaces, the rv it is held to and the server dry run', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n', preview }} onConfirm={onConfirm} />);
    const p = screen.getByTestId('installplan-preview');
    expect(p.textContent).toContain('- es-operator.v5.8.1');
    expect(p.textContent).toContain('+ es-operator.v5.8.2');
    expect(p.textContent).toContain('1001');
    expect(p.textContent).toContain('Applies 2 resources, including 1 CustomResourceDefinition');
    expect(p.textContent).toContain("no 'deny'");
    expect(screen.getByTestId('write-dry-run').textContent).toContain('admitted by the API server');
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    expect(screen.getByText(/OLM cannot un-approve/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve high-risk operation' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('checks the person may patch InstallPlans in that namespace, and blocks approval when not', () => {
    canI.allowed = false;
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    expect(canI.calls.some((a) => a[0] === 'patch' && a[1] === 'operators.coreos.com' && a[2] === 'installplans' && a[3] === 'openshift-operators')).toBe(true);
    expect(screen.getByText(/You do not have permission to patch installplans in openshift-operators/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve high-risk operation' })).toBeNull();
  });

  it('a refused preview cannot be approved and shows the reason as the dry run', () => {
    const onConfirm = vi.fn();
    const bad = { ...preview, valid: false, error: 'InstallPlan changed since it was reviewed', dryRun: undefined };
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n', preview: bad }} onConfirm={onConfirm} />);
    expect(screen.getByRole('alert').textContent).toContain('changed since it was reviewed');
    expect(screen.getByTestId('write-dry-run').textContent).toBe('Failed · InstallPlan changed since it was reviewed');
    const approve = screen.getByRole('button', { name: 'Approve high-risk operation' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('is never auto-approved, even when the trust level auto-approves everything', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 4, shouldAutoApprove: () => true };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('installplan-preview')).toBeTruthy();
  });

  it('names a GitOps owner, and says what is missing without a preview', () => {
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n', preview: { ...preview, gitops: "Subscription 'es-operator' is managed by Argo CD application 'operators'." } }} onConfirm={vi.fn()} />);
    expect(screen.getByText(/managed by Argo CD application 'operators'/)).toBeTruthy();
    cleanup();
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n' }} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('installplan-preview').textContent).toContain('sent no preview');
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
  });

  it('in observe mode the approval is not offered', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 0 };
    render(<ConfirmationCard confirm={{ tool: 'approve_installplan', input, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Approve high-risk operation' })).toBeNull();
    expect(screen.getByText(/Observe mode/)).toBeTruthy();
  });
});
