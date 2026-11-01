// @vitest-environment jsdom
/**
 * Fleet Alerts rows open their detail on the fleet page. Switching to a
 * remote cluster and opening /alerts dead-ended (Alerts reads the local
 * cluster's Prometheus only), so that link is offered for the local cluster
 * only. Fleet Resources shows an unreadable cluster as "—", not 0, and leaves
 * it out of "across N clusters". The fleet card drops an Alerts column it can
 * never fill.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render as rtlRender, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter initialEntries={['/fleet']}>{ui}</MemoryRouter>);

const connections: Array<Record<string, unknown>> = [];
vi.mock('../../../engine/clusterConnection', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAllConnections: () => connections,
  getClusterBase: (id?: string) => (id && id !== 'local' ? `/k/${id}` : '/api/kubernetes'),
  getActiveClusterId: () => 'local',
}));
vi.mock('../../../store/uiStore', () => {
  const state = { impersonateUser: '', impersonateGroups: [], addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(), addToast: vi.fn(), addTab: vi.fn(), selectedNamespace: '*' };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});
const setActiveCluster = vi.fn();
vi.mock('../../../store/fleetStore', () => ({
  useFleetStore: (sel: (s: unknown) => unknown) => sel({ setActiveCluster, clusters: connections }),
}));
const go = vi.fn();
vi.mock('../../../hooks/useNavigateTab', () => ({ useNavigateTab: () => go }));
const fleetList = vi.fn();
vi.mock('../../../engine/fleet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fleetList: (...a: unknown[]) => fleetList(...a),
}));

import { mockFetchRoutes } from '../../../__tests__/helpers/honestStates';
import FleetAlertsView from '../FleetAlertsView';
import FleetResourceView from '../FleetResourceView';
import { FleetCard } from '../FleetCard';

function setClusters(...ids: string[]) {
  connections.splice(0, connections.length, ...ids.map((id) => ({ id, name: id, status: 'connected', connectionType: 'acm-proxy', metadata: {} })));
}
const rules = (name: string) => ({ body: { data: { groups: [{ name: 'g', rules: [{ type: 'alerting', name, alerts: [{
  state: 'firing', labels: { alertname: name, severity: 'critical', namespace: 'shop' },
  annotations: { summary: `${name} summary` }, activeAt: new Date().toISOString(),
}] }] }] } } });

beforeEach(() => { vi.unstubAllGlobals(); go.mockReset(); setActiveCluster.mockReset(); fleetList.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FleetAlertsView row', () => {
  it('opens a remote alert\'s detail on the fleet page and does not switch cluster to a dead end', async () => {
    setClusters('local', 'east');
    mockFetchRoutes({ '/k/east/': rules('EastDown'), '/api/kubernetes/': rules('LocalDown') }, 404);
    render(<FleetAlertsView />);
    fireEvent.click(await screen.findByText('EastDown'));
    expect(screen.getByTestId('fleet-alert-detail').textContent).toMatch(/EastDown summary/);
    expect(screen.queryByRole('button', { name: 'Open in Alerts' })).toBeNull();
    expect(screen.getByText(/available for the local cluster only/)).toBeTruthy();
    expect(setActiveCluster).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('offers Open in Alerts for the local cluster', async () => {
    setClusters('local', 'east');
    mockFetchRoutes({ '/k/east/': rules('EastDown'), '/api/kubernetes/': rules('LocalDown') }, 404);
    render(<FleetAlertsView />);
    fireEvent.click(await screen.findByText('LocalDown'));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Alerts' }));
    expect(setActiveCluster).toHaveBeenCalledWith('local');
    expect(go).toHaveBeenCalledWith('/alerts', expect.any(String));
  });
});

describe('FleetResourceView counts', () => {
  it.each(['Permission denied (403)', 'Internal error (500)'])('shows "—" for a cluster whose list failed (%s) and leaves it out of the total', async (err) => {
    setClusters('east', 'west');
    fleetList.mockResolvedValue([
      { clusterId: 'east', clusterName: 'east', status: 'fulfilled', data: [{ kind: 'ConfigMap', apiVersion: 'v1', metadata: { name: 'a', namespace: 'x', uid: '1' } }] },
      { clusterId: 'west', clusterName: 'west', status: 'rejected', data: [], error: err },
    ]);
    render(<FleetResourceView gvrKey="v1/configmaps" />);
    await waitFor(() => expect(screen.getByText(/resources across 1 cluster/)).toBeTruthy());
    expect(screen.getByText(/could not read 1 cluster/)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'west (—)' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'west (0)' })).toBeNull();
  });

  it('counts every cluster when all lists succeed', async () => {
    setClusters('east', 'west');
    fleetList.mockResolvedValue([
      { clusterId: 'east', clusterName: 'east', status: 'fulfilled', data: [{ kind: 'ConfigMap', apiVersion: 'v1', metadata: { name: 'a', namespace: 'x', uid: '1' } }] },
      { clusterId: 'west', clusterName: 'west', status: 'fulfilled', data: [] },
    ]);
    render(<FleetResourceView gvrKey="v1/configmaps" />);
    await waitFor(() => expect(screen.getByText(/resources across 2 clusters/)).toBeTruthy());
    expect(screen.getByRole('option', { name: 'west (0)' })).toBeTruthy();
    expect(screen.queryByText(/could not read/)).toBeNull();
  });
});

describe('FleetCard alerts column', () => {
  it('has no always-blank Alerts column without health input', () => {
    render(<FleetCard cluster={{ id: 'p', name: 'prod', status: 'connected', connectionType: 'acm-proxy' } as never} onClick={() => {}} />);
    expect(screen.queryByText('Alerts')).toBeNull();
  });
  it('shows the alert count when health input is given', () => {
    render(<FleetCard cluster={{ id: 'p', name: 'prod', status: 'connected', connectionType: 'acm-proxy' } as never}
      healthInput={{ nodeCount: 3, nodeReadyCount: 3, podCount: 1, podFailedCount: 0, operatorCount: 1, operatorDegradedCount: 0, alertCriticalCount: 2, alertWarningCount: 1 }}
      onClick={() => {}} />);
    expect(screen.getByText('Alerts')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
