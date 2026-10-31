import { Route, Navigate, useParams } from 'react-router-dom';
import React, { Suspense, lazy } from 'react';
import { LoadingFallback } from '../components/LoadingFallback';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { DOMAIN_ROUTES } from '../engine/routeTable';

const StorageView = lazy(() => import('../views/StorageView'));
const AdminView = lazy(() => import('../views/AdminView'));
const WorkloadsView = lazy(() => import('../views/WorkloadsView'));
const NetworkingView = lazy(() => import('../views/NetworkingView'));
const ComputeView = lazy(() => import('../views/ComputeView'));
const SecurityView = lazy(() => import('../views/SecurityView'));
const IdentityView = lazy(() => import('../views/IdentityView'));
const ArgoCDView = lazy(() => import('../views/ArgoCDView'));
const FleetView = lazy(() => import('../views/FleetView'));
const FleetComparePage = lazy(() => import('../views/fleet/FleetComparePage'));
const ComplianceView = lazy(() => import('../views/fleet/ComplianceView'));
const FleetResourceView = lazy(() => import('../views/fleet/FleetResourceView'));
const FleetWorkloadsView = lazy(() => import('../views/fleet/FleetWorkloadsView'));
const FleetAlertsView = lazy(() => import('../views/fleet/FleetAlertsView'));
const InboxPage = lazy(() => import('../views/InboxPage').then(m => ({ default: m.InboxPage })));
const OnboardingView = lazy(() => import('../views/OnboardingView'));
const AboutView = lazy(() => import('../views/AboutView'));
const PulseAgentView = lazy(() => import('../views/PulseAgentView'));
const ViewsManagement = lazy(() => import('../views/ViewsManagement'));
const AlertsView = lazy(() => import('../views/AlertsView'));
const OperatorCatalogView = lazy(() => import('../views/OperatorCatalogView'));
const ProjectDashboard = lazy(() => import('../views/ProjectDashboard'));
const TimelineView = lazy(() => import('../views/TimelineView'));
const SloView = lazy(() => import('../views/SloView'));
const TopologyView = lazy(() => import('../views/TopologyView'));

function Lazy({ children, fallbackTitle }: { children: React.ReactNode; fallbackTitle?: string }) {
  return (
    <ErrorBoundary fallbackTitle={fallbackTitle}>
      <Suspense fallback={<LoadingFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function FleetResourceRoute() {
  const { gvr } = useParams<{ gvr: string }>();
  const gvrKey = (gvr || '').replace(/~/g, '/');
  return <FleetResourceView gvrKey={gvrKey} />;
}

export function domainRoutes() {
  return (
    <>
      <Route path={DOMAIN_ROUTES.workloads} element={<Lazy fallbackTitle="Workloads"><WorkloadsView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.networking} element={<Lazy fallbackTitle="Networking"><NetworkingView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.compute} element={<Lazy fallbackTitle="Compute"><ComputeView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.storage} element={<Lazy fallbackTitle="Storage"><StorageView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.security} element={<Lazy fallbackTitle="Security"><SecurityView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.identity} element={<Lazy fallbackTitle="Identity"><IdentityView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.admin} element={<Lazy fallbackTitle="Admin"><AdminView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.alerts} element={<Lazy fallbackTitle="Alerts"><AlertsView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.gitops} element={<Lazy fallbackTitle="GitOps"><ArgoCDView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.fleet} element={<Lazy fallbackTitle="Fleet"><FleetView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.fleetCompare} element={<Lazy fallbackTitle="Fleet Compare"><FleetComparePage /></Lazy>} />
      <Route path={DOMAIN_ROUTES.fleetCompliance} element={<Lazy fallbackTitle="Fleet Compliance"><ComplianceView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.fleetWorkloads} element={<Lazy fallbackTitle="Fleet Workloads"><FleetWorkloadsView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.fleetAlerts} element={<Lazy fallbackTitle="Fleet Alerts"><FleetAlertsView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.fleetResource} element={<Lazy fallbackTitle="Fleet Resource"><FleetResourceRoute /></Lazy>} />
      {/* Drift Detector is the "One resource" mode of Compare & Drift. */}
      <Route path={DOMAIN_ROUTES.fleetDrift} element={<Navigate to="/fleet/compare?mode=resource" replace />} />
      <Route path={DOMAIN_ROUTES.inbox} element={<Lazy fallbackTitle="Inbox"><InboxPage /></Lazy>} />
      <Route path={DOMAIN_ROUTES.readiness} element={<Lazy fallbackTitle="Readiness"><OnboardingView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.about} element={<Lazy fallbackTitle="About"><AboutView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.views} element={<Lazy fallbackTitle="Views"><ViewsManagement /></Lazy>} />
      <Route path={DOMAIN_ROUTES.agent} element={<Lazy fallbackTitle="Agent"><PulseAgentView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.slo} element={<Lazy fallbackTitle="SLO"><SloView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.topology} element={<Lazy fallbackTitle="Topology"><TopologyView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.operators} element={<Lazy fallbackTitle="Operators"><OperatorCatalogView /></Lazy>} />
      <Route path={DOMAIN_ROUTES.project} element={<Lazy fallbackTitle="Project"><ProjectDashboard /></Lazy>} />
      <Route path={DOMAIN_ROUTES.timeline} element={<Lazy fallbackTitle="Timeline"><TimelineView /></Lazy>} />
    </>
  );
}
