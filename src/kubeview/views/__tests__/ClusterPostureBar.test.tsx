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
// The real feed includes the monitor's findings (DEFAULT_SOURCES has
// 'finding') and reads them from the same store in the same render, so it can
// never be empty while findings exist. The mock mirrors that: by default it
// derives its incidents from monitorState.findings, sorted by severity, and a
// test can add items from other sources (alerts, errors) on top.
type FeedItem = { severity: 'critical' | 'warning' | 'info'; title: string; correlationKey?: string };
const feedExtras: FeedItem[] = [];
const SEV = { critical: 0, warning: 1, info: 2 } as const;
function feedFromState() {
  const byKey = new Map<string, FeedItem>();
  const all = [
    ...monitorState.findings.map((f) => ({ ...f, severity: f.severity as FeedItem['severity'] })),
    ...feedExtras,
  ];
  for (const item of all) byKey.set(item.correlationKey ?? item.title, item);
  const incidents = [...byKey.values()].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const counts = { critical: 0, warning: 0, info: 0, total: incidents.length };
  for (const i of incidents) counts[i.severity]++;
  return { incidents, counts, isLoading: false };
}
vi.mock('../../hooks/useIncidentFeed', () => ({ useIncidentFeed: () => feedFromState() }));
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
  findings: [] as Array<{ severity: string; title: string; correlationKey?: string }>,
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
vi.mock('../../store/trustStore', async () => {
  // Keep the real ladder maps: PulseView renders the badge tooltip from them,
  // and a partial mock here would let the labels drift without a test noticing.
  const actual = await vi.importActual<typeof import('../../store/trustStore')>('../../store/trustStore');
  return {
    ...actual,
    useTrustStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ trustLevel: 1 }),
  };
});
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

function renderBar(over: Partial<typeof monitorState>, extras: FeedItem[] = []) {
  Object.assign(monitorState, { findings: [], lastScanTime: null, connected: true }, over);
  feedExtras.splice(0, feedExtras.length, ...extras);
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

describe('the posture bar counts each problem once and names one it counted', () => {
  afterEach(cleanup);

  // The count used to be `feed.warning + findings.length`, but the feed
  // already contains every finding, so two findings read as "4 warnings".
  it('does not add monitor findings on top of a feed that already includes them', () => {
    renderBar({
      lastScanTime: Date.now(),
      findings: [
        { severity: 'warning', title: 'etcd is unhappy' },
        { severity: 'warning', title: 'disk filling' },
      ],
    });
    expect(screen.getByText('2 warnings')).toBeDefined();
    expect(screen.queryByText('4 warnings')).toBeNull();
  });

  // The headline used to be findings[0] while the number came from the feed,
  // so "1 critical — <title>" could name an info-level finding.
  it('takes the headline from the same list as the critical count', () => {
    renderBar(
      { lastScanTime: Date.now(), findings: [{ severity: 'info', title: 'SearchPVCNotPresent' }] },
      [{ severity: 'critical', title: 'KubeAPIDown' }],
    );
    expect(screen.getByText('1 critical')).toBeDefined();
    expect(screen.getByText(/KubeAPIDown/)).toBeDefined();
    expect(screen.queryByText(/SearchPVCNotPresent/)).toBeNull();
  });

  it('takes the warning headline from the warnings it counts, not an info finding', () => {
    renderBar(
      { lastScanTime: Date.now(), findings: [{ severity: 'info', title: 'just so you know' }] },
      [{ severity: 'warning', title: 'CPUThrottlingHigh' }],
    );
    expect(screen.getByText('1 warning')).toBeDefined();
    expect(screen.getByText(/CPUThrottlingHigh/)).toBeDefined();
    expect(screen.queryByText(/just so you know/)).toBeNull();
  });
});
