import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { Shell } from './components/Shell';
import PulseView from './views/PulseView';
import WelcomeView from './views/WelcomeView';
import TableView from './views/TableView';
import DetailView from './views/DetailView';
// TimelineView is now lazy-loaded inside AdminView
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// Lazy-loaded heavy components
const YamlEditorView = lazy(() => import('./views/YamlEditorView'));
const LogsView = lazy(() => import('./views/LogsView'));
const MetricsView = lazy(() => import('./views/MetricsView'));
const CorrelationView = lazy(() => import('./views/CorrelationView'));
const CreateView = lazy(() => import('./views/CreateView'));
const DependencyView = lazy(() => import('./views/DependencyView'));
const NodeLogsView = lazy(() => import('./views/NodeLogsView'));
const AccessControlView = lazy(() => import('./views/AccessControlView'));
const UserManagementView = lazy(() => import('./views/UserManagementView'));
const StorageView = lazy(() => import('./views/StorageView'));
const AdminView = lazy(() => import('./views/AdminView'));
const AlertsView = lazy(() => import('./views/AlertsView'));
const WorkloadsView = lazy(() => import('./views/WorkloadsView'));
const NetworkingView = lazy(() => import('./views/NetworkingView'));
const ComputeView = lazy(() => import('./views/ComputeView'));
const BuildsView = lazy(() => import('./views/BuildsView'));
const CRDsView = lazy(() => import('./views/CRDsView'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="kv-skeleton w-8 h-8 rounded-full" />
    </div>
  );
}

/**
 * Route wrapper that extracts GVR from URL params.
 * URL format: /r/:gvr where gvr uses ~ as separator
 * e.g., /r/apps~v1~deployments → gvrKey = "apps/v1/deployments"
 *        /r/v1~pods            → gvrKey = "v1/pods"
 */
function ResourceListRoute() {
  const { gvr } = useParams<{ gvr: string }>();
  if (!gvr) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return <TableView gvrKey={gvrKey} />;
}

function ResourceDetailRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return <DetailView gvrKey={gvrKey} namespace={namespace} name={name} />;
}

function YamlRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return (
    <Suspense fallback={<LoadingFallback />}>
      <YamlEditorView gvrKey={gvrKey} namespace={namespace} name={name} />
    </Suspense>
  );
}

function LogsRoute() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  if (!namespace || !name) return <Navigate to="/pulse" replace />;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LogsView namespace={namespace} podName={name} />
    </Suspense>
  );
}

function MetricsRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return (
    <Suspense fallback={<LoadingFallback />}>
      <MetricsView gvrKey={gvrKey} namespace={namespace} name={name} />
    </Suspense>
  );
}

function CreateRoute() {
  const { gvr } = useParams<{ gvr: string }>();
  if (!gvr) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CreateView gvrKey={gvrKey} />
    </Suspense>
  );
}

function DependencyRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return (
    <Suspense fallback={<LoadingFallback />}>
      <DependencyView gvrKey={gvrKey} namespace={namespace} name={name} />
    </Suspense>
  );
}

function CorrelationRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  const gvrKey = gvr.replace(/~/g, '/');
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CorrelationView gvrKey={gvrKey} namespace={namespace} name={name} />
    </Suspense>
  );
}

export default function ShiftOpsApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />}>
            {/* Home */}
            <Route index element={<Navigate to="/welcome" replace />} />
            <Route path="welcome" element={<WelcomeView />} />
            <Route path="pulse" element={<PulseView />} />

            {/* Resource list: /r/apps~v1~deployments */}
            <Route path="r/:gvr" element={<ResourceListRoute />} />

            {/* Resource detail: /r/apps~v1~deployments/:namespace/:name */}
            <Route path="r/:gvr/:namespace/:name" element={<ResourceDetailRoute />} />

            {/* Cluster-scoped detail: /r/v1~nodes/_/:name */}
            <Route path="r/:gvr/_/:name" element={<ResourceDetailRoute />} />

            {/* YAML editor: /yaml/apps~v1~deployments/:namespace/:name */}
            <Route path="yaml/:gvr/:namespace/:name" element={<YamlRoute />} />
            <Route path="yaml/:gvr/_/:name" element={<YamlRoute />} />

            {/* Logs: /logs/:namespace/:podName */}
            <Route path="logs/:namespace/:name" element={<LogsRoute />} />

            {/* Node logs: /node-logs/:name */}
            <Route path="node-logs/:name" element={
              <Suspense fallback={<LoadingFallback />}>
                <NodeLogsView />
              </Suspense>
            } />

            {/* Metrics: /metrics/apps~v1~deployments/:namespace/:name */}
            <Route path="metrics/:gvr/:namespace/:name" element={<MetricsRoute />} />
            <Route path="metrics/:gvr/_/:name" element={<MetricsRoute />} />

            {/* Create: /create/apps~v1~deployments */}
            <Route path="create/:gvr" element={<CreateRoute />} />

            {/* Correlation view: /investigate/apps~v1~deployments/:namespace/:name */}
            <Route path="investigate/:gvr/:namespace/:name" element={<CorrelationRoute />} />

            {/* Dependencies: /deps/apps~v1~deployments/:namespace/:name */}
            <Route path="deps/:gvr/:namespace/:name" element={<DependencyRoute />} />

            {/* Domain views */}
            <Route path="workloads" element={<Suspense fallback={<LoadingFallback />}><WorkloadsView /></Suspense>} />
            <Route path="networking" element={<Suspense fallback={<LoadingFallback />}><NetworkingView /></Suspense>} />
            <Route path="compute" element={<Suspense fallback={<LoadingFallback />}><ComputeView /></Suspense>} />
            <Route path="dashboard" element={<Navigate to="/pulse" replace />} />
            <Route path="storage" element={<Suspense fallback={<LoadingFallback />}><StorageView /></Suspense>} />
            <Route path="builds" element={<Suspense fallback={<LoadingFallback />}><BuildsView /></Suspense>} />
            <Route path="crds" element={<Suspense fallback={<LoadingFallback />}><CRDsView /></Suspense>} />
            <Route path="access-control" element={<Suspense fallback={<LoadingFallback />}><AccessControlView /></Suspense>} />
            <Route path="users" element={<Suspense fallback={<LoadingFallback />}><UserManagementView /></Suspense>} />
            <Route path="software" element={<Navigate to="/create/v1~pods" replace />} />
            <Route path="operators" element={<Navigate to="/admin" replace />} />
            <Route path="operatorhub" element={<Navigate to="/create/v1~pods?tab=operators" replace />} />
            <Route path="admin" element={<Suspense fallback={<LoadingFallback />}><AdminView /></Suspense>} />

            {/* Alerts */}
            <Route path="alerts" element={<Suspense fallback={<LoadingFallback />}><AlertsView /></Suspense>} />
            <Route path="morning-report" element={<Navigate to="/pulse" replace />} />

            {/* Troubleshoot — merged into Pulse */}
            <Route path="troubleshoot" element={<Navigate to="/pulse" replace />} />

            {/* Config Compare — merged into Admin */}
            <Route path="config-compare" element={<Navigate to="/admin" replace />} />

            {/* Timeline — merged into Admin */}
            <Route path="timeline" element={<Navigate to="/admin?tab=timeline" replace />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/pulse" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
