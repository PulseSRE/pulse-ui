import { inUserNamespaces, isPlatformNamespace } from '../engine/platformNamespaces';
import { createTemplateUrl } from '../engine/createTemplates';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Globe, Network, Shield, ArrowRight, ExternalLink, AlertCircle,
  AlertTriangle, Info, Plus, Lock, Unlock, Server, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import { safeQuery } from '../engine/safeQuery';
import type { K8sResource } from '../engine/renderers';
import type { Service, Route, Ingress, NetworkPolicy, Condition } from '../engine/types';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { resourceDetailUrl } from '../engine/gvr';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { MetricCard } from '../components/metrics/Sparkline';
import { CHART_COLORS } from '../engine/colors';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { Panel } from '../components/primitives/Panel';
import { Card } from '../components/primitives/Card';
import { useActiveClusterId } from '../hooks/useClusterBase';
import { useCanI } from '../hooks/useCanI';
import { Button } from '../components/primitives/Button';
import { LoadError } from '../components/primitives/LoadError';
import { isNotFound } from '../engine/readResult';

/**
 * Services with a selector whose Endpoints object has no ready address
 * (missing, empty, or only not-ready addresses). ExternalName and
 * selector-less Services are skipped: their endpoints are not pod-backed.
 */
export function findServicesWithoutReadyEndpoints(services: Service[], endpoints: K8sResource[]): Array<{ svc: Service; notReady: number }> {
  const byKey = new Map(endpoints.map((e) => [`${e.metadata.namespace}/${e.metadata.name}`, e]));
  const out: Array<{ svc: Service; notReady: number }> = [];
  for (const svc of services) {
    if (svc.spec?.type === 'ExternalName') continue;
    if (!svc.spec?.selector || Object.keys(svc.spec.selector).length === 0) continue;
    const ep = byKey.get(`${svc.metadata.namespace}/${svc.metadata.name}`);
    const subsets = ((ep as { subsets?: Array<{ addresses?: unknown[]; notReadyAddresses?: unknown[] }> } | undefined)?.subsets) ?? [];
    const ready = subsets.reduce((n, s) => n + (s.addresses?.length ?? 0), 0);
    const notReady = subsets.reduce((n, s) => n + (s.notReadyAddresses?.length ?? 0), 0);
    if (ready === 0) out.push({ svc, notReady });
  }
  return out;
}

const INGRESS_OPERATOR_NS = 'openshift-ingress-operator';

