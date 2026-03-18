import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Globe, Network, Shield, ArrowRight, ExternalLink, AlertCircle,
  AlertTriangle, Info, Plus, Lock, Unlock, Server, Activity, CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { MetricCard } from '../components/metrics/Sparkline';
import { Panel } from '../components/primitives/Panel';

export default function NetworkingView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Real-time data
  const { data: services = [] } = useK8sListWatch({ apiPath: '/api/v1/services', namespace: nsFilter });
  const { data: ingresses = [] } = useK8sListWatch({ apiPath: '/apis/networking.k8s.io/v1/ingresses', namespace: nsFilter });
  const { data: routes = [] } = useK8sListWatch({ apiPath: '/apis/route.openshift.io/v1/routes', namespace: nsFilter });
  const { data: netpols = [] } = useK8sListWatch({ apiPath: '/apis/networking.k8s.io/v1/networkpolicies', namespace: nsFilter });

  // Cluster-scoped: endpoints, ingress controller
  const { data: endpoints = [] } = useQuery<K8sResource[]>({
    queryKey: ['networking', 'endpoints', nsFilter],
    queryFn: () => k8sList('/api/v1/endpoints', nsFilter).catch(() => []),
    staleTime: 30000,
  });
  const { data: ingressControllers = [] } = useQuery<K8sResource[]>({
    queryKey: ['networking', 'ingresscontrollers'],
    queryFn: () => k8sList('/apis/operator.openshift.io/v1/namespaces/openshift-ingress-operator/ingresscontrollers').catch(() => []),
    staleTime: 120000,
  });

  // Service type breakdown
  const svcTypes = React.useMemo(() => {
    const types: Record<string, number> = {};
    for (const s of services as any[]) {
      const t = s.spec?.type || 'ClusterIP';
      types[t] = (types[t] || 0) + 1;
    }
    return Object.entries(types).sort((a, b) => b[1] - a[1]);
  }, [services]);

  // Services without selectors (potential issues)
  const headlessServices = React.useMemo(() =>
    (services as any[]).filter(s => s.spec?.clusterIP === 'None'),
  [services]);

  const loadBalancerServices = React.useMemo(() =>
    (services as any[]).filter(s => s.spec?.type === 'LoadBalancer'),
  [services]);

  const nodePortServices = React.useMemo(() =>
    (services as any[]).filter(s => s.spec?.type === 'NodePort'),
  [services]);

  // Exposed endpoints (routes + ingresses)
  const exposedEndpoints = React.useMemo(() => {
    const eps: Array<{ name: string; host: string; path: string; ns: string; type: 'Route' | 'Ingress'; tls: boolean; admitted: boolean }> = [];
    for (const r of routes as any[]) {
      const admitted = r.status?.ingress?.some((i: any) => i.conditions?.some((c: any) => c.type === 'Admitted' && c.status === 'True'));
      eps.push({ name: r.metadata.name, host: r.spec?.host || '', path: r.spec?.path || '/', ns: r.metadata.namespace, type: 'Route', tls: !!r.spec?.tls, admitted: admitted !== false });
    }
    for (const i of ingresses as any[]) {
      for (const rule of i.spec?.rules || []) {
        for (const path of rule.http?.paths || []) {
          eps.push({ name: i.metadata.name, host: rule.host || '', path: path.path || '/', ns: i.metadata.namespace, type: 'Ingress', tls: !!(i.spec?.tls?.length), admitted: true });
        }
      }
    }
    return eps;
  }, [routes, ingresses]);

  const nonTlsEndpoints = exposedEndpoints.filter(e => !e.tls);
  const notAdmittedRoutes = (routes as any[]).filter(r => {
    const admitted = r.status?.ingress?.some((i: any) => i.conditions?.some((c: any) => c.type === 'Admitted' && c.status === 'True'));
    return admitted === false;
  });

  // Namespaces without network policies
  const namespacesWithPolicies = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const np of netpols as any[]) nsSet.add(np.metadata.namespace);
    return nsSet;
  }, [netpols]);

  // Issues
  const issues: Array<{ msg: string; severity: 'warning' | 'critical'; action?: { label: string; path: string } }> = [];
  if (nonTlsEndpoints.length > 0) issues.push({ msg: `${nonTlsEndpoints.length} endpoint${nonTlsEndpoints.length > 1 ? 's' : ''} exposed without TLS`, severity: 'warning' });
  if (notAdmittedRoutes.length > 0) issues.push({ msg: `${notAdmittedRoutes.length} route${notAdmittedRoutes.length > 1 ? 's' : ''} not admitted by ingress controller`, severity: 'critical' });
  if (netpols.length === 0) issues.push({ msg: 'No network policies configured — all pod traffic is unrestricted', severity: 'warning', action: { label: 'Create Policy', path: '/create/networking.k8s.io~v1~networkpolicies' } });
  if (nsFilter && !namespacesWithPolicies.has(nsFilter)) issues.push({ msg: `No network policies in ${nsFilter}`, severity: 'warning', action: { label: 'Create Policy', path: '/create/networking.k8s.io~v1~networkpolicies' } });

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
        </div>

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
                  <button onClick={() => go(issue.action!.path, issue.action!.label)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
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
            <div className="text-xl font-bold text-slate-100">{services.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{svcTypes.map(([t, c]) => `${c} ${t}`).slice(0, 2).join(' · ')}</div>
          </button>
          <button onClick={() => go('/r/route.openshift.io~v1~routes', 'Routes')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Routes</div>
            <div className="text-xl font-bold text-slate-100">{routes.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{exposedEndpoints.filter(e => e.type === 'Route' && e.tls).length} TLS</div>
          </button>
          <button onClick={() => go('/r/networking.k8s.io~v1~ingresses', 'Ingresses')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Ingresses</div>
            <div className="text-xl font-bold text-slate-100">{ingresses.length}</div>
          </button>
          <button onClick={() => go('/r/networking.k8s.io~v1~networkpolicies', 'NetworkPolicies')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', netpols.length === 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">Network Policies</div>
            <div className="text-xl font-bold text-slate-100">{netpols.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{netpols.length === 0 ? 'None configured' : `${namespacesWithPolicies.size} ns covered`}</div>
          </button>
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-1">Endpoints</div>
            <div className="text-xl font-bold text-slate-100">{exposedEndpoints.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{nonTlsEndpoints.length > 0 ? `${nonTlsEndpoints.length} no TLS` : 'All secured'}</div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="Network Receive"
            query="sum(rate(node_network_receive_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024"
            unit=" MB/s"
            color="#06b6d4"
          />
          <MetricCard
            title="Network Transmit"
            query="sum(rate(node_network_transmit_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024"
            unit=" MB/s"
            color="#8b5cf6"
          />
          <MetricCard
            title="TCP Connections"
            query="sum(node_netstat_Tcp_CurrEstab)"
            unit=""
            color="#3b82f6"
          />
          <MetricCard
            title="Network Errors"
            query="sum(rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m]))"
            unit=" /s"
            color="#ef4444"
            thresholds={{ warning: 1, critical: 10 }}
          />
        </div>

        {/* Networking Health Audit */}
        <NetworkingHealthAudit
          routes={routes as any[]}
          services={services as any[]}
          netpols={netpols as any[]}
          ingressControllers={ingressControllers as any[]}
          nsFilter={nsFilter}
          go={go}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Exposed Endpoints */}
          <Panel title={`Exposed Endpoints (${exposedEndpoints.length})`} icon={<ExternalLink className="w-4 h-4 text-blue-400" />}>
            {exposedEndpoints.length === 0 ? (
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
                        <span className={cn('px-1 py-0.5 rounded', ep.type === 'Route' ? 'bg-blue-900/30 text-blue-400' : 'bg-purple-900/30 text-purple-400')}>{ep.type}</span>
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

            {/* LoadBalancer + NodePort details */}
            {loadBalancerServices.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800">
                <div className="text-xs text-slate-500 font-medium mb-2">LoadBalancer Services</div>
                {(loadBalancerServices as any[]).map((svc) => {
                  const lbIP = svc.status?.loadBalancer?.ingress?.[0]?.hostname || svc.status?.loadBalancer?.ingress?.[0]?.ip || 'Pending';
                  return (
                    <button key={svc.metadata.uid} onClick={() => go(`/r/v1~services/${svc.metadata.namespace}/${svc.metadata.name}`, svc.metadata.name)}
                      className="flex items-center justify-between w-full py-1.5 px-2 rounded hover:bg-slate-800/50 text-left transition-colors">
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
        {ingressControllers.length > 0 && (
          <Panel title="Ingress Controllers" icon={<Server className="w-4 h-4 text-blue-400" />}>
            <div className="space-y-2">
              {(ingressControllers as any[]).map((ic) => {
                const available = ic.status?.conditions?.find((c: any) => c.type === 'Available');
                const isAvailable = available?.status === 'True';
                const domain = ic.status?.domain || ic.spec?.domain || '';
                const replicas = ic.status?.availableReplicas ?? '?';
                return (
                  <div key={ic.metadata.uid} className="flex items-center justify-between py-2.5 px-3 rounded hover:bg-slate-800/50">
                    <div>
                      <div className="flex items-center gap-2">
                        {isAvailable ? <Activity className="w-3.5 h-3.5 text-green-400" /> : <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                        <span className="text-sm font-medium text-slate-200">{ic.metadata.name}</span>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded', isAvailable ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>{isAvailable ? 'Available' : 'Degraded'}</span>
                      </div>
                      {domain && <div className="text-xs text-slate-500 mt-0.5 font-mono">*.{domain}</div>}
                    </div>
                    <span className="text-xs text-slate-500">{replicas} replicas</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Not Admitted Routes */}
        {notAdmittedRoutes.length > 0 && (
          <Panel title={`Not Admitted Routes (${notAdmittedRoutes.length})`} icon={<AlertCircle className="w-4 h-4 text-red-500" />}>
            <div className="space-y-1">
              {(notAdmittedRoutes as any[]).map((r) => (
                <button key={r.metadata.uid} onClick={() => go(`/r/route.openshift.io~v1~routes/${r.metadata.namespace}/${r.metadata.name}`, r.metadata.name)}
                  className="flex items-center justify-between w-full py-2 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-sm text-slate-200">{r.metadata.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{r.metadata.namespace}</span>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">{r.spec?.host || '—'}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="text-xs text-slate-500 space-y-1">
                <p className="font-medium text-slate-400">Common causes:</p>
                <p>1. Host conflicts with another Route in the same namespace</p>
                <p>2. Ingress controller not configured for the Route's domain</p>
                <p>3. TLS certificate issues (missing or invalid Secret)</p>
              </div>
            </div>
          </Panel>
        )}

        {/* Network Policies summary */}
        <Panel title="Network Policies" icon={<Shield className="w-4 h-4 text-indigo-400" />}>
          {netpols.length === 0 ? (
            <div className="text-center py-4">
              <Shield className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No network policies configured</p>
              <p className="text-xs text-slate-600 mt-1">All pod-to-pod traffic is allowed by default</p>
              <button onClick={() => go('/create/networking.k8s.io~v1~networkpolicies', 'Create NetworkPolicy')}
                className="mt-3 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
                Create Network Policy
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {(netpols as any[]).slice(0, 10).map((np) => {
                const ingressRules = np.spec?.ingress?.length || 0;
                const egressRules = np.spec?.egress?.length || 0;
                const policyTypes = np.spec?.policyTypes || [];
                return (
                  <button key={np.metadata.uid} onClick={() => go(`/r/networking.k8s.io~v1~networkpolicies/${np.metadata.namespace}/${np.metadata.name}`, np.metadata.name)}
                    className="flex items-center justify-between w-full py-2 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-200">{np.metadata.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{np.metadata.namespace}</span>
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

interface AuditCheck {
  id: string;
  title: string;
  description: string;
  why: string;
  passing: any[];
  failing: any[];
  yamlExample: string;
}

function NetworkingHealthAudit({
  routes,
  services,
  netpols,
  ingressControllers,
  nsFilter,
  go,
}: {
  routes: any[];
  services: any[];
  netpols: any[];
  ingressControllers: any[];
  nsFilter?: string;
  go: (path: string, title: string) => void;
}) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  // Get all unique namespaces from services (for network policy checks)
  const allNamespaces = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const s of services) {
      if (s.metadata?.namespace && s.metadata.namespace !== 'default' && s.metadata.namespace !== 'kube-system' && !s.metadata.namespace.startsWith('openshift-')) {
        nsSet.add(s.metadata.namespace);
      }
    }
    return Array.from(nsSet);
  }, [services]);

  // Namespaces with network policies
  const namespacesWithPolicies = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const np of netpols) nsSet.add(np.metadata.namespace);
    return nsSet;
  }, [netpols]);

  // Check for egress policies
  const namespacesWithEgressPolicies = React.useMemo(() => {
    const nsSet = new Set<string>();
    for (const np of netpols) {
      const policyTypes = np.spec?.policyTypes || [];
      const hasEgress = policyTypes.includes('Egress') || np.spec?.egress;
      if (hasEgress) nsSet.add(np.metadata.namespace);
    }
    return nsSet;
  }, [netpols]);

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // 1. TLS on Routes
    const routesWithTLS = routes.filter(r => r.spec?.tls);
    const routesWithoutTLS = routes.filter(r => !r.spec?.tls);
    allChecks.push({
      id: 'route-tls',
      title: 'TLS on Routes',
      description: 'All Routes should use TLS encryption to protect data in transit',
      why: 'Without TLS, traffic between clients and your application is unencrypted. This exposes sensitive data (credentials, session tokens, PII) to network sniffing and man-in-the-middle attacks.',
      passing: routesWithTLS,
      failing: routesWithoutTLS,
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
      yamlExample: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}           # applies to all pods in namespace
  policyTypes:
  - Ingress
  # No ingress rules = deny all ingress
  # Then create additional policies to allow specific traffic`,
    });

    // 3. Avoid NodePort Services
    const nodePortServices = services.filter(s => s.spec?.type === 'NodePort');
    const nonNodePortServices = services.filter(s => s.spec?.type !== 'NodePort');
    allChecks.push({
      id: 'nodeport-services',
      title: 'Avoid NodePort Services',
      description: 'NodePort services expose ports on every node — use Routes or LoadBalancer instead',
      why: 'NodePort services open ports (30000-32767) on every cluster node, bypassing ingress controllers and network policies. This increases attack surface and makes firewall management difficult.',
      passing: nonNodePortServices,
      failing: nodePortServices,
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
    const healthyControllers = ingressControllers.filter((ic: any) => {
      const available = ic.status?.conditions?.find((c: any) => c.type === 'Available');
      return available?.status === 'True';
    });
    const unhealthyControllers = ingressControllers.filter((ic: any) => {
      const available = ic.status?.conditions?.find((c: any) => c.type === 'Available');
      return available?.status !== 'True';
    });
    allChecks.push({
      id: 'ingress-health',
      title: 'Ingress Controller Health',
      description: 'All IngressControllers should be Available',
      why: 'A degraded IngressController cannot route traffic to your applications. This causes HTTP 503 errors for all Routes handled by that controller, resulting in complete application outages.',
      passing: healthyControllers,
      failing: unhealthyControllers,
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
      const admitted = r.status?.ingress?.some((i: any) =>
        i.conditions?.some((c: any) => c.type === 'Admitted' && c.status === 'True')
      );
      return admitted !== false;
    });
    const notAdmittedRoutes = routes.filter(r => {
      const admitted = r.status?.ingress?.some((i: any) =>
        i.conditions?.some((c: any) => c.type === 'Admitted' && c.status === 'True')
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
      yamlExample: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
spec:
  podSelector: {}           # applies to all pods in namespace
  policyTypes:
  - Egress
  # No egress rules = deny all egress
  # Then create policies to allow specific destinations (DNS, APIs, etc)`,
    });

    return allChecks;
  }, [routes, services, netpols, ingressControllers, allNamespaces, namespacesWithPolicies, namespacesWithEgressPolicies]);

  // Calculate score
  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = checks.length > 0 ? Math.round((totalPassing / checks.length) * 100) : 100;

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" /> Networking Health Audit
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold', score === 100 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400')}>{score}%</span>
          <span className="text-xs text-slate-500">{totalPassing}/{checks.length} passing</span>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {checks.map((check) => {
          const pass = check.failing.length === 0;
          const expanded = expandedCheck === check.id;
          return (
            <div key={check.id}>
              <button
                onClick={() => setExpandedCheck(expanded ? null : check.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {pass ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div>
                    <span className="text-sm text-slate-200">{check.title}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {pass ? `${check.passing.length} pass` : `${check.failing.length} of ${check.failing.length + check.passing.length} need attention`}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-600">{expanded ? '▾' : '▸'}</span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-slate-400">{check.description}</p>

                  {/* Why it matters */}
                  <div className="bg-blue-950/20 border border-blue-900/50 rounded p-3">
                    <div className="text-xs font-medium text-blue-300 mb-1">Why it matters</div>
                    <p className="text-xs text-slate-400">{check.why}</p>
                  </div>

                  {/* Failing resources */}
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">Missing ({check.failing.length})</div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, 10).map((resource: any, idx: number) => {
                          const isNamespace = check.id === 'network-policies' || check.id === 'egress-policies';
                          const name = resource.metadata.name;
                          const ns = resource.metadata.namespace;

                          // Determine edit path
                          let editPath = '';
                          if (check.id === 'route-tls' || check.id === 'route-admission') {
                            editPath = `/yaml/route.openshift.io~v1~routes/${ns}/${name}`;
                          } else if (check.id === 'nodeport-services') {
                            editPath = `/yaml/v1~services/${ns}/${name}`;
                          } else if (check.id === 'network-policies' || check.id === 'egress-policies') {
                            editPath = `/create/networking.k8s.io~v1~networkpolicies`;
                          } else if (check.id === 'ingress-health') {
                            editPath = `/r/operator.openshift.io~v1~ingresscontrollers/_/${name}`;
                          }

                          return (
                            <button
                              key={resource.metadata.uid || idx}
                              onClick={() => go(editPath, isNamespace ? `Create NetworkPolicy (${name})` : `${name} (YAML)`)}
                              className="flex items-center justify-between w-full py-1 px-2 rounded hover:bg-slate-800/50 text-left transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-xs text-slate-300">{name}</span>
                                {!isNamespace && ns && <span className="text-xs text-slate-600">{ns}</span>}
                              </div>
                              <span className="text-xs text-blue-400">{isNamespace ? 'Create Policy →' : 'Edit YAML →'}</span>
                            </button>
                          );
                        })}
                        {check.failing.length > 10 && <div className="text-xs text-slate-600 px-2">+{check.failing.length - 10} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Passing resources */}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">Passing ({check.passing.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((resource: any, idx: number) => (
                          <span key={resource.metadata?.uid || idx} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">
                            {resource.metadata.name}
                          </span>
                        ))}
                        {check.passing.length > 8 && <span className="text-xs text-slate-600">+{check.passing.length - 8} more</span>}
                      </div>
                    </div>
                  )}

                  {/* YAML example */}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">How to fix{check.id === 'ingress-health' ? ' — troubleshooting steps:' : ' — add to your YAML:'}</div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto">{check.yamlExample}</pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

