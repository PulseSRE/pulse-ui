import { Route, Navigate, useParams } from 'react-router-dom';
import React, { Suspense, lazy } from 'react';
import { LoadingFallback } from '../components/LoadingFallback';
import { ErrorBoundary } from '../components/ErrorBoundary';

const StorageView = lazy(() => import('../views/StorageView'));
const AdminView = lazy(() => import('../views/AdminView'));
const WorkloadsView = lazy(() => import('../views/WorkloadsView'));
const NetworkingView = lazy(() => import('../views/NetworkingView'));
const ComputeView = lazy(() => import('../views/ComputeView'));
const SecurityView = lazy(() => import('../views/SecurityView'));
const IdentityView = lazy(() => import('../views/IdentityView'));
const ArgoCDView = lazy(() => import('../views/ArgoCDView'));
const FleetView = lazy(() => import('../views/FleetView'));
const CompareView = lazy(() => import('../views/fleet/CompareView'));
const ComplianceView = lazy(() => import('../views/fleet/ComplianceView'));
const FleetResourceView = lazy(() => import('../views/fleet/FleetResourceView'));
const FleetWorkloadsView = lazy(() => import('../views/fleet/FleetWorkloadsView'));
const FleetAlertsView = lazy(() => import('../views/fleet/FleetAlertsView'));
const DriftDetectorView = lazy(() => import('../views/fleet/DriftDetectorView').then(m => ({ default: m.DriftDetectorView })));
const InboxPage = lazy(() => import('../views/InboxPage').then(m => ({ default: m.InboxPage })));
const OnboardingView = lazy(() => import('../views/OnboardingView'));
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
      <Route path="workloads" element={<Lazy fallbackTitle="Workloads"><WorkloadsView /></Lazy>} />
      <Route path="networking" element={<Lazy fallbackTitle="Networking"><NetworkingView /></Lazy>} />
      <Route path="compute" element={<Lazy fallbackTitle="Compute"><ComputeView /></Lazy>} />
      <Route path="storage" element={<Lazy fallbackTitle="Storage"><StorageView /></Lazy>} />
      <Route path="security" element={<Lazy fallbackTitle="Security"><SecurityView /></Lazy>} />
      <Route path="identity" element={<Lazy fallbackTitle="Identity"><IdentityView /></Lazy>} />
      <Route path="admin" element={<Lazy fallbackTitle="Admin"><AdminView /></Lazy>} />
      <Route path="alerts" element={<Lazy fallbackTitle="Alerts"><AlertsView /></Lazy>} />
      <Route path="gitops" element={<Lazy fallbackTitle="GitOps"><ArgoCDView /></Lazy>} />
      <Route path="fleet" element={<Lazy fallbackTitle="Fleet"><FleetView /></Lazy>} />
      <Route path="fleet/compare" element={<Lazy fallbackTitle="Fleet Compare"><CompareView /></Lazy>} />
      <Route path="fleet/compliance" element={<Lazy fallbackTitle="Fleet Compliance"><ComplianceView /></Lazy>} />
      <Route path="fleet/workloads" element={<Lazy fallbackTitle="Fleet Workloads"><FleetWorkloadsView /></Lazy>} />
      <Route path="fleet/alerts" element={<Lazy fallbackTitle="Fleet Alerts"><FleetAlertsView /></Lazy>} />
      <Route path="fleet/r/:gvr" element={<Lazy fallbackTitle="Fleet Resource"><FleetResourceRoute /></Lazy>} />
      <Route path="fleet/drift" element={<Lazy fallbackTitle="Drift Detector"><DriftDetectorView /></Lazy>} />
      <Route path="inbox" element={<Lazy fallbackTitle="Inbox"><InboxPage /></Lazy>} />
      <Route path="readiness" element={<Lazy fallbackTitle="Readiness"><OnboardingView /></Lazy>} />
      <Route path="views" element={<Lazy fallbackTitle="Views"><ViewsManagement /></Lazy>} />
      <Route path="agent" element={<Lazy fallbackTitle="Agent"><PulseAgentView /></Lazy>} />
      <Route path="toolbox" element={<Navigate to="/agent" replace />} />
      <Route path="slo" element={<Lazy fallbackTitle="SLO"><SloView /></Lazy>} />
      <Route path="topology" element={<Lazy fallbackTitle="Topology"><TopologyView /></Lazy>} />
      <Route path="operators" element={<Lazy fallbackTitle="Operators"><OperatorCatalogView /></Lazy>} />
      <Route path="project/:namespace" element={<Lazy fallbackTitle="Project"><ProjectDashboard /></Lazy>} />
      <Route path="timeline" element={<Lazy fallbackTitle="Timeline"><TimelineView /></Lazy>} />
    </>
  );
}
