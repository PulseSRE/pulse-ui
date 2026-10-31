// @vitest-environment jsdom
/**
 * Wave 2, component level: missing or failed data is shown as missing, not
 * as "Stable", 0, "No events", a spinner forever or a made-up location.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, renderHook, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const uiState: Record<string, unknown> = {
  impersonateUser: '', impersonateGroups: [], addDegradedReason: vi.fn(), removeDegradedReason: vi.fn(),
  addToast: vi.fn(), selectedNamespace: '*', bottomDockPanel: 'events', bottomDockHeight: 300,
  setBottomDockHeight: vi.fn(), openBottomDock: vi.fn(), closeBottomDock: vi.fn(), dockContext: null, terminalContext: null,
  closeCommandPalette: vi.fn(),
};
vi.mock('../store/uiStore', () => ({
  useUIStore: Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(uiState), { getState: () => uiState }),
}));
const listWatch: Record<string, { data?: unknown[]; isLoading?: boolean; isError?: boolean; error?: unknown; refetch?: () => void }> = {};
vi.mock('../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => {
    const key = Object.keys(listWatch).find((k) => apiPath.startsWith(k));
    const r = key ? listWatch[key] : { data: [] };
    return { data: r.data, isLoading: !!r.isLoading, isPending: !!r.isLoading, isError: !!r.isError, error: r.error, refetch: r.refetch ?? vi.fn() };
  },
}));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { mockFetchRoutes, expectNoAllClear, renderWithClient } from './helpers/honestStates';
import { QueryState, loadStatus, combineStatus } from '../components/primitives/QueryState';
import { useIncidentTimeline } from '../hooks/useIncidentTimeline';
import { useMapZones, useMapEvents, useMapClusters } from '../components/topology/hooks/useMapData';
import { WorldMap } from '../components/topology/WorldMap';
import { ExhaustionCard } from '../views/compute/ExhaustionCard';
import { AgentStatCard } from '../components/agent/renderers/VisualizationRenderer';
import { BottomDock } from '../components/BottomDock';
import { ComponentsTab } from '../views/toolbox/ComponentsTab';
import { TrustPolicy } from '../views/mission-control/TrustPolicy';
import { ScannerDrawer } from '../views/mission-control/ScannerDrawer';
import { AskPulsePanel } from '../components/AskPulsePanel';
import { AgentHealth } from '../views/mission-control/AgentHealth';

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const k of Object.keys(listWatch)) delete listWatch[k];
});

describe('QueryState', () => {
  it('classifies loading, error, empty and ok', () => {
    expect(loadStatus({ data: undefined, isLoading: true, isError: false })).toBe('loading');
    expect(loadStatus({ data: [], isError: true })).toBe('error');
    expect(loadStatus({ data: [], isError: false })).toBe('empty');
    expect(loadStatus({ data: [1], isError: false })).toBe('ok');
    expect(combineStatus('ok', 'error')).toBe('error');
    expect(combineStatus('empty', 'empty')).toBe('empty');
  });

  it('renders LoadError with a working retry for an error, EmptyState for empty, children for data', () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <QueryState query={{ data: undefined, isError: true, error: new Error('403'), refetch }} errorTitle="X could not be loaded" empty={{ title: 'No X' }}>
        {() => <span>data</span>}
      </QueryState>,
    );
    expect(screen.getByRole('alert').textContent).toContain('X could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
    rerender(
      <QueryState query={{ data: [], isError: false }} errorTitle="X could not be loaded" empty={{ title: 'No X' }}>
        {() => <span>data</span>}
      </QueryState>,
    );
    expect(screen.getByText('No X')).toBeTruthy();
    rerender(
      <QueryState query={{ data: [1], isError: false }} errorTitle="X could not be loaded" empty={{ title: 'No X' }}>
        {(d) => <span>data {d.length}</span>}
      </QueryState>,
    );
    expect(screen.getByText('data 1')).toBeTruthy();
  });
});

describe('useIncidentTimeline', () => {
  it('reports Prometheus as a failed source instead of returning no alerts', async () => {
    mockFetchRoutes({ '/api/prometheus/api/v1/rules': { status: 503, body: {} } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useIncidentTimeline({ timeRange: '1h', categories: new Set(['alert']) }),
      { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
    );
    await waitFor(() => expect(result.current.failedSources).toEqual(['alerts (Prometheus)']));
  });
});

describe('useMapData', () => {
  const node = (name: string, labels: Record<string, string> = {}) => ({ metadata: { name, labels }, status: { conditions: [{ type: 'Ready', status: 'True' }] } });

  it('does not pin an unlabelled zone to a real city', () => {
    const { result } = renderHook(() => useMapZones([node('bm-1'), node('aws-1', { 'topology.kubernetes.io/region': 'us-east-1', 'topology.kubernetes.io/zone': 'us-east-1a' })] as never, []));
    const unknown = result.current.find((z) => z.region === 'unknown')!;
    expect(unknown.locationUnknown).toBe(true);
    const aws = result.current.find((z) => z.region === 'us-east-1')!;
    expect(aws.locationUnknown).toBeUndefined();
  });

  it('flags clusters whose location cannot be resolved', () => {
    const { result } = renderHook(() => useMapClusters([{ id: 'onprem-lab', name: 'onprem-lab', status: 'connected', connectionType: 'acm-proxy' }] as never, []));
    expect(result.current[0].locationUnknown).toBe(true);
  });

  it('counts only Warning events as alerts and drops unclassified Normal events', () => {
    const now = new Date().toISOString();
    const ev = (reason: string, type: string) => ({ metadata: { uid: reason, creationTimestamp: now }, reason, type, message: 'x', lastTimestamp: now, involvedObject: { kind: 'Pod', name: 'p' } });
    const { result } = renderHook(() => useMapEvents([ev('Pulled', 'Normal'), ev('Created', 'Normal'), ev('FailedMount', 'Warning'), ev('Killing', 'Normal')] as never, []));
    expect(result.current.map((e) => e.type).sort()).toEqual(['alert', 'restart']);
    expect(result.current.filter((e) => e.isWarning)).toHaveLength(1);
  });

  it('lists unknown locations in a tray instead of on the map', () => {
    render(
      <WorldMap
        clusters={[]}
        zones={[{ id: 'unknown/unknown', region: 'unknown', zone: 'unknown', latitude: 0, longitude: 0, displayName: 'rack-7', provider: 'Bare Metal', nodeCount: 3, nodeNames: [], healthScore: 95, healthGrade: 'healthy', podCount: 0, locationUnknown: true }]}
        nodes={[]}
        pods={[]}
        stats={{ totalNodes: 3, readyNodes: 3, totalPods: 0, runningPods: 0, failedPods: 0, pendingPods: 0, avgCpu: 0, avgMem: 0, zones: 1, alerts: 0 }}
      />,
    );
    expect(screen.getByTestId('unknown-location-tray').textContent).toMatch(/Unknown location \(1\).*rack-7 · 3 nodes/);
  });
});

describe('ExhaustionCard', () => {
  it('shows "No data", not a green "Stable", when Prometheus returned nothing', () => {
    render(<ExhaustionCard projection={{ resource: 'cpu', currentRatio: null, projectedRatio: null, daysUntilExhaustion: null, growthPerDay: null }} />);
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.queryByText('Stable')).toBeNull();
  });

  it('still says Stable with real data and no exhaustion', () => {
    render(<ExhaustionCard projection={{ resource: 'cpu', currentRatio: 0.4, projectedRatio: 0.41, daysUntilExhaustion: null, growthPerDay: 0 }} />);
    expect(screen.getByText('Stable')).toBeTruthy();
  });
});

describe('AgentStatCard', () => {
  it('shows "no data" for an empty PromQL result instead of 0', async () => {
    mockFetchRoutes({ '/api/prometheus/api/v1/query': { body: { status: 'success', data: { result: [] } } } });
    render(<AgentStatCard spec={{ kind: 'stat_card', title: 'Errors', query: 'sum(x)' } as never} />);
    await waitFor(() => expect(screen.getByText('no data')).toBeTruthy());
    expect(screen.queryByText('0')).toBeNull();
  });

  it('prefers the live value over a stale spec.value', async () => {
    mockFetchRoutes({ '/api/prometheus/api/v1/query': { body: { status: 'success', data: { result: [{ value: [0, '7'] }] } } } });
    render(<AgentStatCard spec={{ kind: 'stat_card', title: 'Errors', query: 'sum(x)', value: '3' } as never} />);
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
    expect(screen.queryByText('3')).toBeNull();
  });
});

describe('BottomDock events', () => {
  it('shows an error with retry, not "No events in the cluster", when the list fails', () => {
    const refetch = vi.fn();
    listWatch['/api/v1/events'] = { data: undefined, isError: true, error: new Error('forbidden'), refetch };
    render(<BottomDock />);
    expect(screen.getByRole('alert').textContent).toContain('Events could not be loaded');
    expect(screen.queryByText('No events in the cluster')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows loading while the list loads', () => {
    listWatch['/api/v1/events'] = { data: undefined, isLoading: true };
    render(<BottomDock />);
    expect(screen.getByText('Loading events…')).toBeTruthy();
    expect(screen.queryByText('No events in the cluster')).toBeNull();
  });
});

describe('ComponentsTab', () => {
  it('shows an error with retry instead of an endless spinner when /components fails', async () => {
    mockFetchRoutes({ '/api/agent/components': { status: 500, body: { detail: 'boom' } } });
    withClient(<ComponentsTab />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Component kinds could not be loaded'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('TrustPolicy', () => {
  it('says supported categories are "not reported" instead of showing a hard-coded list', () => {
    withClient(<TrustPolicy maxTrustLevel={3} scannerCount={5} fixSummary={null} supportedAutoFixCategories={[]} />);
    expect(screen.getByText(/Supported auto-fix categories: not reported/)).toBeTruthy();
    expect(screen.queryByText('Crashlooping pods')).toBeNull();
  });

  it('lists exactly what the server reports', () => {
    withClient(<TrustPolicy maxTrustLevel={3} scannerCount={5} fixSummary={null} supportedAutoFixCategories={['crashloop']} />);
    expect(screen.getByText('Crashlooping pods')).toBeTruthy();
    expect(screen.queryByText('Image pull errors')).toBeNull();
  });
});

describe('ScannerDrawer', () => {
  it('does not hard-code the interval or point at a page that does not exist, and takes auto-fix from the server', () => {
    const coverage = { active_scanners: 2, total_scanners: 2, coverage_pct: 100, categories: [], per_scanner: [
      { name: 'crashloop', enabled: true, finding_count: 0, actionable_count: 0, noise_pct: 0 },
      { name: 'workloads', enabled: true, finding_count: 0, actionable_count: 0, noise_pct: 0 },
    ] };
    render(<ScannerDrawer coverage={coverage} supportedAutoFixCategories={['crashloop']} onClose={() => {}} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/every 60 seconds/);
    expect(text).not.toMatch(/Incident Center/);
    expect(text).toMatch(/Findings appear in the Inbox/);
    expect(text).toMatch(/only change what this browser/);
    expect(screen.getAllByText('auto-fix')).toHaveLength(1);
  });
});

describe('AgentHealth', () => {
  it('labels fix actions as fixes, not findings', () => {
    render(
      <AgentHealth evalStatus={null} coverage={null} confidence={null} costStats={null} readiness={null}
        fixSummary={{ total_actions: 5, completed: 4, failed: 0, rolled_back: 1 } as never}
        onOpenScannerDrawer={() => {}} onOpenEvalDrawer={() => {}} onOpenMemoryDrawer={() => {}} />,
    );
    const line = screen.getByText('4 fixed').parentElement!;
    expect(line.textContent).toMatch(/^5 fixes/);
    expect(line.textContent).not.toMatch(/findings/);
  });
});

describe('AskPulsePanel', () => {
  it('does not label the "press Enter" prompt as a sample response', () => {
    withClient(
      <AskPulsePanel query="why is x" isLoading={false} onSuggestionClick={() => {}} agentAvailable={false}
        response={{ text: 'Press Enter or click Open in Agent to ask Pulse: "why is x"', suggestions: [], actions: [], fromAgent: false }} />,
    );
    expect(document.body.textContent).not.toMatch(/sample response/i);
    expect(document.body.innerHTML).not.toMatch(/sample responses/i);
  });
});

describe('expectNoAllClear helper', () => {
  it('fails on all-clear copy and passes on an error state', () => {
    renderWithClient(<div role="alert">Could not read</div>);
    expectNoAllClear();
    cleanup();
    render(<div>All clusters are quiet</div>);
    expect(() => expectNoAllClear()).toThrow();
  });
});
