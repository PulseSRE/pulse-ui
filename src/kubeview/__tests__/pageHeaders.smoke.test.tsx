// @vitest-environment jsdom
/**
 * Consistency PR 5: every domain page, including its loading, empty and
 * not-available states, has exactly one `<h1>`, rendered by the shared
 * PageHeader, and keeps its key action. Pages are rendered with every read
 * failing (403), the state in which several pages used to drop their header.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, act, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

const flags = vi.hoisted(() => ({
  /** No connected clusters in the fleet. */
  emptyFleet: false,
  /** Fleet reads never answer (loading state). */
  fleetPending: false,
  /** The active cluster's Prometheus is out of reach (remote cluster). */
  metricsUnavailable: false,
}));

vi.mock('../hooks/useK8sListWatch', () => ({
  useK8sListWatch: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div>, Sparkline: () => <div /> }));
vi.mock('../components/metrics/MetricsChart', () => ({ MetricsChart: () => <div data-testid="chart" /> }));
vi.mock('../engine/clusterConnection', async () => {
  const actual = await vi.importActual<typeof import('../engine/clusterConnection')>('../engine/clusterConnection');
  return { ...actual, getAllConnections: () => (flags.emptyFleet ? [] : actual.getAllConnections()) };
});
vi.mock('../engine/fleet', async () => {
  const actual = await vi.importActual<typeof import('../engine/fleet')>('../engine/fleet');
  return {
    ...actual,
    fleetList: (...args: Parameters<typeof actual.fleetList>) =>
      flags.fleetPending ? new Promise(() => {}) : flags.emptyFleet ? Promise.resolve([]) : actual.fleetList(...args),
  };
});
vi.mock('../hooks/useClusterBase', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useClusterBase')>('../hooks/useClusterBase');
  return { ...actual, useMetricsAvailable: () => (flags.metricsUnavailable ? false : actual.useMetricsAvailable()) };
});

import { renderWithFailedRequests, type MockRoute } from './helpers/honestStates';
import { useArgoCDStore } from '../store/argoCDStore';
import WorkloadsView from '../views/WorkloadsView';
import NetworkingView from '../views/NetworkingView';
import ComputeView from '../views/ComputeView';
import StorageView from '../views/StorageView';
import SecurityView from '../views/SecurityView';
import IdentityView from '../views/IdentityView';
import SubjectAccessView from '../views/identity/SubjectAccessView';
import AdminView from '../views/AdminView';
import AlertsView from '../views/AlertsView';
import ArgoCDView from '../views/ArgoCDView';
import FleetView from '../views/FleetView';
import FleetComparePage from '../views/fleet/FleetComparePage';
import ComplianceView from '../views/fleet/ComplianceView';
import FleetWorkloadsView from '../views/fleet/FleetWorkloadsView';
import FleetAlertsView from '../views/fleet/FleetAlertsView';
import FleetResourceView from '../views/fleet/FleetResourceView';
import { InboxPage } from '../views/InboxPage';
import OnboardingView from '../views/OnboardingView';
import AboutView from '../views/AboutView';
import ViewsManagement from '../views/ViewsManagement';
import PulseAgentView from '../views/PulseAgentView';
import SloView from '../views/SloView';
import TopologyView from '../views/TopologyView';
import OperatorCatalogView from '../views/OperatorCatalogView';
import ProjectDashboard from '../views/ProjectDashboard';
import TimelineView from '../views/TimelineView';
import CreateView from '../views/CreateView';
import PulseView from '../views/PulseView';

