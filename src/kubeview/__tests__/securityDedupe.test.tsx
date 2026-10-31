// @vitest-environment jsdom
/**
 * Security shows each fact once: the pass count in the score card, cluster
 * admins and network-policy coverage in their audit rows. It no longer lists
 * every Secret in the cluster just to count TLS ones.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { mockFetchRoutes, renderWithClient } from './helpers/honestStates';
import SecurityView from '../views/SecurityView';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SecurityView', () => {
  it('states the pass count once and names cluster admins once', async () => {
    const fetchMock = mockFetchRoutes({
      '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings': { body: { items: [
        { metadata: { name: 'ops' }, roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'alice' }] },
      ] } },
    }, 404);
    renderWithClient(<SecurityView />);
    await waitFor(() => expect(screen.getByText(/User\/alice/)).toBeDefined());
    expect(screen.getAllByText(/alice/)).toHaveLength(1);
    expect(screen.getAllByText(/checks passing/)).toHaveLength(1);
    expect(screen.queryByText(/\d+\/\d+ passed/)).toBeNull();
    expect(screen.queryByText(/Cluster-Admin Access \(/)).toBeNull();
    const urls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/api\/v1\/secrets(\?|$)/.test(u))).toBe(false);
  });
});
