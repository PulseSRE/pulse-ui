// @vitest-environment jsdom
/**
 * Security shows each fact once: the pass count in the score card, cluster
 * admins and network-policy coverage in their audit rows. It no longer lists
 * every Secret in the cluster just to count TLS ones.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { mockFetchRoutes, renderWithClient } from './helpers/honestStates';
import SecurityView from '../views/SecurityView';
import { useFleetStore } from '../store/fleetStore';

vi.mock('../engine/askPulse', () => ({ askPulse: vi.fn() }));
import { askPulse } from '../engine/askPulse';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SecurityView', () => {
  it('states the pass count once and keeps the panel title free of a second admin count', async () => {
    const fetchMock = mockFetchRoutes({
      '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings': { body: { items: [
        { metadata: { name: 'ops' }, roleRef: { name: 'cluster-admin' }, subjects: [{ kind: 'User', name: 'alice' }] },
      ] } },
    }, 404);
    renderWithClient(<SecurityView />);
    await waitFor(() => expect(screen.getByText(/User\/alice/)).toBeDefined());
    expect(screen.getAllByText(/checks passing/)).toHaveLength(1);
    expect(screen.queryByText(/\d+\/\d+ passed/)).toBeNull();
    expect(screen.queryByText(/Cluster-Admin Access \(/)).toBeNull();
    const urls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/api\/v1\/secrets(\?|$)/.test(u))).toBe(false);
  });

  describe('Ask Pulse about this cluster\'s security', () => {
    afterEach(() => useFleetStore.setState({ activeClusterId: 'local' } as never));

    it('sends a chip on the local cluster', async () => {
      vi.mocked(askPulse).mockClear();
      mockFetchRoutes({}, 404);
      renderWithClient(<SecurityView />);
      expect(screen.getByRole('heading', { name: "Ask Pulse about this cluster's security" })).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Check RBAC risks' }));
      // The chip carries the page's context: the cluster's security posture.
      expect(askPulse).toHaveBeenCalledWith('Check RBAC risks', { kind: 'Cluster', name: 'security posture' });
    });

    it('disables the chips on a remote cluster with the shared wording', async () => {
      vi.mocked(askPulse).mockClear();
      useFleetStore.setState({ activeClusterId: 'prod-east' } as never);
      mockFetchRoutes({}, 404);
      renderWithClient(<SecurityView />);
      const chip = screen.getByRole('button', { name: 'Check RBAC risks' }) as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
      // Shown under the chips (and announced for each disabled row button).
      expect(screen.getAllByText('Pulse AI answers about the local cluster only.').length).toBeGreaterThan(0);
      fireEvent.click(chip);
      expect(askPulse).not.toHaveBeenCalled();
    });
  });
});