const resetFlags = () => { flags.emptyFleet = false; flags.fleetPending = false; flags.metricsUnavailable = false; };
beforeEach(() => { vi.unstubAllGlobals(); resetFlags(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetFlags();
  useArgoCDStore.getState().reset();
});

const lokiManifest = {
  metadata: { name: 'loki-operator', namespace: 'openshift-marketplace' },
  status: {
    catalogSource: 'redhat-operators', catalogSourceNamespace: 'openshift-marketplace', defaultChannel: 'stable-6.1', provider: { name: 'Red Hat' },
    channels: [{ name: 'stable-6.1', currentCSV: 'loki.v6.1.0', currentCSVDesc: { displayName: 'Loki Operator', description: 'Logs', icon: [], version: '6.1.0', provider: { name: 'Red Hat' }, installModes: [{ type: 'AllNamespaces', supported: true }] } }],
  },
};

type Role = Parameters<typeof screen.getAllByRole>[0];
interface Case {
  name: string;
  title: string;
  ui: () => React.ReactElement;
  route?: string;
  routes?: Record<string, MockRoute>;
  setup?: () => void;
  /** A key action that must still be there; `header: true` means it sits in the page header. */
  action: { role: Role; name: string | RegExp; header?: boolean };
  /** The page also shows the fleet sub-nav. */
  fleetNav?: boolean;
}

const sa = <Routes><Route path="/identity/users/:name" element={<SubjectAccessView kind="User" />} /></Routes>;
const project = <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>;

const CASES: Case[] = [
  { name: 'Workloads', title: 'Workloads', ui: () => <WorkloadsView />, action: { role: 'tab', name: 'Builds' } },
  { name: 'Workloads › Builds', title: 'Workloads', ui: () => <WorkloadsView />, route: '/workloads?tab=builds', action: { role: 'tab', name: 'Workloads' } },
  { name: 'Networking', title: 'Networking', ui: () => <NetworkingView />, action: { role: 'button', name: /Service/, header: true } },
  { name: 'Compute', title: 'Compute', ui: () => <ComputeView />, action: { role: 'tab', name: 'Capacity Planning' } },
  { name: 'Storage', title: 'Storage', ui: () => <StorageView />, action: { role: 'button', name: /Create PVC/, header: true } },
  { name: 'Security', title: 'Security', ui: () => <SecurityView />, action: { role: 'button', name: 'Run a full security audit' } },
  { name: 'Identity & Access', title: 'Identity & Access', ui: () => <IdentityView />, action: { role: 'tab', name: 'Access review' } },
  { name: 'User access', title: 'alice', ui: () => sa, route: '/identity/users/alice', action: { role: 'button', name: /Remove access/, header: true } },
  { name: 'Administration', title: 'Administration', ui: () => <AdminView />, action: { role: 'tab', name: 'Updates' } },
  { name: 'Alerts', title: 'Alerts', ui: () => <AlertsView />, action: { role: 'tab', name: 'Silences' } },
  { name: 'Alerts, remote cluster', title: 'Alerts', ui: () => <AlertsView />, setup: () => { flags.metricsUnavailable = true; }, action: { role: 'heading', name: /Alerts and silences are available for the local cluster only/ } },
  { name: 'GitOps, not installed', title: 'GitOps', ui: () => <ArgoCDView />, action: { role: 'button', name: 'Start Setup Wizard' } },
  {
    name: 'GitOps, detecting Argo CD', title: 'GitOps', ui: () => <ArgoCDView />,
    setup: () => useArgoCDStore.setState({ detecting: true, detected: false }),
    action: { role: 'status', name: 'Detecting Argo CD' },
  },
  { name: 'Fleet', title: 'Fleet', ui: () => <FleetView />, action: { role: 'button', name: 'Detect ACM' } },
  { name: 'Compare & Drift', title: 'Compare & Drift', ui: () => <FleetComparePage />, action: { role: 'radio', name: 'Cluster configuration' }, fleetNav: true },
  { name: 'Fleet Compliance', title: 'Fleet Compliance', ui: () => <ComplianceView />, action: { role: 'button', name: /Re-scan|Scanning/, header: true }, fleetNav: true },
  {
    name: 'Fleet Compliance, no clusters', title: 'Fleet Compliance', ui: () => <ComplianceView />, setup: () => { flags.emptyFleet = true; },
    action: { role: 'heading', name: 'No Clusters Connected' }, fleetNav: true,
  },
  { name: 'Fleet Workloads', title: 'Fleet Workloads', ui: () => <FleetWorkloadsView />, action: { role: 'button', name: 'Retry' }, fleetNav: true },
  {
    name: 'Fleet Workloads, loading', title: 'Fleet Workloads', ui: () => <FleetWorkloadsView />, setup: () => { flags.fleetPending = true; },
    action: { role: 'status', name: 'Loading fleet workloads' }, fleetNav: true,
  },
  {
    name: 'Fleet Workloads, no clusters', title: 'Fleet Workloads', ui: () => <FleetWorkloadsView />, setup: () => { flags.emptyFleet = true; },
    action: { role: 'button', name: 'Compliance' }, fleetNav: true,
  },
  { name: 'Fleet Alerts', title: 'Fleet Alerts', ui: () => <FleetAlertsView />, action: { role: 'button', name: 'Retry' }, fleetNav: true },
  {
    name: 'Fleet Alerts, no clusters', title: 'Fleet Alerts', ui: () => <FleetAlertsView />, setup: () => { flags.emptyFleet = true; },
    action: { role: 'button', name: 'Compliance' }, fleetNav: true,
  },
  { name: 'Fleet resource', title: 'Fleet Deployments', ui: () => <FleetResourceView gvrKey="apps/v1/deployments" />, action: { role: 'combobox', name: 'Filter by cluster', header: true }, fleetNav: true },
  {
    name: 'Fleet resource, no clusters', title: 'Fleet Deployments', ui: () => <FleetResourceView gvrKey="apps/v1/deployments" />, setup: () => { flags.emptyFleet = true; },
    action: { role: 'button', name: 'Compliance' }, fleetNav: true,
  },
  { name: 'Inbox', title: 'Inbox', ui: () => <InboxPage />, action: { role: 'button', name: /New Task/, header: true } },
  { name: 'Readiness', title: 'Cluster Readiness', ui: () => <OnboardingView />, action: { role: 'button', name: 'Checklist', header: true } },
  { name: 'About', title: 'About OpenShift Pulse', ui: () => <AboutView />, action: { role: 'heading', name: /About OpenShift Pulse/ } },
  { name: 'Views', title: 'Your Views', ui: () => <ViewsManagement />, action: { role: 'button', name: /Import View/, header: true } },
  { name: 'Pulse Agent', title: 'Pulse Agent', ui: () => <PulseAgentView />, action: { role: 'tab', name: /Skills/ } },
  { name: 'Service Levels', title: 'Service Level Objectives', ui: () => <SloView />, action: { role: 'button', name: /Add SLO/, header: true } },
  { name: 'Topology, load error', title: 'Topology', ui: () => <TopologyView />, action: { role: 'button', name: /Retry/ } },
  { name: 'Operator Catalog', title: 'Operator Catalog', ui: () => <OperatorCatalogView />, action: { role: 'button', name: /Platform operators/, header: true } },
  {
    name: 'Operator detail', title: 'Loki Operator', ui: () => <OperatorCatalogView />, route: '/operators?pkg=loki-operator',
    routes: { '/apis/packages.operators.coreos.com': { body: { items: [lokiManifest] } } },
    action: { role: 'link', name: 'Back to catalog', header: true },
  },
  { name: 'Project', title: 'shop', ui: () => project, route: '/project/shop', action: { role: 'button', name: /Create in shop/, header: true } },
  { name: 'Timeline', title: 'Cluster Timeline', ui: () => <TimelineView />, action: { role: 'button', name: '24h' } },
  { name: 'Software', title: 'Software', ui: () => <CreateView />, route: '/software', action: { role: 'tab', name: /Helm Charts/ } },
  { name: 'Cluster Pulse', title: 'Cluster Pulse', ui: () => <PulseView />, action: { role: 'button', name: /Scan Now/, header: true } },
];

describe('domain pages have exactly one <h1>, from PageHeader, and keep their key action', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    c.setup?.();
    renderWithFailedRequests(c.ui(), { route: c.route, routes: c.routes });
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([expect.stringContaining(c.title)]));
    // Let failed reads settle; a page must not grow a second <h1> or lose its header afterwards.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s.map((h) => h.textContent)).toEqual([expect.stringContaining(c.title)]);
    const header = h1s[0].closest('header');
    expect(header).not.toBeNull();

    const scope = c.action.header ? within(header!) : screen;
    expect(scope.getAllByRole(c.action.role, { name: c.action.name }).length).toBeGreaterThan(0);

    if (c.fleetNav) {
      const nav = screen.getByRole('navigation', { name: 'Fleet pages' });
      expect(within(nav).getByRole('button', { name: 'Compliance' })).toBeTruthy();
    }
  });
});
