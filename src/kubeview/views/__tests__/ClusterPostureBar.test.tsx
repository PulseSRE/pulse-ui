// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PulseViewModule from '../PulseView';

/**
 * "All clear" was the loading state.
 *
 * Before the first scan lands every count is zero, and the posture bar read
 * zero criticals as health — on the landing page, as the first thing an
 * operator sees. It even rendered "No scan yet" in the same sentence, so the
 * component was holding the evidence against its own claim.
 *
 * This is the same failure as an empty investigation panel reading as "nothing
 * worth investigating": absence of data presented as absence of problems.
 */

// PulseView pulls in the topology map, k8s watches and several stores; the bar
// is a private component, so drive it through the exported view with
// everything below it stubbed out.
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../hooks/useIncidentFeed', () => ({ useIncidentFeed: () => ({ incidents: [], counts: {} }) }));
vi.mock('../../components/topology/TopologyMap', () => ({ default: () => null }));
vi.mock('../pulse/ReportTab', () => ({ ReportTab: () => null }));
vi.mock('../pulse/FleetReportTab', () => ({ FleetReportTab: () => null }));
vi.mock('../pulse/OpenEpisodeBanner', () => ({ OpenEpisodeBanner: () => null }));

const monitorState = {
  connected: true,
  activeSkill: null,
  monitorEnabled: true,
  setMonitorEnabled: vi.fn(),
  triggerScan: vi.fn(),
  findings: [] as Array<{ severity: string; title: string }>,
  lastScanTime: null as number | null,
};

vi.mock('../../store/monitorStore', () => ({
  useMonitorStore: (selector: (s: typeof monitorState) => unknown) => selector(monitorState),
}));
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ selectedNamespace: '*', addDegradedReason: vi.fn(), removeDegradedReason: vi.fn() }),
}));
vi.mock('../../store/fleetStore', () => ({
  useFleetStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ fleetMode: false }),
}));
vi.mock('../../store/trustStore', () => ({
  useTrustStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ trustLevel: 1 }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

function renderBar(over: Partial<typeof monitorState>) {
  Object.assign(monitorState, { findings: [], lastScanTime: null, connected: true }, over);
  // PulseView reads the agent's own trust level through react-query, so it
  // needs a client even when the test is only looking at the posture bar.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PulseViewModule />
    </QueryClientProvider>,
  );
}

describe('the posture bar does not claim health before it has looked', () => {
  afterEach(cleanup);

  it('says it is checking when no scan has landed', () => {
    renderBar({ lastScanTime: null, findings: [] });
    expect(screen.getByText(/Checking the cluster/)).toBeDefined();
    expect(screen.queryByText(/All clear/)).toBeNull();
  });

  it('says all clear once a scan has come back empty', () => {
    renderBar({ lastScanTime: Date.now(), findings: [] });
    expect(screen.getByText(/All clear/)).toBeDefined();
    expect(screen.queryByText(/Checking the cluster/)).toBeNull();
  });

  it('a real finding outranks not having scanned', () => {
    // Findings can arrive before lastScanTime is set. Reporting "checking"
    // over a known problem would be the same lie in the other direction.
    renderBar({ lastScanTime: null, findings: [{ severity: 'warning', title: 'etcd is unhappy' }] });
    expect(screen.queryByText(/Checking the cluster/)).toBeNull();
    expect(screen.getByText(/etcd is unhappy/)).toBeDefined();
  });

  it('still shows the reason it cannot say more', () => {
    renderBar({ lastScanTime: null, findings: [] });
    expect(screen.getByText(/No scan yet/)).toBeDefined();
  });
});
