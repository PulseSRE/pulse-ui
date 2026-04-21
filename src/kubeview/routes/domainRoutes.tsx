import { Navigate, Route, useParams } from 'react-router-dom';
import React, { Suspense, lazy } from 'react';

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
const IncidentCenterView = lazy(() => import('../views/IncidentCenterView'));
const InboxPage = lazy(() => import('../views/InboxPage').then(m => ({ default: m.InboxPage })));
const OnboardingView = lazy(() => import('../views/OnboardingView'));
const PulseAgentView = lazy(() => import('../views/PulseAgentView'));
const ViewsManagement = lazy(() => import('../views/ViewsManagement'));
const AdminExtensionsView = lazy(() => import('../views/AdminExtensionsView'));
const SloView = lazy(() => import('../views/SloView'));
const TopologyView = lazy(() => import('../views/TopologyView'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="kv-skeleton w-8 h-8 rounded-full" />
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingFallback />}>{children}</Suspense>;
}

function FleetResourceRoute() {
  const { gvr } = useParams<{ gvr: string }>();
  const gvrKey = (gvr || '').replace(/~/g, '/');
  return <FleetResourceView gvrKey={gvrKey} />;
}

function DynamicViewRedirectRoute() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/custom/${id}`} replace />;
}

export function domainRoutes() {
  return (
    <>
      <Route path="workloads" element={<Lazy><WorkloadsView /></Lazy>} />
      <Route path="networking" element={<Lazy><NetworkingView /></Lazy>} />
      <Route path="compute" element={<Lazy><ComputeView /></Lazy>} />
      <Route path="storage" element={<Lazy><StorageView /></Lazy>} />
      <Route path="builds" element={<Navigate to="/workloads?tab=builds" replace />} />
      <Route path="crds" element={<Navigate to="/admin?tab=crds" replace />} />
      <Route path="security" element={<Lazy><SecurityView /></Lazy>} />
      <Route path="access-control" element={<Navigate to="/identity?tab=rbac" replace />} />
      <Route path="users" element={<Navigate to="/identity?tab=users" replace />} />
      <Route path="identity" element={<Lazy><IdentityView /></Lazy>} />
      <Route path="admin" element={<Lazy><AdminView /></Lazy>} />
      <Route path="alerts" element={<Navigate to="/inbox?type=alert" replace />} />
      <Route path="gitops" element={<Lazy><ArgoCDView /></Lazy>} />
      <Route path="fleet" element={<Lazy><FleetView /></Lazy>} />
      <Route path="fleet/compare" element={<Lazy><CompareView /></Lazy>} />
      <Route path="fleet/compliance" element={<Lazy><ComplianceView /></Lazy>} />
      <Route path="fleet/workloads" element={<Lazy><FleetWorkloadsView /></Lazy>} />
      <Route path="fleet/alerts" element={<Lazy><FleetAlertsView /></Lazy>} />
      <Route path="fleet/r/:gvr" element={<Lazy><FleetResourceRoute /></Lazy>} />
      <Route path="fleet/drift" element={<Lazy><DriftDetectorView /></Lazy>} />
      <Route path="inbox" element={<Lazy><InboxPage /></Lazy>} />
      <Route path="monitor" element={<Navigate to="/inbox" replace />} />
      <Route path="dynamic/:id" element={<DynamicViewRedirectRoute />} />
      <Route path="incidents" element={<Navigate to="/inbox" replace />} />
      <Route path="readiness" element={<Lazy><OnboardingView /></Lazy>} />
      <Route path="onboarding" element={<Navigate to="/readiness" replace />} />
      <Route path="reviews" element={<Navigate to="/inbox?preset=needs_approval" replace />} />
      <Route path="memory" element={<Navigate to="/agent" replace />} />
      <Route path="views" element={<Lazy><ViewsManagement /></Lazy>} />
      <Route path="agent" element={<Lazy><PulseAgentView /></Lazy>} />
      <Route path="toolbox" element={<Navigate to="/agent?tab=tools" replace />} />
      <Route path="slo" element={<Lazy><SloView /></Lazy>} />
      <Route path="topology" element={<Lazy><TopologyView /></Lazy>} />
      <Route path="tools" element={<Navigate to="/agent?tab=tools" replace />} />
      <Route path="extensions" element={<Navigate to="/agent?tab=skills" replace />} />
    </>
  );
}
