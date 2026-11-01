// @vitest-environment jsdom
/**
 * "Namespaces Without Network Policies" is a difference of two lists. With
 * either list unreadable it used to list every user namespace as unprotected,
 * each with "+ default-deny ingress", below an audit row saying the read failed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { mockFetchRoutes, renderWithClient } from './helpers/honestStates';
import SecurityView from '../views/SecurityView';

const NAMESPACES = { body: { items: [{ metadata: { name: 'shop' } }, { metadata: { name: 'payments' } }] } };
const NETPOLS = { body: { items: [{ metadata: { name: 'deny', namespace: 'payments' } }] } };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SecurityView unprotected namespaces', () => {
  it.each([403, 500])('shows an error, not every namespace as unprotected, when NetworkPolicies fail with %i', async (status) => {
    mockFetchRoutes({
      '/api/v1/namespaces': NAMESPACES,
      '/apis/networking.k8s.io/v1/networkpolicies': { status, body: { kind: 'Status', message: 'nope', code: status } },
    }, 404);
    renderWithClient(<SecurityView />);
    expect(await screen.findByText('Could not check which namespaces lack network policies')).toBeDefined();
    expect(screen.queryByText('Namespaces Without Network Policies')).toBeNull();
    expect(screen.queryByText(/\+ default-deny ingress/)).toBeNull();
  });

  it.each([403, 500])('shows an error when namespaces fail with %i', async (status) => {
    mockFetchRoutes({
      '/api/v1/namespaces': { status, body: { kind: 'Status', message: 'nope', code: status } },
      '/apis/networking.k8s.io/v1/networkpolicies': NETPOLS,
    }, 404);
    renderWithClient(<SecurityView />);
    expect(await screen.findByText('Could not check which namespaces lack network policies')).toBeDefined();
    expect(screen.queryByText('Namespaces Without Network Policies')).toBeNull();
  });

  it('lists only the namespaces without a policy when both reads succeed', async () => {
    mockFetchRoutes({ '/api/v1/namespaces': NAMESPACES, '/apis/networking.k8s.io/v1/networkpolicies': NETPOLS }, 404);
    renderWithClient(<SecurityView />);
    await waitFor(() => expect(screen.getByText('Namespaces Without Network Policies')).toBeDefined());
    expect(screen.getByRole('button', { name: 'shop' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'payments' })).toBeNull();
    expect(screen.queryByText('Could not check which namespaces lack network policies')).toBeNull();
  });
});
