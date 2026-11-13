// @vitest-environment jsdom
/**
 * Domain pages that had no Pulse AI context: questions typed into the dock
 * there are now about the page's subject, and each failed security audit row
 * has its own "Ask Pulse to fix" naming the check (or "Ask Pulse why" in
 * Observe mode, where the agent cannot write).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
const askPulse = vi.fn();
vi.mock('../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import { mockFetchRoutes, renderWithClient } from './helpers/honestStates';
import SecurityView, { SECURITY_CONTEXT, securityFixPrompt } from '../views/SecurityView';
import { QuotasTab, QUOTAS_CONTEXT } from '../views/admin/QuotasTab';
import { operatorChatContext } from '../views/OperatorCatalogView';
import { helmReleaseContext } from '../views/create/HelmReleases';
import { useAgentStore } from '../store/agentStore';
import { useTrustStore } from '../store/trustStore';
import { useFleetStore } from '../store/fleetStore';

const NAMESPACES = { body: { items: [{ metadata: { name: 'shop' } }] } };
const NO_NETPOLS = { body: { items: [] } };

beforeEach(() => { askPulse.mockReset(); vi.unstubAllGlobals(); useTrustStore.setState({ trustLevel: 2 }); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAgentStore.getState().setPageContext(null);
  useTrustStore.setState({ trustLevel: 2 });
  useFleetStore.setState({ activeClusterId: 'local' });
});

describe('Security page', () => {
  it('sets the dock context to the cluster security posture', () => {
    mockFetchRoutes({ '/api/v1/namespaces': NAMESPACES, '/apis/networking.k8s.io/v1/networkpolicies': NO_NETPOLS }, 404);
    renderWithClient(<SecurityView />);
    expect(useAgentStore.getState().pageContext).toEqual({ kind: 'Cluster', name: 'security posture' });
  });

  it('a failed check has "Ask Pulse to fix" that sends the check id, label and finding', async () => {
    mockFetchRoutes({ '/api/v1/namespaces': NAMESPACES, '/apis/networking.k8s.io/v1/networkpolicies': NO_NETPOLS }, 404);
    renderWithClient(<SecurityView />);
    const buttons = await screen.findAllByRole('button', { name: /^Ask Pulse to fix: / });
    fireEvent.click(buttons[0]);
    expect(askPulse).toHaveBeenCalledTimes(1);
    const [prompt, ctx] = askPulse.mock.calls[0];
    expect(prompt).toMatch(/^The security audit check ".+" \(id [a-z0-9-]+\) failed: /);
    expect(prompt).toContain('ask me before applying it');
    expect(ctx).toEqual(SECURITY_CONTEXT);
  });

  it('in Observe mode the row asks why and what to change, not to fix', async () => {
    useTrustStore.setState({ trustLevel: 0 });
    mockFetchRoutes({ '/api/v1/namespaces': NAMESPACES, '/apis/networking.k8s.io/v1/networkpolicies': NO_NETPOLS }, 404);
    renderWithClient(<SecurityView />);
    const buttons = await screen.findAllByRole('button', { name: /^Ask Pulse why: / });
    expect(screen.queryAllByRole('button', { name: /^Ask Pulse to fix: / })).toEqual([]);
    fireEvent.click(buttons[0]);
    expect(askPulse.mock.calls[0][0]).toContain('do not make any change');
  });

  it('on a remote cluster the row buttons are disabled and send nothing', async () => {
    useFleetStore.setState({ activeClusterId: 'remote-1' });
    mockFetchRoutes({ '/api/v1/namespaces': NAMESPACES, '/apis/networking.k8s.io/v1/networkpolicies': NO_NETPOLS }, 404);
    renderWithClient(<SecurityView />);
    const buttons = await screen.findAllByRole('button', { name: /^Ask Pulse to fix: / });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[0]);
    expect(askPulse).not.toHaveBeenCalled();
  });

  it('securityFixPrompt names the check either way', () => {
    const check = { id: 'kubeadmin', label: 'kubeadmin removed', detail: 'kubeadmin secret still exists' };
    expect(securityFixPrompt(check, false)).toContain('"kubeadmin removed" (id kubeadmin) failed: kubeadmin secret still exists.');
    expect(securityFixPrompt(check, true)).toContain('Observe mode is on');
  });
});

describe('Quotas tab', () => {
  it('sets the dock context and asks about quotas with it', () => {
    mockFetchRoutes({ '/api/v1/namespaces': NAMESPACES }, 404);
    renderWithClient(<QuotasTab quotas={[]} limitRanges={[]} go={vi.fn()} />);
    expect(useAgentStore.getState().pageContext).toEqual(QUOTAS_CONTEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Which namespaces are close to their quota?' }));
    expect(askPulse).toHaveBeenCalledWith('Which namespaces are close to their quota?', QUOTAS_CONTEXT);
  });
});

describe('operator and Helm contexts', () => {
  it('an installed operator is its Subscription; otherwise the PackageManifest; nothing in the list', () => {
    expect(operatorChatContext({ name: 'cert-manager', namespace: 'openshift-marketplace' }, { metadata: { name: 'cert-manager', namespace: 'cert-manager-operator' } }))
      .toMatchObject({ kind: 'Subscription', name: 'cert-manager', namespace: 'cert-manager-operator' });
    expect(operatorChatContext({ name: 'cert-manager', namespace: 'openshift-marketplace' }, null))
      .toMatchObject({ kind: 'PackageManifest', name: 'cert-manager', namespace: 'openshift-marketplace' });
    expect(operatorChatContext(null, null)).toBeNull();
  });

  it('a Helm release is named with its namespace', () => {
    expect(helmReleaseContext({ name: 'redis', namespace: 'cache' })).toEqual({ kind: 'HelmRelease', name: 'redis', namespace: 'cache' });
  });
});
