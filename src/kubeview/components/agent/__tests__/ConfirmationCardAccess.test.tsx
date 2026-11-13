// @vitest-environment jsdom
/**
 * Access changes from chat (grant_access / revoke_access): the card shows the
 * agent's access_change preview (binding diff, subject and role, what is new,
 * who keeps access, dry run, risk). An access change is never auto-approved;
 * a HIGH one has a red banner, no keyboard shortcut, and needs an explicit
 * acknowledgement; observe mode cannot approve it; a refused preview cannot
 * be approved.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

let mockTrustState = {
  trustLevel: 1,
  shouldAutoApprove: (_t: string, _r: string) => false,
  recordConfirmation: vi.fn(),
  history: [],
  setTrustLevel: vi.fn(),
  getUpgradeEligibility: () => ({ eligible: false, currentLevel: 1, nextLevel: 2, consecutiveApprovals: 0, approvalsNeeded: 10 }),
  clearHistory: vi.fn(),
};

vi.mock('../../../store/trustStore', () => ({
  useTrustStore: vi.fn((selector: any) => {
    const state = mockTrustState;
    return typeof selector === 'function' ? selector(state) : state;
  }),
  TRUST_LABELS: { 0: 'Observe', 1: 'Manual', 2: 'Propose', 3: 'Bounded', 4: 'Autonomous' } as Record<number, string>,
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: vi.fn((selector: any) => {
    const state = { addToast: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

vi.mock('../MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: any) => <div>{content}</div>,
}));

const canI = vi.fn((..._args: unknown[]) => ({ allowed: true as boolean | undefined, isLoading: false }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: (...args: unknown[]) => canI(...args) }));

import { ConfirmationCard } from '../ConfirmationCard';

afterEach(() => cleanup());

beforeEach(() => {
  canI.mockClear();
  canI.mockImplementation(() => ({ allowed: true, isLoading: false }));
  mockTrustState = { ...mockTrustState, trustLevel: 1, shouldAutoApprove: () => false, recordConfirmation: vi.fn() };
});

const grantInput = { subject_kind: 'User', subject_name: 'alice', role_kind: 'ClusterRole', role_name: 'edit', namespace: 'payments' };

const grantPreview = {
  kind: 'access_change', tool: 'grant_access', action: 'create', valid: true, risk: 'MEDIUM', riskReasons: [], requiresHuman: true,
  subject: { kind: 'User', name: 'alice' },
  role: { kind: 'ClusterRole', name: 'edit', rules: ['get, list, create, delete on pods [core]', 'get, patch on deployments [apps]'], rulesKnown: true, rulesNote: '' },
  binding: { kind: 'RoleBinding', name: 'alice-edit', namespace: 'payments' },
  scope: 'namespace',
  yaml: 'kind: RoleBinding\n',
  diff: [{ op: '+', text: 'kind: RoleBinding' }, { op: '+', text: 'metadata:' }, { op: '+', text: '  name: alice-edit' }],
  newPermissions: { state: 'computed', rules: ['get, patch on deployments [apps]'], alreadyHad: ['get, list on pods [core]'], note: 'Compared with what User alice can do in payments now.' },
  otherSubjects: [], deletesBinding: false,
  dryRun: { state: 'passed', message: 'Passed: the API server accepts this change as you (dryRun=All)' },
  impact: 'User alice gets ClusterRole edit in payments, from the moment the binding exists.',
  undo: "revoke_access(subject_kind='User', subject_name='alice', binding_kind='RoleBinding', binding_name='alice-edit', namespace='payments')",
  gitops: null, warnings: [], protectedNamespace: false,
};

const adminInput = { subject_kind: 'User', subject_name: 'mallory', role_kind: 'ClusterRole', role_name: 'cluster-admin' };
const adminPreview = {
  ...grantPreview,
  risk: 'HIGH',
  riskReasons: ['cluster-admin hands over full control of the cluster', "the role grants every verb ('*') on some resources"],
  subject: { kind: 'User', name: 'mallory' },
  role: { kind: 'ClusterRole', name: 'cluster-admin', rules: ['* on * [*]'], rulesKnown: true, rulesNote: '' },
  binding: { kind: 'ClusterRoleBinding', name: 'mallory-cluster-admin', namespace: null },
  scope: 'cluster',
  newPermissions: { state: 'not-applicable', rules: ['* on * [*]'], alreadyHad: [], note: 'Cluster-wide.' },
};

const revokeInput = { subject_kind: 'User', subject_name: 'bob', binding_kind: 'RoleBinding', binding_name: 'bob-edit', namespace: 'payments' };
const revokeDeletePreview = {
  kind: 'access_change', tool: 'revoke_access', action: 'delete', valid: true, risk: 'MEDIUM', riskReasons: [], requiresHuman: true,
  subject: { kind: 'User', name: 'bob' },
  role: { kind: 'ClusterRole', name: 'edit', rules: ['get on pods [core]'], rulesKnown: true, rulesNote: '' },
  binding: { kind: 'RoleBinding', name: 'bob-edit', namespace: 'payments' },
  scope: 'namespace', yaml: '', diff: [{ op: '-', text: 'kind: RoleBinding' }, { op: '-', text: '- name: bob' }],
  newPermissions: null, otherSubjects: [], deletesBinding: true,
  dryRun: { state: 'passed', message: 'Passed: the API server accepts this change as you (dryRun=All)' },
  impact: 'User bob is the only subject, so the whole RoleBinding is deleted.', undo: 'grant_access with the same subject', gitops: null, warnings: [],
};

describe('ConfirmationCard for access changes', () => {
  it('shows the grant: subject, role, scope, binding diff, what is new, dry run and undo', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: grantInput, nonce: 'n', preview: grantPreview }} onConfirm={onConfirm} />);
    const p = screen.getByTestId('access-preview');
    expect(p.textContent).toContain('User alice');
    expect(p.textContent).toContain('ClusterRole edit');
    expect(p.textContent).toContain('Namespace payments');
    expect(p.textContent).toContain('New RoleBinding payments/alice-edit');
    expect(screen.getByLabelText('Binding diff').textContent).toContain('+   name: alice-edit');
    expect(screen.getByTestId('access-new-permissions').textContent).toContain('+ get, patch on deployments [apps]');
    expect(screen.getByTestId('access-new-permissions').textContent).toContain('Already held: get, list on pods [core]');
    expect(screen.getByTestId('write-dry-run').textContent).toContain('Passed: the API server accepts this change as you');
    expect(screen.getByText(/revoke_access\(subject_kind='User'/)).toBeTruthy();
    expect(screen.getByText('MEDIUM RISK')).toBeTruthy();
    expect(screen.queryByTestId('access-risk-banner')).toBeNull();
    // A MEDIUM grant may be approved with the button or Y.
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('checks the person may create rolebindings in that namespace', () => {
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: grantInput, nonce: 'n', preview: grantPreview }} onConfirm={vi.fn()} />);
    expect(canI).toHaveBeenCalledWith('create', 'rbac.authorization.k8s.io', 'rolebindings', 'payments', undefined, expect.anything());
  });

  it('a HIGH grant: red banner with reasons, no keyboard approval, Approve only after acknowledging', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: adminInput, nonce: 'n', preview: adminPreview }} onConfirm={onConfirm} />);
    const banner = screen.getByTestId('access-risk-banner');
    expect(banner.textContent).toContain('High-risk grant');
    expect(banner.textContent).toContain('cluster-admin hands over full control of the cluster');
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'y' });
    fireEvent.keyDown(window, { key: 'Y' });
    expect(onConfirm).not.toHaveBeenCalled();
    const approve = screen.getByRole('button', { name: 'Approve high-risk operation' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I understand what this grant hands over'));
    expect(approve.disabled).toBe(false);
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(approve);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("uses the agent's HIGH assessment even when the input alone looks ordinary", () => {
    const preview = { ...grantPreview, risk: 'HIGH', riskReasons: ["the role grants 'bind', which lets the subject raise its own access"] };
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: { ...grantInput, role_name: 'binder' }, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    expect(screen.getByTestId('access-risk-banner').textContent).toContain("'bind'");
  });

  it.each([
    ['HIGH grant', 'grant_access', adminInput, adminPreview],
    ['MEDIUM grant', 'grant_access', grantInput, grantPreview],
    ['revoke', 'revoke_access', revokeInput, revokeDeletePreview],
  ])('a %s is never auto-approved, even when the trust level auto-approves everything', (_label, tool, input, preview) => {
    mockTrustState = { ...mockTrustState, trustLevel: 4, shouldAutoApprove: () => true };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool, input, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(mockTrustState.recordConfirmation).not.toHaveBeenCalled();
    expect(screen.getByTestId('access-preview')).toBeTruthy();
  });

  it('observe mode cannot approve a HIGH grant: no Approve button, no shortcut', () => {
    mockTrustState = { ...mockTrustState, trustLevel: 0 };
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: adminInput, nonce: 'n', preview: adminPreview }} onConfirm={onConfirm} />);
    expect(screen.getByText(/Observe mode — write operations are blocked/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByLabelText('I understand what this grant hands over')).toBeNull();
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('a grant from an older agent without a preview is HIGH and says what it cannot show', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: grantInput, nonce: 'n' }} onConfirm={onConfirm} />);
    expect(screen.getByText('HIGH RISK')).toBeTruthy();
    expect(screen.getByTestId('access-risk-banner').textContent).toContain('sent no preview');
    expect(screen.getByTestId('access-preview').textContent).toContain('Grant ClusterRole edit to User alice in payments');
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a refused preview (duplicate) cannot be approved and says why; deny still works', () => {
    const onConfirm = vi.fn();
    const preview = { ...grantPreview, valid: false, error: 'User alice already has ClusterRole edit in payments through RoleBinding payments-editors.', dryRun: { state: 'unavailable', message: '' } };
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: grantInput, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(screen.getByRole('alert').textContent).toContain('already has ClusterRole edit');
    expect(screen.getByTestId('write-dry-run').textContent).toContain('Failed · User alice already has');
    const approve = screen.getByRole('button', { name: 'Approve operation (Y)' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    fireEvent.keyDown(window, { key: 'y' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deny operation (N)' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("a failed dry run shows the API server's reason and blocks approval", () => {
    const onConfirm = vi.fn();
    const preview = { ...grantPreview, valid: false, dryRun: { state: 'failed', message: 'Dry run refused by the API server: attempting to grant RBAC permissions not currently held' } };
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: grantInput, nonce: 'n', preview }} onConfirm={onConfirm} />);
    expect(screen.getByTestId('write-dry-run').textContent).toContain('not currently held');
    expect((screen.getByRole('button', { name: 'Approve operation (Y)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a revoke that deletes the binding says so and checks delete permission', () => {
    render(<ConfirmationCard confirm={{ tool: 'revoke_access', input: revokeInput, nonce: 'n', preview: revokeDeletePreview }} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('access-deletes-binding').textContent).toContain("User bob is the binding's only subject, so the whole RoleBinding is deleted.");
    expect(screen.getByLabelText('Binding diff').textContent).toContain('- - name: bob');
    expect(screen.getByTestId('access-preview').textContent).toContain('Lost through this binding');
    expect(canI).toHaveBeenCalledWith('delete', 'rbac.authorization.k8s.io', 'rolebindings', 'payments', undefined, expect.anything());
    expect(screen.getByText(/Remove User bob from RoleBinding payments\/bob-edit/)).toBeTruthy();
  });

  it('a revoke that keeps the binding lists who keeps access and checks patch permission', () => {
    const preview = { ...revokeDeletePreview, action: 'remove-subject', deletesBinding: false, otherSubjects: [{ kind: 'User', name: 'carol' }, { kind: 'ServiceAccount', name: 'ci', namespace: 'build' }] };
    render(<ConfirmationCard confirm={{ tool: 'revoke_access', input: revokeInput, nonce: 'n', preview }} onConfirm={vi.fn()} />);
    expect(screen.getByText('Keep access through this binding: User carol, ServiceAccount build/ci')).toBeTruthy();
    expect(screen.queryByTestId('access-deletes-binding')).toBeNull();
    expect(canI).toHaveBeenCalledWith('patch', 'rbac.authorization.k8s.io', 'rolebindings', 'payments', undefined, expect.anything());
  });

  it("without the person's permission the card offers no Approve", () => {
    canI.mockImplementation(() => ({ allowed: false, isLoading: false }));
    render(<ConfirmationCard confirm={{ tool: 'grant_access', input: grantInput, nonce: 'n', preview: grantPreview }} onConfirm={vi.fn()} />);
    expect(screen.getByText(/You do not have permission to create rolebindings in payments/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});
