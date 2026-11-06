// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WriteConfirmDialog, type WriteConfirmDialogProps } from '../WriteConfirmDialog';
import { PulseError } from '../../../engine/errors';
import { useTrustStore } from '../../../store/trustStore';
import { useFleetStore } from '../../../store/fleetStore';
import { useUIStore } from '../../../store/uiStore';
import { getAllConnections, registerCluster, resetConnections } from '../../../engine/clusterConnection';

const pulseError = (statusCode: number, message: string) =>
  new PulseError({ message, statusCode, category: 'unknown', context: {}, userMessage: message, suggestions: [] } as never);

function open(props: Partial<WriteConfirmDialogProps> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props.onClose ?? vi.fn();
  render(
    <WriteConfirmDialog
      title="Raise memory limit on Deployment api?"
      where={{ namespace: 'payments', clusterId: 'local', actingAs: 'user' }}
      change={{ diff: { header: 'Deployment api · containers[api].resources', lines: [{ field: 'limits.memory', before: '256Mi', after: '512Mi' }] } }}
      impact="Rolling restart of 3 pods"
      undo="Roll back to revision 14"
      confirmLabel="Apply to Deployment api"
      {...props}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose, button: () => screen.getByRole('button', { name: 'Apply to Deployment api' }) as HTMLButtonElement };
}

beforeEach(() => {
  resetConnections();
  registerCluster({ id: 'prod-east', name: 'Prod East', connectionType: 'acm-proxy', target: 'prod-east' });
  useFleetStore.setState({ activeClusterId: 'local', clusters: getAllConnections() });
  useUIStore.setState({ impersonateUser: '' });
  useTrustStore.setState({ trustLevel: 1 });
});
afterEach(() => { cleanup(); resetConnections(); });

describe('WriteConfirmDialog', () => {
  it('shows the exact diff, where and as whom, impact, undo, and that there is no dry run', () => {
    const { button } = open();
    expect(screen.getByLabelText('What will change').textContent).toContain('-   limits.memory: 256Mi');
    expect(screen.getByTestId('write-where').textContent).toBe('payments · cluster Local Cluster · with your own credentials');
    expect(screen.getByText('Rolling restart of 3 pods')).toBeTruthy();
    expect(screen.getByText('Roll back to revision 14')).toBeTruthy();
    expect(screen.getByTestId('write-dry-run').textContent).toBe('No dry run available for this action');
    expect(button().disabled).toBe(false);
  });

  it('names the impersonated user', () => {
    useUIStore.setState({ impersonateUser: 'alice' });
    open();
    expect(screen.getByTestId('write-where').textContent).toContain('acting as alice (impersonated)');
  });

  it('shows parameters when no diff is available', () => {
    open({ change: { params: { action: 'restart_deployment', input: { name: 'api' } } } });
    expect(screen.getByText(/No exact diff is available/)).toBeTruthy();
    expect(screen.getByLabelText('Parameters').textContent).toContain('"name": "api"');
  });

  it('holds confirm until the dry run passes, and keeps it held when it fails', async () => {
    let fail!: (e: unknown) => void;
    const { button, onConfirm } = open({ dryRun: () => new Promise((_res, rej) => { fail = rej; }) });
    expect(screen.getByTestId('write-dry-run').textContent).toContain('Asking the API server');
    expect(button().disabled).toBe(true);
    await act(async () => { fail(pulseError(422, 'admission webhook "quota" denied the request')); });
    expect(screen.getByTestId('write-dry-run').textContent).toBe('Failed · admission webhook "quota" denied the request');
    fireEvent.click(button());
    expect(button().disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('enables confirm once the dry run passes', async () => {
    const { button } = open({ dryRun: () => Promise.resolve() });
    await waitFor(() => expect(screen.getByTestId('write-dry-run').textContent).toBe('Passed · admitted by the API server'));
    expect(button().disabled).toBe(false);
  });

  it('RBAC-denied: no dry run is sent, confirm is disabled and says why', () => {
    const dryRun = vi.fn().mockResolvedValue(undefined);
    const { button } = open({ dryRun, rbac: { allowed: false, deniedMessage: 'You do not have permission to patch deployments in payments' } });
    expect(dryRun).not.toHaveBeenCalled();
    expect(button().disabled).toBe(true);
    expect(screen.getByTestId('write-blocked').textContent).toContain('You do not have permission to patch deployments in payments');
  });

  it('a required reason holds confirm until given, and is passed on trimmed', async () => {
    const { button, onConfirm } = open({ reason: { label: 'Reason', required: true } });
    expect(screen.getByText('(required)')).toBeTruthy();
    expect(button().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  OOM after rev 14 ' } });
    fireEvent.click(button());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('OOM after rev 14'));
  });

  it('observe mode disables agent approvals and explains; a direct write opts out', () => {
    useTrustStore.setState({ trustLevel: 0 });
    const first = open();
    expect(first.button().disabled).toBe(true);
    expect(screen.getByTestId('write-blocked').textContent).toMatch(/Observe mode/);
    cleanup();
    const second = open({ observeGate: false });
    expect(second.button().disabled).toBe(false);
  });

  it.each([
    [403, 'forbidden', 'Apply to Deployment api failed: Permission denied: forbidden'],
    [409, 'conflict', 'Apply to Deployment api failed: The object changed since this page loaded it, so nothing was changed. Reload and try again.'],
  ])('a %s on confirm stays in the dialog with a readable reason', async (code, msg, shown) => {
    const { button, onClose } = open({ onConfirm: vi.fn().mockRejectedValue(pulseError(code, msg)) });
    fireEvent.click(button());
    expect((await screen.findByRole('alert')).textContent).toBe(shown);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel calls nothing but close', () => {
    const { onConfirm, onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('pins the cluster it opened on: after a switch nothing is sent and it says why', async () => {
    const { button, onConfirm } = open();
    act(() => { useFleetStore.getState().setActiveCluster('prod-east'); });
    expect(screen.getByText(/You are viewing Prod East; this change applies to Local Cluster\./)).toBeTruthy();
    fireEvent.click(button());
    expect((await screen.findByRole('alert')).textContent).toMatch(/was not run: it was prepared on Local Cluster, but the active cluster is now Prod East/);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
