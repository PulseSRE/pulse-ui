// @vitest-environment jsdom
/**
 * Fleet pages: a cluster that could not be read is shown as such, never as
 * a score of 100, "quiet", zero workloads, a passing check or a match.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render as rtlRender, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Fleet pages carry the fleet tab bar, which reads the current route.
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter initialEntries={['/fleet']}>{ui}</MemoryRouter>);

const connections: Array<Record<string, unknown>> = [];
vi.mock('../../../engine/clusterConnection', () => ({
  getAllConnections: () => connections,
  getClusterBase: (id?: string) => (id && id !== 'local' ? `/k/${id}` : '/api/kubernetes'),
  getActiveClusterId: () => 'local',
}));
vi.mock('../../../store/uiStore', () => {
  const state = { impersonateUser: '', impersonateGroups: [], addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(), addToast: vi.fn(), selectedNamespace: '*' };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});
vi.mock('../../../store/fleetStore', () => ({
  useFleetStore: (sel: (s: unknown) => unknown) => sel({ setActiveCluster: vi.fn(), clusters: connections }),
}));
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { mockFetchRoutes, expectNoAllClear } from '../../../__tests__/helpers/honestStates';
import { FleetCard } from '../FleetCard';
import FleetAlertsView from '../FleetAlertsView';
import FleetWorkloadsView from '../FleetWorkloadsView';
import ComplianceView from '../ComplianceView';
import CompareView from '../CompareView';

function setClusters(...ids: string[]) {
  connections.splice(0, connections.length, ...ids.map((id) => ({ id, name: id, status: 'connected', connectionType: 'acm-proxy', metadata: {} })));
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FleetCard', () => {
  it('shows connection status, not an invented score of 100 / "All systems go", without health inputs', () => {
    render(<FleetCard cluster={{ id: 'p', name: 'prod', status: 'connected', connectionType: 'acm-proxy' } as never} onClick={() => {}} />);
    expect(screen.getByText('Reachable')).toBeTruthy();
    expect(screen.queryByText('100')).toBeNull();
    expect(document.body.textContent).not.toMatch(/All systems go/);
  });

  it('shows a real score when health inputs are given', () => {
    render(
      <FleetCard
        cluster={{ id: 'p', name: 'prod', status: 'connected', connectionType: 'acm-proxy' } as never}
        healthInput={{ nodeCount: 3, nodeReadyCount: 1, podCount: 10, podFailedCount: 0, operatorCount: 5, operatorDegradedCount: 0, alertCriticalCount: 2, alertWarningCount: 0 }}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText('Reachable')).toBeNull();
    expect(screen.getByText('1/3')).toBeTruthy();
  });
});

describe('FleetAlertsView', () => {
  it('reports clusters whose Prometheus answered 403 instead of "All clusters are quiet"', async () => {
    setClusters('east', 'west');
    mockFetchRoutes({}, 403);
    render(<FleetAlertsView />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read from 2 of 2 clusters/);
    expect(screen.getByRole('alert').textContent).toMatch(/east: Permission denied \(403\)/);
    expectNoAllClear();
  });

  it('says only the readable clusters are quiet when one fails', async () => {
    setClusters('east', 'west');
    mockFetchRoutes({ '/k/east/': { body: { data: { groups: [] } } } }, 503);
    render(<FleetAlertsView />);
    await waitFor(() => expect(screen.getByText(/No firing alerts on the 1 cluster that could be read/)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/All clusters are quiet/);
  });
});

describe('FleetWorkloadsView', () => {
  it('shows a failed cluster as "could not read" with dashes, and leaves it out of the totals', async () => {
    setClusters('east', 'west');
    mockFetchRoutes({
      '/k/east/apis/apps/v1/deployments': { body: { items: [{ metadata: { name: 'd' }, status: { replicas: 1, readyReplicas: 1 } }] } },
      '/k/east/api/v1/pods': { body: { items: [{ metadata: { name: 'p' }, status: { phase: 'Running' } }] } },
    }, 403);
    render(<FleetWorkloadsView />);
    await waitFor(() => expect(screen.getByText('could not read')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read from 1 cluster/);
    expect(screen.getByText(/across 1 of 2 clusters/)).toBeTruthy();
    const westRow = screen.getByText('west').closest('tr')!;
    expect(westRow.textContent).toContain('—');
    expect(westRow.textContent).not.toMatch(/\b0\b/);
  });
});

describe('ComplianceView', () => {
  it('reports forbidden reads as unknown, not "kubeadmin Removed" or a passing TLS profile', async () => {
    setClusters('east');
    mockFetchRoutes({}, 403);
    render(<ComplianceView />);
    await waitFor(() => expect(screen.getAllByText('Permission denied (403)').length).toBeGreaterThan(0));
    expect(screen.queryAllByLabelText('Compliant')).toHaveLength(0);
    expect(screen.queryAllByLabelText('Non-compliant')).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/);
  });

  // The scheduler profile is compared on Compare & Drift now (CompareView uses
  // the same DEFAULT_SCHEDULER_PROFILE); Compliance no longer repeats it.
  it('passes kubeadmin only on a 404', async () => {
    setClusters('east');
    mockFetchRoutes({
      '/secrets/kubeadmin': { status: 404, body: { code: 404 } },
      'apiservers/cluster': { body: { spec: {} } },
      'schedulers/cluster': { body: { spec: {} } },
    }, 404);
    render(<ComplianceView />);
    await waitFor(() => {
      const kubeadminRow = screen.getByText('kubeadmin Removed').closest('tr')!;
      expect(kubeadminRow.querySelector('[aria-label="Compliant"]')).toBeTruthy();
    });
    expect(document.body.textContent).not.toMatch(/HighNodeUtilization/);
  });
});

describe('CompareView', () => {
  it('does not count unreadable fields as matching', async () => {
    setClusters('east', 'west');
    mockFetchRoutes({}, 403);
    render(<CompareView clusterA="east" clusterB="west" />);
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    await waitFor(() => expect(screen.getByText(/fields could not be compared/)).toBeTruthy());
    expect(screen.getByText('0 fields match')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/);
  });
});