export default function NetworkingView() {
  const clusterId = useActiveClusterId();
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Real-time data
  const svcQ = useK8sListWatch<Service>({ apiPath: '/api/v1/services', namespace: nsFilter });
  const ingQ = useK8sListWatch<Ingress>({ apiPath: '/apis/networking.k8s.io/v1/ingresses', namespace: nsFilter });
  const routesQ = useK8sListWatch<Route>({ apiPath: '/apis/route.openshift.io/v1/routes', namespace: nsFilter });
  const netpolsQ = useK8sListWatch<NetworkPolicy>({ apiPath: '/apis/networking.k8s.io/v1/networkpolicies', namespace: nsFilter });
  const { data: services = [], isLoading: svcLoading } = svcQ;
  const { data: ingresses = [], isLoading: ingLoading } = ingQ;
  const { data: routes = [] } = routesQ;
  const { data: netpols = [] } = netpolsQ;

  // Cluster-scoped: endpoints, ingress controller
  // Not swallowed: a failed read must not turn into "every Service has no endpoints".
  const { data: endpoints = [], isSuccess: endpointsLoaded, isError: endpointsFailed, error: endpointsErr, refetch: refetchEndpoints } = useQuery<K8sResource[]>({
    queryKey: ['networking', 'endpoints', nsFilter, clusterId],
    queryFn: () => k8sList('/api/v1/endpoints', nsFilter, clusterId),
    staleTime: 30000,
  });
  // safeQuery turns only a 404 (no IngressController API: not OpenShift) into
  // []; a 403 or 500 is an error, and the panel and audit check say so.
  const { data: ingressControllers = [], isError: icFailed, error: icErr, refetch: refetchICs } = useQuery<K8sResource[]>({
    queryKey: ['networking', 'ingresscontrollers', clusterId],
    queryFn: async () => (await safeQuery(() => k8sList('/apis/operator.openshift.io/v1/namespaces/openshift-ingress-operator/ingresscontrollers', undefined, clusterId))) ?? [],
    staleTime: 120000,
  });

  // A failed or forbidden list is not an empty one: its count shows "—", the
  // banners and audit checks that depend on it are skipped or unknown, and
  // its panel shows the error.
  // A 404 on Routes means the cluster has no Route API (not OpenShift): a
  // neutral "not available" (there are no Routes), not an error.
  const routesAbsent = !!routesQ.isError && isNotFound(routesQ.error);
  const failed = {
    services: !!svcQ.isError, ingresses: !!ingQ.isError, routes: !!routesQ.isError && !routesAbsent, netpols: !!netpolsQ.isError,
  };
  const netpolsLoaded = !netpolsQ.isLoading && !failed.netpols;
  const failedLists = ([
    ['Services', failed.services], ['Ingresses', failed.ingresses], ['Routes', failed.routes],
    ['NetworkPolicies', failed.netpols], ['Endpoints', endpointsFailed],
  ] as const).filter(([, f]) => f).map(([label]) => label);
  const firstError = [svcQ, ingQ, ...(failed.routes ? [routesQ] : []), netpolsQ].find((q) => q.isError)?.error ?? endpointsErr;
  const retryFailed = () => {
    for (const q of [svcQ, ingQ, ...(failed.routes ? [routesQ] : []), netpolsQ]) if (q.isError) void q.refetch();
    if (endpointsFailed) void refetchEndpoints();
  };
  const count = (isFailed: boolean, n: number) => (isFailed ? '—' : n);
  const unreadNote = (what: string) => (
    <p className="text-center py-6 text-sm text-slate-500" data-unknown="">{what} could not be read (see above).</p>
  );

  const { allowed: canCreateSvc } = useCanI('create', '', 'services', nsFilter);
  const { allowed: canCreateRoute } = useCanI('create', 'route.openshift.io', 'routes', nsFilter);
  const { allowed: canCreateIngress } = useCanI('create', 'networking.k8s.io', 'ingresses', nsFilter);

  // Services that select pods but have no ready address: traffic to them fails.
  const servicesWithoutEndpoints = React.useMemo(
    () => (endpointsLoaded ? findServicesWithoutReadyEndpoints(services, endpoints) : []),
    [services, endpoints, endpointsLoaded],
  );

  // Service type breakdown
  const svcTypes = React.useMemo(() => {
    const types: Record<string, number> = {};
    for (const s of services) {
      const t = s.spec?.type || 'ClusterIP';
      types[t] = (types[t] || 0) + 1;
    }
    return Object.entries(types).sort((a, b) => b[1] - a[1]);
  }, [services]);

  // Services without selectors (potential issues)
  const headlessServices = React.useMemo(() =>
    services.filter(s => s.spec?.clusterIP === 'None'),
  [services]);

  const loadBalancerServices = React.useMemo(() =>
    services.filter(s => s.spec?.type === 'LoadBalancer'),
  [services]);

  const nodePortServices = React.useMemo(() =>
    services.filter(s => s.spec?.type === 'NodePort'),
  [services]);

  // Exposed endpoints (routes + ingresses)
  const exposedEndpoints = React.useMemo(() => {
    const eps: Array<{ name: string; host: string; path: string; ns: string; type: 'Route' | 'Ingress'; tls: boolean; admitted: boolean }> = [];
    for (const r of routes) {
      const admitted = r.status?.ingress?.some((ing) => ing.conditions?.some((c) => c.type === 'Admitted' && c.status === 'True'));
      eps.push({ name: r.metadata.name, host: r.spec?.host || '', path: r.spec?.path || '/', ns: r.metadata.namespace || '', type: 'Route', tls: !!r.spec?.tls, admitted: admitted !== false });
    }
    for (const i of ingresses) {
      for (const rule of i.spec?.rules || []) {
        for (const path of rule.http?.paths || []) {
          eps.push({ name: i.metadata.name, host: rule.host || '', path: path.path || '/', ns: i.metadata.namespace || '', type: 'Ingress', tls: !!(i.spec?.tls?.length), admitted: true });
        }
      }
    }
    return eps;
  }, [routes, ingresses]);

  const notAdmittedRoutes = routes.filter(r => {
    const admitted = r.status?.ingress?.some((ing) => ing.conditions?.some((c) => c.type === 'Admitted' && c.status === 'True'));
    return admitted === false;
  });

  // Namespaces without network policies
  const namespacesWithPolicies = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const np of netpols) if (np.metadata.namespace) nsSet.add(np.metadata.namespace);
    return nsSet;
  }, [netpols]);

  // Issues — one banner per problem. Route TLS lives in the audit below
  // (it is a best-practice check, with the fix), not also as a banner and a
  // stat-card subtitle; not-admitted routes are counted here and listed in the
  // audit.
  const scrollToAudit = () => document.getElementById('networking-audit')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const issues: Array<{ msg: string; severity: 'warning' | 'critical'; action?: { label: string; path?: string; onClick?: () => void } }> = [];
  if (servicesWithoutEndpoints.length > 0) issues.push({ msg: `${servicesWithoutEndpoints.length} service${servicesWithoutEndpoints.length > 1 ? 's' : ''} with no ready endpoints`, severity: 'warning' });
  if (notAdmittedRoutes.length > 0) issues.push({ msg: `${notAdmittedRoutes.length} route${notAdmittedRoutes.length > 1 ? 's' : ''} not admitted by ingress controller`, severity: 'critical', action: { label: 'See routes', onClick: scrollToAudit } });
  // One network-policy banner: for the selected namespace when there is one.
  // Only a successful read can say there are no policies.
  if (netpolsLoaded && (nsFilter ? !namespacesWithPolicies.has(nsFilter) : netpols.length === 0)) {
    issues.push({
      msg: nsFilter
        ? `No network policies in ${nsFilter} — its pod traffic is unrestricted`
        : 'No network policies configured — all pod traffic is unrestricted',
      severity: 'warning',
      action: { label: 'Create Policy', path: '/create/networking.k8s.io~v1~networkpolicies' },
    });
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Globe className="w-6 h-6 text-cyan-500" /> Networking
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Services, Routes, Ingresses, and Network Policies
              {nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {([
              ['Service', 'v1~services', canCreateSvc],
              ['Route', 'route.openshift.io~v1~routes', canCreateRoute],
              ['Ingress', 'networking.k8s.io~v1~ingresses', canCreateIngress],
            ] as const).map(([label, gvr, allowed]) => (
              <Button
                key={label}
                size="sm"
                variant="secondary"
                disabled={!allowed}
                title={allowed ? undefined : `You do not have permission to create ${label}s here`}
                onClick={() => go(nsFilter ? `/create/${gvr}?namespace=${encodeURIComponent(nsFilter)}` : `/create/${gvr}`, `Create ${label}`)}
              >
                <Plus className="w-3.5 h-3.5" /> {label}
              </Button>
            ))}
          </div>
        </div>

        {(svcLoading || ingLoading) && services.length === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-3 animate-pulse">
                <div className="h-3 bg-slate-800 rounded-sm w-2/3 mb-2" />
                <div className="h-5 bg-slate-800 rounded-sm w-1/3" />
              </div>
            ))}
          </div>
        )}

        {failedLists.length > 0 && (
          <LoadError title={`${failedLists.join(', ')} could not be loaded`} error={firstError} onRetry={retryFailed} />
        )}

        {/* Issues */}
        {issues.length > 0 && (
          <div className="space-y-2">
            {issues.map((issue, i) => (
              <div key={i} className={cn('flex items-center justify-between px-4 py-2.5 rounded-lg border',
                issue.severity === 'critical' ? 'bg-red-950/30 border-red-900' : 'bg-yellow-950/30 border-yellow-900')}>
                <div className="flex items-center gap-2">
                  {issue.severity === 'critical' ? <AlertCircle className="w-4 h-4 text-red-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  <span className="text-sm text-slate-200">{issue.msg}</span>
                </div>
                {issue.action && (
                  <button onClick={() => (issue.action!.onClick ? issue.action!.onClick() : go(issue.action!.path!, issue.action!.label))} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    {issue.action.label} <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button onClick={() => go('/r/v1~services', 'Services')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Services</div>
            <div className="text-xl font-bold text-slate-100">{count(failed.services, services.length)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{failed.services ? 'Could not be read' : svcTypes.map(([t, c]) => `${c} ${t}`).slice(0, 2).join(' · ')}</div>
          </button>
          <button onClick={() => go('/r/route.openshift.io~v1~routes', 'Routes')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Routes</div>
            <div className="text-xl font-bold text-slate-100">{routesAbsent ? 'n/a' : count(failed.routes, routes.length)}</div>
            {routesAbsent && <div className="text-xs text-slate-500 mt-0.5" data-not-available="">Not available on this cluster</div>}
          </button>
          <button onClick={() => go('/r/networking.k8s.io~v1~ingresses', 'Ingresses')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Ingresses</div>
            <div className="text-xl font-bold text-slate-100">{count(failed.ingresses, ingresses.length)}</div>
          </button>
          <button onClick={() => go('/r/networking.k8s.io~v1~networkpolicies', 'NetworkPolicies')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', netpolsLoaded && netpols.length === 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">Network Policies</div>
            <div className="text-xl font-bold text-slate-100">{count(failed.netpols, netpols.length)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{failed.netpols ? 'Could not be read' : netpols.length === 0 ? 'None configured' : `${namespacesWithPolicies.size} ns covered`}</div>
          </button>
          <Card className="p-3">
            <div className="text-xs text-slate-400 mb-1">Endpoints</div>
            <div className="text-xl font-bold text-slate-100">{count(failed.routes || failed.ingresses, exposedEndpoints.length)}</div>
            <div className="text-xs text-slate-500 mt-0.5">Routes and Ingress paths</div>
          </Card>
        </div>

        {/* Metrics */}
        <MetricGrid>
          <MetricCard
            title="Network Receive"
            query="sum(rate(node_network_receive_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024"
            unit=" MB/s"
            color={CHART_COLORS.cyan}
          />
          <MetricCard
            title="Network Transmit"
            query="sum(rate(node_network_transmit_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024"
            unit=" MB/s"
            color={CHART_COLORS.violet}
          />
          <MetricCard
            title="TCP Connections"
            query="sum(node_netstat_Tcp_CurrEstab)"
            unit=""
            color={CHART_COLORS.blue}
          />
          <MetricCard
            title="Network Errors"
            query="sum(rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m]))"
            unit=" /s"
            color={CHART_COLORS.red}
            thresholds={{ warning: 1, critical: 10 }}
          />
        </MetricGrid>

        {/* Networking Health Audit */}
        <div id="networking-audit" />
        <NetworkingHealthAudit
          routes={routes}
          services={services}
          netpols={netpols}
          ingressControllers={ingressControllers}
          failed={{ ...failed, ingressControllers: icFailed }}
          nsFilter={nsFilter}
          go={go}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Exposed Endpoints */}
          <Panel title={failed.routes || failed.ingresses ? 'Exposed Endpoints' : `Exposed Endpoints (${exposedEndpoints.length})`} icon={<ExternalLink className="w-4 h-4 text-blue-400" />}>
            {failed.routes && failed.ingresses ? unreadNote('Routes and Ingresses') : exposedEndpoints.length === 0 && (failed.routes || failed.ingresses) ? unreadNote(failed.routes ? 'Routes' : 'Ingresses') : exposedEndpoints.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-500">No exposed endpoints</div>
            ) : (
              <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
                {exposedEndpoints.map((ep, i) => (
                  <button key={i} onClick={() => go(`/r/${ep.type === 'Route' ? 'route.openshift.io~v1~routes' : 'networking.k8s.io~v1~ingresses'}/${ep.ns}/${ep.name}`, ep.name)}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800/50 transition-colors flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {ep.tls ? <Lock className="w-3 h-3 text-green-400 shrink-0" /> : <Unlock className="w-3 h-3 text-amber-400 shrink-0" />}
                        <span className="text-sm text-blue-400 font-mono truncate">{ep.host}{ep.path !== '/' ? ep.path : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                        <span className={cn('px-1 py-0.5 rounded-sm', ep.type === 'Route' ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400')}>{ep.type}</span>
                        <span>{ep.name}</span>
                        <span className="text-slate-600">{ep.ns}</span>
                      </div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {/* Service Types breakdown */}
          <Panel title="Service Types" icon={<Network className="w-4 h-4 text-green-400" />}>
            {failed.services ? unreadNote('Services') : (
            <div className="space-y-3">
              {svcTypes.map(([type, count]) => {
                const maxCount = Math.max(...svcTypes.map(([, c]) => c), 1);
                const pct = (count / maxCount) * 100;
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-300">{type}</span>
                      <span className="text-sm font-mono text-slate-400">{count}</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {svcTypes.length === 0 && <div className="text-sm text-slate-500 text-center py-4">No services</div>}
            </div>
            )}

            {/* LoadBalancer + NodePort details */}
            {loadBalancerServices.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <div className="text-xs text-slate-500 font-medium mb-2">LoadBalancer Services</div>
                {loadBalancerServices.map((svc) => {
                  const lbIP = svc.status?.loadBalancer?.ingress?.[0]?.hostname || svc.status?.loadBalancer?.ingress?.[0]?.ip || 'Pending';
                  return (
                    <button key={svc.metadata.uid} onClick={() => go(`/r/v1~services/${svc.metadata.namespace}/${svc.metadata.name}`, svc.metadata.name)}
                      className="flex items-center justify-between w-full py-1.5 px-2 rounded-sm hover:bg-slate-800/50 text-left transition-colors">
                      <span className="text-xs text-slate-300">{svc.metadata.name}</span>
                      <span className="text-xs font-mono text-slate-500">{lbIP}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* Ingress Controllers */}
        {icFailed && (
          <Panel title="Ingress Controllers" icon={<Server className="w-4 h-4 text-blue-400" />}>
            <LoadError title="IngressControllers could not be loaded" error={icErr} onRetry={() => { void refetchICs(); }} />
          </Panel>
        )}
        {!icFailed && ingressControllers.length > 0 && (
          <Panel title="Ingress Controllers" icon={<Server className="w-4 h-4 text-blue-400" />}>
            <div className="space-y-2">
              {ingressControllers.map((ic) => {
                const icStatus = (ic as K8sResource & { status?: { conditions?: Condition[]; domain?: string; availableReplicas?: number } }).status;
                const icSpec = (ic as K8sResource & { spec?: { domain?: string } }).spec;
                const available = icStatus?.conditions?.find((c) => c.type === 'Available');
                const isAvailable = available?.status === 'True';
                const domain = icStatus?.domain || icSpec?.domain || '';
                const replicas = icStatus?.availableReplicas ?? '?';
                return (
                  <button
                    key={ic.metadata.uid}
                    type="button"
                    onClick={() => go(resourceDetailUrl({ apiVersion: 'operator.openshift.io/v1', kind: 'IngressController', metadata: { name: ic.metadata.name, namespace: ic.metadata.namespace || INGRESS_OPERATOR_NS } }), ic.metadata.name)}
                    className="w-full text-left flex items-center justify-between py-2.5 px-3 rounded-sm hover:bg-slate-800/50"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        {isAvailable ? <Activity className="w-3.5 h-3.5 text-green-400" /> : <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                        <span className="text-sm font-medium text-slate-200">{ic.metadata.name}</span>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', isAvailable ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>{isAvailable ? 'Available' : 'Degraded'}</span>
                      </div>
                      {domain && <div className="text-xs text-slate-500 mt-0.5 font-mono">*.{domain}</div>}
                    </div>
                    <span className="text-xs text-slate-500">{replicas} replicas</span>
                  </button>
                );
              })}
            </div>
          </Panel>
        )}


        {/* Services whose selector matches no ready pod */}
        {servicesWithoutEndpoints.length > 0 && (
          <Panel title={`Services with no ready endpoints (${servicesWithoutEndpoints.length})`} icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
            <div className="space-y-1">
              {servicesWithoutEndpoints.slice(0, 20).map(({ svc, notReady }) => (
                <button key={svc.metadata.uid ?? `${svc.metadata.namespace}/${svc.metadata.name}`}
                  onClick={() => go(`/r/v1~services/${svc.metadata.namespace}/${svc.metadata.name}`, svc.metadata.name)}
                  className="flex items-center justify-between w-full py-2 px-3 rounded-sm hover:bg-slate-800/50 text-left transition-colors">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-slate-200 truncate">{svc.metadata.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{svc.metadata.namespace}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {notReady > 0 ? `${notReady} not ready` : `selector ${Object.entries(svc.spec?.selector ?? {}).map(([k, v]) => `${k}=${v}`).join(',')} matches no pod`}
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        )}

        {/* Network Policies summary */}
        <Panel title="Network Policies" icon={<Shield className="w-4 h-4 text-indigo-400" />}>
          {failed.netpols ? unreadNote('NetworkPolicies') : !netpolsLoaded ? (
            <div className="text-center py-4 text-sm text-slate-500">Loading network policies…</div>
          ) : netpols.length === 0 ? (
            <div className="text-center py-4">
              <Shield className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              {/* The warning banner above says what this means; not repeated. */}
              <p className="text-sm text-slate-400">None yet</p>
              <button onClick={() => go('/create/networking.k8s.io~v1~networkpolicies', 'Create NetworkPolicy')}
                className="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-sm transition-colors">
                Create Network Policy
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {netpols.slice(0, 10).map((np) => {
                const ingressRules = np.spec?.ingress?.length || 0;
                const egressRules = np.spec?.egress?.length || 0;
                const policyTypes = np.spec?.policyTypes || [];
                return (
                  <button key={np.metadata.uid} onClick={() => go(`/r/networking.k8s.io~v1~networkpolicies/${np.metadata.namespace}/${np.metadata.name}`, np.metadata.name)}
                    className="flex items-center justify-between w-full py-2 px-3 rounded-sm hover:bg-slate-800/50 text-left transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-200">{np.metadata.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{np.metadata.namespace}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                        {policyTypes.includes('Ingress') && <span>{ingressRules} ingress rule{ingressRules !== 1 ? 's' : ''}</span>}
                        {policyTypes.includes('Egress') && <span>{egressRules} egress rule{egressRules !== 1 ? 's' : ''}</span>}
                        {policyTypes.length === 0 && <span>{ingressRules} ingress rule{ingressRules !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                  </button>
                );
              })}
              {netpols.length > 10 && (
                <button onClick={() => go('/r/networking.k8s.io~v1~networkpolicies', 'NetworkPolicies')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 pt-1">
                  View all {netpols.length} <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ===== Networking Health Audit =====

import { readsState, type AuditCheck, type AuditItem } from '../components/audit/types';
import { HealthAuditPanel } from '../components/audit/HealthAuditPanel';

function NetworkingHealthAudit({
  routes,
  services,
  netpols,
  ingressControllers,
  failed,
  nsFilter,
  go,
}: {
  routes: Route[];
  services: Service[];
  netpols: NetworkPolicy[];
  ingressControllers: K8sResource[];
  failed: { services: boolean; routes: boolean; netpols: boolean; ingressControllers: boolean };
  nsFilter?: string;
  go: (path: string, title: string) => void;
}) {
  // Get all unique namespaces from services (for network policy checks)
  const allNamespaces = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const s of services) {
      if (s.metadata?.namespace && !isPlatformNamespace(s.metadata.namespace)) {
        nsSet.add(s.metadata.namespace);
      }
    }
    return Array.from(nsSet);
  }, [services]);

  // Namespaces with network policies
  const namespacesWithPolicies = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const np of netpols) if (np.metadata.namespace) nsSet.add(np.metadata.namespace);
    return nsSet;
  }, [netpols]);

  // Check for egress policies
  const namespacesWithEgressPolicies = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const np of netpols) {
      const policyTypes = np.spec?.policyTypes || [];
      const hasEgress = policyTypes.includes('Egress') || np.spec?.egress;
      if (hasEgress && np.metadata.namespace) nsSet.add(np.metadata.namespace);
    }
    return nsSet;
  }, [netpols]);

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // Platform objects (openshift-*, kube-*) are left out of every audit
    // here, as they are on Workloads and Security.
    const userRoutes = inUserNamespaces(routes);
    const userServices = inUserNamespaces(services);

    // 1. TLS on Routes
    const routesWithTLS = userRoutes.filter(r => r.spec?.tls);
    const routesWithoutTLS = userRoutes.filter(r => !r.spec?.tls);
    allChecks.push({
      id: 'route-tls',
      title: 'TLS on Routes',
      description: 'All Routes should use TLS encryption to protect data in transit',
      why: 'Without TLS, traffic between clients and your application is unencrypted. This exposes sensitive data (credentials, session tokens, PII) to network sniffing and man-in-the-middle attacks.',
      passing: routesWithTLS,
      failing: routesWithoutTLS,
      ...readsState(['Routes', failed.routes]),
      fixLabel: 'How to fix — add to your YAML:',
      yamlExample: `spec:
  tls:
    termination: edge           # TLS terminated at router
    insecureEdgeTerminationPolicy: Redirect  # HTTP → HTTPS
  # Alternative: passthrough (TLS to pod) or reencrypt (TLS to router, then to pod)`,
    });

    // 2. Network Policies per Namespace
    const namespacesWithoutPolicies = allNamespaces.filter(ns => !namespacesWithPolicies.has(ns));
    const namespacesWithPoliciesArray = allNamespaces.filter(ns => namespacesWithPolicies.has(ns));
    allChecks.push({
      id: 'network-policies',
      title: 'Network Policies',
      description: 'Every namespace with workloads should have NetworkPolicies to restrict traffic',
      why: 'By default, all pods can communicate with each other. Without NetworkPolicies, a compromised pod can access any other pod in the cluster, enabling lateral movement and data exfiltration.',
      passing: namespacesWithPoliciesArray.map(ns => ({ metadata: { name: ns, namespace: ns } })),
      failing: namespacesWithoutPolicies.map(ns => ({ metadata: { name: ns, namespace: ns } })),
      ...readsState(['Services', failed.services], ['NetworkPolicies', failed.netpols]),
      fixLabel: 'How to fix — add to your YAML:',
      yamlExample: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}           # applies to all pods in namespace
  policyTypes:
  - Ingress
  # No ingress rules = deny all ingress
---
# Without this the OpenShift router is denied too and every Route breaks.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-openshift-ingress
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          policy-group.network.openshift.io/ingress: ""
# Then create additional policies to allow specific traffic`,
    });

    // 3. Avoid NodePort Services
    const nodePortServices = userServices.filter(s => s.spec?.type === 'NodePort');
    const nonNodePortServices = userServices.filter(s => s.spec?.type !== 'NodePort');
    allChecks.push({
      id: 'nodeport-services',
      title: 'Avoid NodePort Services',
      description: 'NodePort services expose ports on every node — use Routes or LoadBalancer instead',
      why: 'NodePort services open ports (30000-32767) on every cluster node, bypassing ingress controllers and network policies. This increases attack surface and makes firewall management difficult.',
      passing: nonNodePortServices,
      failing: nodePortServices,
      ...readsState(['Services', failed.services]),
      fixLabel: 'How to fix — add to your YAML:',
      yamlExample: `# Instead of NodePort:
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  type: ClusterIP        # internal only
  selector:
    app: my-app
  ports:
  - port: 8080
---
# Then expose via Route:
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: my-app
spec:
  to:
    kind: Service
    name: my-app
  tls:
    termination: edge`,
    });

    // 4. Ingress Controller Health
    const healthyControllers = ingressControllers.filter((ic) => {
      const icStatus = (ic as K8sResource & { status?: { conditions?: Condition[] } }).status;
      const available = icStatus?.conditions?.find((c) => c.type === 'Available');
      return available?.status === 'True';
    });
    const unhealthyControllers = ingressControllers.filter((ic) => {
      const icStatus = (ic as K8sResource & { status?: { conditions?: Condition[] } }).status;
      const available = icStatus?.conditions?.find((c) => c.type === 'Available');
      return available?.status !== 'True';
    });
    allChecks.push({
      id: 'ingress-health',
      title: 'Ingress Controller Health',
      description: 'All IngressControllers should be Available',
      why: 'A degraded IngressController cannot route traffic to your applications. This causes HTTP 503 errors for all Routes handled by that controller, resulting in complete application outages.',
      passing: healthyControllers,
      failing: unhealthyControllers,
      ...readsState(['IngressControllers', failed.ingressControllers]),
      fixLabel: 'How to fix — troubleshooting steps:',
      yamlExample: `# Check controller status:
oc get ingresscontroller -n openshift-ingress-operator

# Common fixes:
# 1. Check router pods: oc get pods -n openshift-ingress
# 2. Check router logs: oc logs -n openshift-ingress -l ingresscontroller.operator.openshift.io/deployment-ingresscontroller=default
# 3. Verify DNS: nslookup *.apps.<cluster-domain>
# 4. Check certificates: oc get secret -n openshift-ingress`,
    });

    // 5. Route Admission
    const admittedRoutes = routes.filter(r => {
      const admitted = r.status?.ingress?.some((ing) =>
        ing.conditions?.some((c) => c.type === 'Admitted' && c.status === 'True')
      );
      return admitted !== false;
    });
    const notAdmittedRoutes = routes.filter(r => {
      const admitted = r.status?.ingress?.some((ing) =>
        ing.conditions?.some((c) => c.type === 'Admitted' && c.status === 'True')
      );
      return admitted === false;
    });
    allChecks.push({
      id: 'route-admission',
      title: 'Route Admission',
      description: 'All Routes should be admitted by the IngressController',
      why: 'Not-admitted Routes are not served by the ingress controller. The hostname is not routable, causing 404 errors for all requests to that Route.',
      passing: admittedRoutes,
      failing: notAdmittedRoutes,
      ...readsState(['Routes', failed.routes]),
      fixLabel: 'How to fix — add to your YAML:',
      yamlExample: `# Common causes:
# 1. Host conflicts — another Route in the same namespace already uses that hostname
# 2. TLS certificate missing — check that spec.tls.certificate/key Secret exists
# 3. Invalid hostname — must match IngressController domain (*.apps.<cluster>)

# Check Route status:
oc describe route <name>

# Fix host conflict:
spec:
  host: unique-name.apps.<cluster-domain>  # ensure unique per namespace`,
    });

    // 6. Egress Network Policies
    const namespacesWithIngressNoEgress = Array.from(namespacesWithPolicies).filter(
      ns => !namespacesWithEgressPolicies.has(ns)
    );
    const namespacesWithEgress = Array.from(namespacesWithEgressPolicies);
    allChecks.push({
      id: 'egress-policies',
      title: 'Egress Network Policies',
      description: 'Namespaces with ingress policies should also have egress policies',
      why: 'Ingress policies alone do not prevent compromised pods from making outbound connections. Egress policies restrict what external services pods can reach, limiting data exfiltration and lateral movement.',
      passing: namespacesWithEgress.map(ns => ({ metadata: { name: ns, namespace: ns } })),
      failing: namespacesWithIngressNoEgress.map(ns => ({ metadata: { name: ns, namespace: ns } })),
      ...readsState(['NetworkPolicies', failed.netpols]),
      fixLabel: 'How to fix — add to your YAML:',
      yamlExample: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress-allow-dns
spec:
  podSelector: {}           # applies to all pods in namespace
  policyTypes:
  - Egress
  egress:
  # Keep DNS: without it no name resolves, even for destinations you allow later
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: openshift-dns
    ports:
    - { protocol: UDP, port: 5353 }
    - { protocol: TCP, port: 5353 }
    - { protocol: UDP, port: 53 }
    - { protocol: TCP, port: 53 }
  # Then create policies to allow specific destinations (APIs, other services)`,
    });

    return allChecks;
  }, [routes, services, netpols, ingressControllers, failed.services, failed.routes, failed.netpols, failed.ingressControllers, allNamespaces, namespacesWithPolicies, namespacesWithEgressPolicies]);

  const handleNavigate = React.useCallback((check: AuditCheck, item: AuditItem) => {
    const id = check.id;
    const name = item.metadata?.name || '';
    const ns = item.metadata?.namespace || '';
    const isNamespace = id === 'network-policies' || id === 'egress-policies';

    let editPath = '';
    if (id === 'route-tls' || id === 'route-admission') {
      editPath = `/yaml/route.openshift.io~v1~routes/${ns}/${name}`;
    } else if (id === 'nodeport-services') {
      editPath = `/yaml/v1~services/${ns}/${name}`;
    } else if (id === 'network-policies') {
      // The reviewed template, prefilled for this namespace (router allowed in).
      editPath = createTemplateUrl('default-deny', name);
    } else if (id === 'egress-policies') {
      editPath = createTemplateUrl('default-deny-egress', name);
    } else if (id === 'ingress-health') {
      // IngressControllers are namespaced, in openshift-ingress-operator.
      editPath = resourceDetailUrl({ apiVersion: 'operator.openshift.io/v1', kind: 'IngressController', metadata: { name, namespace: ns || INGRESS_OPERATOR_NS } });
    }
    go(editPath, isNamespace ? `Create NetworkPolicy (${name})` : `${name} (YAML)`);
  }, [go]);

  return (
    <HealthAuditPanel
      checks={checks}
      title="Networking Health Audit"
      iconColorClass="text-cyan-400"
      onNavigateItem={handleNavigate}
      navigateLabel={(check) => {
        const isNamespace = check.id === 'network-policies' || check.id === 'egress-policies';
        return isNamespace ? 'Create Policy' : 'Edit YAML';
      }}
    />
  );
}

