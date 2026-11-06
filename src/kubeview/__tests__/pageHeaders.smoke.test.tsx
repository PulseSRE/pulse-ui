// @vitest-environment jsdom
/**
 * Consistency PR 5: every domain page has exactly one `<h1>`, rendered by the
 * shared PageHeader. Each page is rendered with every read failing (403), the
 * state in which several pages used to drop their header.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, act } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

vi.mock('../hooks/useK8sListWatch', () => ({
  useK8sListWatch: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div>, Sparkline: () => <div /> }));
vi.mock('../components/metrics/MetricsChart', () => ({ MetricsChart: () => <div data-testid="chart" /> }));

import { renderWithFailedRequests } from './helpers/honestStates';
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

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAGES: Array<[string, React.ReactElement, string?]> = [
  ['Workloads', <WorkloadsView />],
  ['Workloads', <WorkloadsView />, '/workloads?tab=builds'],
  ['Networking', <NetworkingView />],
  ['Compute', <ComputeView />],
  ['Storage', <StorageView />],
  ['Security', <SecurityView />],
  ['Identity & Access', <IdentityView />],
  ['alice', <Routes><Route path="/identity/users/:name" element={<SubjectAccessView kind="User" />} /></Routes>, '/identity/users/alice'],
  ['Administration', <AdminView />],
  ['Alerts', <AlertsView />],
  ['GitOps', <ArgoCDView />],
  ['Fleet', <FleetView />],
  ['Compare & Drift', <FleetComparePage />],
  ['Fleet Compliance', <ComplianceView />],
  ['Fleet Workloads', <FleetWorkloadsView />],
  ['Fleet Alerts', <FleetAlertsView />],
  ['Fleet Deployments', <FleetResourceView gvrKey="apps/v1/deployments" />],
  ['Inbox', <InboxPage />],
  ['Cluster Readiness', <OnboardingView />],
  ['About OpenShift Pulse', <AboutView />],
  ['Your Views', <ViewsManagement />],
  ['Pulse Agent', <PulseAgentView />],
  ['Service Level Objectives', <SloView />],
  ['Topology', <TopologyView />],
  ['Operator Catalog', <OperatorCatalogView />],
  ['shop', <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>, '/project/shop'],
  ['Cluster Timeline', <TimelineView />],
  ['Software', <CreateView />, '/software'],
  ['Cluster Pulse', <PulseView />],
];

describe('domain pages have exactly one <h1>, from PageHeader', () => {
  it.each(PAGES.map(([title, ui, route]) => [`${title}${route ? ` (${route})` : ''}`, title, ui, route] as const))(
    '%s',
    async (_name, title, ui, route) => {
      renderWithFailedRequests(ui, { route });
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0));
      // Let failed reads settle; a page must not grow a second <h1> afterwards.
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      const h1s = screen.getAllByRole('heading', { level: 1 });
      expect(h1s.map((h) => h.textContent)).toEqual([expect.stringContaining(title)]);
      expect(h1s[0].closest('header')).not.toBeNull();
    },
  );
});
