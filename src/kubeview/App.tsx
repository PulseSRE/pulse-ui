import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { Shell } from './components/Shell';
import PulseView from './views/PulseView';
import TableView from './views/TableView';
import DetailView from './views/DetailView';
import TimelineView from './views/TimelineView';
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
const DashboardView = lazy(() => import('./views/DashboardView'));
const CreateView = lazy(() => import('./views/CreateView'));
const DependencyView = lazy(() => import('./views/DependencyView'));
const ConfigCompareView = lazy(() => import('./views/ConfigCompareView'));

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

export default function OpenShiftViewApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />}>
            {/* Home */}
            <Route index element={<Navigate to="/pulse" replace />} />
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

            {/* Metrics: /metrics/apps~v1~deployments/:namespace/:name */}
            <Route path="metrics/:gvr/:namespace/:name" element={<MetricsRoute />} />
            <Route path="metrics/:gvr/_/:name" element={<MetricsRoute />} />

            {/* Create: /create/apps~v1~deployments */}
            <Route path="create/:gvr" element={<CreateRoute />} />

            {/* Correlation view: /investigate/apps~v1~deployments/:namespace/:name */}
            <Route path="investigate/:gvr/:namespace/:name" element={<CorrelationRoute />} />

            {/* Dependencies: /deps/apps~v1~deployments/:namespace/:name */}
            <Route path="deps/:gvr/:namespace/:name" element={<DependencyRoute />} />

            {/* Config Compare */}
            <Route path="config-compare" element={
              <Suspense fallback={<LoadingFallback />}>
                <ConfigCompareView />
              </Suspense>
            } />

            {/* Timeline */}
            <Route path="timeline" element={<TimelineView />} />

            {/* Dashboard */}
            <Route path="dashboard" element={
              <Suspense fallback={<LoadingFallback />}>
                <DashboardView />
              </Suspense>
            } />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/pulse" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
