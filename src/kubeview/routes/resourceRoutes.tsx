import { Route, Navigate, useParams } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import TableView from '../views/TableView';
import DetailView from '../views/DetailView';
import { LoadingFallback } from '../components/LoadingFallback';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { RESOURCE_ROUTES } from '../engine/routeTable';
import { useClusterStore } from '../store/clusterStore';
import { kindFromPlural, topologyFocusPath } from '../engine/topologyLinks';

const YamlEditorView = lazy(() => import('../views/YamlEditorView'));
const LogsView = lazy(() => import('../views/LogsView'));
const MetricsView = lazy(() => import('../views/MetricsView'));
const CreateView = lazy(() => import('../views/CreateView'));
const NodeLogsView = lazy(() => import('../views/NodeLogsView'));

function parseGvr(gvr: string) {
  return gvr.replace(/~/g, '/');
}

function ResourceListRoute() {
  const { gvr } = useParams<{ gvr: string }>();
  if (!gvr) return <Navigate to="/pulse" replace />;
  return <TableView gvrKey={parseGvr(gvr)} />;
}

function ResourceDetailRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  return <DetailView gvrKey={parseGvr(gvr)} namespace={namespace} name={name} />;
}

function YamlRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  return (
    <ErrorBoundary fallbackTitle="YAML Editor">
      <Suspense fallback={<LoadingFallback />}>
        <YamlEditorView gvrKey={parseGvr(gvr)} namespace={namespace} name={name} />
      </Suspense>
    </ErrorBoundary>
  );
}

function LogsRoute() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  if (!namespace || !name) return <Navigate to="/pulse" replace />;
  return (
    <ErrorBoundary fallbackTitle="Logs">
      <Suspense fallback={<LoadingFallback />}>
        <LogsView namespace={namespace} podName={name} />
      </Suspense>
    </ErrorBoundary>
  );
}

function MetricsRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  if (!gvr || !name) return <Navigate to="/pulse" replace />;
  return (
    <ErrorBoundary fallbackTitle="Metrics">
      <Suspense fallback={<LoadingFallback />}>
        <MetricsView gvrKey={parseGvr(gvr)} namespace={namespace} name={name} />
      </Suspense>
    </ErrorBoundary>
  );
}

function CreateRoute() {
  const { gvr } = useParams<{ gvr: string }>();
  if (!gvr) return <Navigate to="/pulse" replace />;
  return (
    <ErrorBoundary fallbackTitle="Create Resource">
      <Suspense fallback={<LoadingFallback />}>
        <CreateView gvrKey={parseGvr(gvr)} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * /deps/:gvr/:namespace/:name used to render a second, client-built
 * dependency graph. It now opens /topology focused on the resource, so old
 * links keep working and there is one graph.
 */
function DependencyRoute() {
  const { gvr, namespace, name } = useParams<{ gvr: string; namespace?: string; name: string }>();
  const registry = useClusterStore((s) => s.resourceRegistry);
  if (!gvr || !name) return <Navigate to="/topology" replace />;
  const gvrKey = parseGvr(gvr);
  const plural = gvrKey.split('/').pop() || '';
  const kind = (registry?.get(gvrKey) ?? registry?.get(`core/${gvrKey}`))?.kind || kindFromPlural(plural);
  return <Navigate to={topologyFocusPath(kind, namespace === '_' ? undefined : namespace, name)} replace />;
}

export function resourceRoutes() {
  return (
    <>
      {/* Resource list: /r/apps~v1~deployments */}
      <Route path={RESOURCE_ROUTES.list} element={<ResourceListRoute />} />

      {/* Resource detail: /r/apps~v1~deployments/:namespace/:name */}
      <Route path={RESOURCE_ROUTES.detail} element={<ResourceDetailRoute />} />

      {/* Cluster-scoped detail: /r/v1~nodes/_/:name */}
      <Route path={RESOURCE_ROUTES.detailClusterScoped} element={<ResourceDetailRoute />} />

      {/* YAML editor: /yaml/apps~v1~deployments/:namespace/:name */}
      <Route path={RESOURCE_ROUTES.yaml} element={<YamlRoute />} />
      <Route path={RESOURCE_ROUTES.yamlClusterScoped} element={<YamlRoute />} />

      {/* Logs: /logs/:namespace/:podName */}
      <Route path={RESOURCE_ROUTES.logs} element={<LogsRoute />} />

      {/* Node logs: /node-logs/:name */}
      <Route path={RESOURCE_ROUTES.nodeLogs} element={
        <ErrorBoundary fallbackTitle="Node Logs">
          <Suspense fallback={<LoadingFallback />}>
            <NodeLogsView />
          </Suspense>
        </ErrorBoundary>
      } />

      {/* Metrics: /metrics/apps~v1~deployments/:namespace/:name */}
      <Route path={RESOURCE_ROUTES.metrics} element={<MetricsRoute />} />
      <Route path={RESOURCE_ROUTES.metricsClusterScoped} element={<MetricsRoute />} />

      {/* Create: /create/apps~v1~deployments */}
      <Route path={RESOURCE_ROUTES.create} element={<CreateRoute />} />

      {/* Dependencies: /deps/apps~v1~deployments/:namespace/:name */}
      <Route path={RESOURCE_ROUTES.deps} element={<DependencyRoute />} />
    </>
  );
}
