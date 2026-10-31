// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { isKnownRoute } from '../../engine/routeTable';

const mockFleetState: Record<string, any> = {
  fleetMode: 'multi',
  clusters: [],
  activeClusterId: 'local',
  acmAvailable: false,
  acmDetecting: false,
  setActiveCluster: vi.fn(),
  refreshAllHealth: vi.fn(),
  detectACM: vi.fn(),
};

vi.mock('../../store/fleetStore', () => ({
  useFleetStore: (sel?: (s: any) => any) => sel ? sel(mockFleetState) : mockFleetState,
}));

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (sel: (s: any) => any) => sel({ addToast: vi.fn() }),
    { getState: () => ({}) },
  ),
}));

const goMock = vi.fn();
vi.mock('../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => goMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import FleetView from '../FleetView';

describe('FleetView navigation links', () => {
  afterEach(() => { cleanup(); goMock.mockReset(); });

  it.each([
    ['Resources', '/fleet/r/apps~v1~deployments'],
    ['Workloads', '/fleet/workloads'],
    ['Alerts', '/fleet/alerts'],
    ['Compare', '/fleet/compare'],
    ['Compliance', '/fleet/compliance'],
    ['Drift', '/fleet/drift'],
  ])('%s opens %s', (label, path) => {
    mockFleetState.fleetMode = 'multi';
    mockFleetState.clusters = [{ id: 'c1', name: 'prod', status: 'connected', connectionType: 'acm', metadata: { nodeCount: 3 } }];
    render(<MemoryRouter><FleetView /></MemoryRouter>);
    const button = screen.getAllByRole('button').find((b) => b.textContent?.trim() === label)!;
    fireEvent.click(button);
    expect(goMock).toHaveBeenCalledWith(path, expect.any(String));
    expect(isKnownRoute(path)).toBe(true);
  });
});

describe('FleetView empty state', () => {
  it('shows "No clusters connected" EmptyState when clusters array is empty in multi-cluster mode', () => {
    mockFleetState.fleetMode = 'multi';
    mockFleetState.clusters = [];

    render(
      <MemoryRouter>
        <FleetView />
      </MemoryRouter>,
    );

    expect(screen.getByText('No clusters connected')).toBeDefined();
    expect(screen.getByText(/Fleet mode requires Red Hat Advanced Cluster Management/)).toBeDefined();
  });
});

/**
 * "ACM not detected", before ever looking.
 *
 * `detectACM` was wired only to a button — no effect ran it on mount — so the
 * page rendered "ACM not detected — show installation instructions" purely
 * from the store's initial `acmAvailable: false`.
 *
 * Measured on the reference cluster, which is an ACM hub: a MultiClusterHub
 * had been Running for 354 days ("All hub components ready", v2.17.0), with a
 * ManagedCluster registered and 62 ACM CRDs installed. The endpoint the
 * detector calls returned 200. Fleet told the operator ACM was absent and
 * offered YAML to create a hub that already existed.
 *
 * Same family as the rest of this UI's confident empty states: a default
 * rendered as a finding.
 */
describe('Fleet looks before it reports', () => {
  afterEach(cleanup);

  beforeEach(() => {
    // The setup screen — the only place the ACM claim renders — is the
    // fleetMode 'single' branch. The shared mock defaults to 'multi', where
    // that text never appears and these assertions would pass vacuously.
    Object.assign(mockFleetState, {
      fleetMode: 'single',
      acmAvailable: false, acmDetecting: false, acmChecked: false,
      detectACM: vi.fn(), clusters: [],
    });
  });

  it('runs detection on mount rather than waiting to be asked', () => {
    render(<FleetView />);
    expect(mockFleetState.detectACM).toHaveBeenCalled();
  });

  it('does not claim ACM is absent before the check has run', () => {
    render(<FleetView />);
    expect(screen.queryByText(/ACM not detected/)).toBeNull();
  });

  it('says so once it has actually looked and found nothing', () => {
    Object.assign(mockFleetState, { acmChecked: true });
    render(<FleetView />);
    expect(screen.getByText(/ACM not detected/)).toBeDefined();
  });

  it('stays quiet while the check is in flight', () => {
    Object.assign(mockFleetState, { acmChecked: false, acmDetecting: true });
    render(<FleetView />);
    expect(screen.queryByText(/ACM not detected/)).toBeNull();
  });

  it('does not re-run detection once it has an answer', () => {
    Object.assign(mockFleetState, { acmChecked: true, acmAvailable: true });
    render(<FleetView />);
    expect(mockFleetState.detectACM).not.toHaveBeenCalled();
  });
});
