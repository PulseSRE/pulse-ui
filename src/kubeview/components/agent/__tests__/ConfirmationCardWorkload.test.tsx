// @vitest-environment jsdom
/**
 * Workload writes from chat (patch_workload_container, scale/restart/rollback_workload):
 * the card shows the agent's `workload_change` preview as the same before/after
 * diff the pod page's guided fixes show, the API server's dry run, impact and
 * undo; a refused preview cannot be approved; a GitOps-managed object is called
 * out and never auto-approved; an older agent's missing preview is said.
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

const canI = vi.fn((..._args: unknown[]) => ({ allowed: true, isLoading: false }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: (...args: unknown[]) => canI(...args) }));

import { ConfirmationCard } from '../ConfirmationCard';

afterEach(() => cleanup());

beforeEach(() => {
  canI.mockClear();
  canI.mockImplementation(() => ({ allowed: true, isLoading: false }));
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

const patchInput = { kind: 'Deployment', namespace: 'payments', name: 'api', memory_limit: '768Mi', reason: 'OOMKilled' };
const patchPreview = {
  kind: 'workload_change', tool: 'patch_workload_container', valid: true,
  target: { kind: 'Deployment', namespace: 'payments', name: 'api', container: 'api' },
  summary: 'Set memory limit 768Mi on Deployment api (container api)',
  diffHeader: 'Deployment api · containers[api]',
  diff: [{ field: 'resources.limits.memory', before: '512Mi', after: '768Mi' }],
  dryRun: { state: 'passed', message: 'Passed: the API server accepts this change (dryRun=All)' },
  impact: 'Rolling restart of 3 pods (maxUnavailable 1, maxSurge 25%)',
  undo: 'Roll back to the revision before this change (revision 4) in Rollout History on Deployment api',
  gitops: null, warnings: [], protectedNamespace: false,
  patch: { method: 'PATCH', path: '/apis/apps/v1/namespaces/payments/deployments/api', type: 'application/json-patch+json', body: [] },
};

describe('ConfirmationCard for workload writes', () => {
  it('shows the dry-run diff, impact, dry run and undo from the preview', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: patchInput, nonce: 'n', preview: patchPreview }} onConfirm={onConfirm} />);
    const diff = screen.getByLabelText('What will change');
    expect(diff.textContent).toContain('Deployment api · containers[api]');
    expect(diff.textContent).toContain('-   resources.limits.memory: 512Mi');
    expect(diff.textContent).toContain('+   resources.limits.memory: 768Mi');
    expect(screen.getByTestId('write-dry-run').textContent).toBe('Passed: the API server accepts this change (dryRun=All)');
    expect(screen.getByText('Rolling restart of 3 pods (maxUnavailable 1, maxSurge 25%)')).toBeTruthy();
    expect(screen.getByText(/revision 4/)).toBeTruthy();
    expect(screen.getByText(/Change Deployment payments\/api: memory limit 768Mi/)).toBeTruthy();
    expect(screen.queryByTestId('workload-change-notes')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve operation (Y)' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('checks the person may patch that kind in that namespace', () => {
    render(<ConfirmationCard confirm={{ tool: 'scale_workload', input: { kind: 'StatefulSet', namespace: 'db', name: 'pg', replicas: 5 }, nonce: 'n' }} onConfirm={vi.fn()} />);
    expect(canI).toHaveBeenCalledWith('patch', 'apps', 'statefulsets', 'db', 'scale', expect.anything());
    cleanup();
    canI.mockImplementation(() => ({ allowed: false, isLoading: false }));
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: patchInput, nonce: 'n', preview: patchPreview }} onConfirm={vi.fn()} />);
    expect(screen.getByText(/You do not have permission to patch deployments in payments/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve operation (Y)' })).toBeNull();
  });

  it('a refused preview cannot be approved and says why; the dry run shows the failure', () => {
    const onConfirm = vi.fn();
    const preview = { ...patchPreview, valid: false, error: undefined, diff: [], dryRun: { state: 'failed', message: 'Dry run refused by the API server: exceeded quota: compute-resources' } };
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: patchInput, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(screen.getByRole('alert').textContent).toContain('exceeded quota');
    expect(screen.getByTestId('write-dry-run').textContent).toContain('Dry run refused');
    const approve = screen.getByRole('button', { name: 'Approve operation (Y)' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deny operation (N)' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('an input error is shown as the refusal, with no diff', () => {
    const preview = { kind: 'workload_change', tool: 'patch_workload_container', valid: false, error: "memory_limit '512' is under 4Mi; a quantity without a unit is bytes. Did you mean 512Mi?", diff: [], dryRun: { state: 'unavailable', message: '' }, warnings: [], gitops: null };
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: { ...patchInput, memory_limit: '512' }, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Did you mean 512Mi?');
    expect(screen.getByTestId('write-dry-run').textContent).toContain('Did you mean 512Mi?');
    expect(screen.queryByText(/resources.limits.memory/)).toBeNull();
  });

  it('a GitOps-managed object recommends a pull request and is never auto-approved', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 4, shouldAutoApprove: () => true };
    const onConfirm = vi.fn();
    const preview = { ...patchPreview, gitops: { tool: 'Argo CD', app: 'payments-app', detail: 'annotation argocd.argoproj.io/tracking-id' } };
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: patchInput, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
    const note = screen.getByTestId('workload-gitops');
    expect(note.textContent).toContain('payments-app');
    expect(note.textContent).toContain('pull request');
  });

  it('a workload write without GitOps follows the trust level as before', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 4, shouldAutoApprove: () => true };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: patchInput, nonce: 'n', preview: patchPreview }} onConfirm={onConfirm} />);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('shows warnings and the protected namespace', () => {
    const preview = { ...patchPreview, warnings: ['updateStrategy is OnDelete: running pods keep the old values until they are deleted.'], protectedNamespace: true };
    render(<ConfirmationCard confirm={{ tool: 'patch_workload_container', input: patchInput, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    const notes = screen.getByTestId('workload-change-notes');
    expect(notes.textContent).toContain('OnDelete');
    expect(notes.textContent).toContain('protected namespace');
  });

  it('an older agent without a preview shows the parameters and no dry run', () => {
    render(<ConfirmationCard confirm={{ tool: 'restart_workload', input: { kind: 'StatefulSet', namespace: 'db', name: 'pg' }, nonce: 'n' }} onConfirm={vi.fn()} />);
    expect(screen.getByText('Trigger rolling restart of StatefulSet db/pg')).toBeTruthy();
    expect(screen.getByText(/No exact diff is available/)).toBeTruthy();
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
    expect(screen.getByText('No rollback needed — pods restart with the same spec')).toBeTruthy();
  });

  it('rollback_workload and scaling to zero are high risk', () => {
    render(<ConfirmationCard confirm={{ tool: 'rollback_workload', input: { kind: 'DaemonSet', namespace: 'logging', name: 'fluentd', revision: 0 }, nonce: 'n' }} onConfirm={vi.fn()} />);
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    expect(screen.getByText('Roll back DaemonSet logging/fluentd to revision previous')).toBeTruthy();
    cleanup();
    render(<ConfirmationCard confirm={{ tool: 'scale_workload', input: { kind: 'StatefulSet', namespace: 'db', name: 'pg', replicas: 0 }, nonce: 'n' }} onConfirm={vi.fn()} />);
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
  });
});
