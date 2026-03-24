import React from 'react';
import {
  Settings, Server, Shield, ArrowRight,
  CheckCircle, XCircle, RefreshCw,
  ArrowUpCircle, AlertTriangle, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import type { ClusterVersion, ClusterOperator, Node, Condition } from '../../engine/types';
import { Panel } from '../../components/primitives/Panel';
import { Card } from '../../components/primitives/Card';
import { InfoCard } from '../../components/primitives/InfoCard';
import { formatMem } from '../../engine/formatting';

/** OpenShift operator resource (operator.openshift.io/v1) */
interface OperatorResource extends K8sResource {
  status?: {
    conditions?: Condition[];
    latestAvailableRevision?: number;
  };
}

/** OpenShift Ingress config (config.openshift.io/v1) */
interface IngressConfig extends K8sResource {
  spec?: {
    domain?: string;
    defaultCertificate?: { name: string };
  };
}

export interface OverviewTabProps {
  overviewLoading: boolean;
  overviewError: boolean;
  firingAlerts: Array<{ labels: Record<string, string>; annotations: Record<string, string>; state: string }>;
  alertCounts: { critical: number; warning: number; info: number };
  operators: K8sResource[];
  opDegraded: number;
  opProgressing: number;
  degradedOperators: Array<{ name: string; message: string }>;
  nodes: K8sResource[];
  nodeRoles: Array<[string, number]>;
  cvVersion: string;
  cvChannel: string;
  platform: string;
  apiUrl: string;
  controlPlaneTopology: string;
  isHyperShift: boolean;
  clusterAge: { label: string; date: string } | null;
  nsStats: { total: number; user: number; system: number };
  crds: K8sResource[];
  crdGroupCount: number;
  availableUpdates: Array<{ version: string }>;
  expiringCerts: Array<{ name: string; namespace: string; daysLeft: number }>;
  quotaHotSpots: Array<{ namespace: string; resource: string; pct: number }>;
  clusterCapacity: { cpuAllocatable: number; memAllocatable: number; cpuCapacity: number; memCapacity: number; pods: number };
  apiServerOperator: OperatorResource | null | undefined;
  etcdOperator: OperatorResource | null | undefined;
  identityProviders: Array<{ name: string; type: string }>;
  ingressConfig: IngressConfig | null | undefined;
  certExpiry: { date: Date; daysLeft: number } | null;
  quotas: K8sResource[];
  limitRanges: K8sResource[];
  latestEvents: K8sResource[];
  recentEvents: K8sResource[];
  setActiveTab: (tab: string) => void;
  go: (path: string, title: string) => void;
}

/** Operator health helper */
function getOperatorStatus(op: K8sResource | OperatorResource | null): string {
  const conditions: Condition[] = (op as OperatorResource)?.status?.conditions || [];
  const hasDegraded = conditions.some((c) => c.type.endsWith('Degraded') && c.status === 'True');
  if (hasDegraded) return 'degraded';
  const hasProgressing = conditions.some((c) => c.type.endsWith('Progressing') && c.status === 'True');
  if (hasProgressing) return 'progressing';
  const hasAvailable = conditions.some((c) => (c.type === 'Available' || c.type.endsWith('Available')) && c.status === 'True');
  if (hasAvailable) return 'healthy';
  return 'unknown';
}

export function OverviewTab({
  overviewLoading, overviewError,
  firingAlerts, alertCounts,
  operators, opDegraded, opProgressing, degradedOperators,
  nodes, nodeRoles,
  cvVersion, cvChannel, platform, apiUrl,
  controlPlaneTopology, isHyperShift,
  clusterAge, nsStats, crds, crdGroupCount,
  availableUpdates, expiringCerts, quotaHotSpots,
  clusterCapacity, apiServerOperator, etcdOperator,
  identityProviders, ingressConfig, certExpiry,
  quotas, limitRanges, latestEvents, recentEvents,
  setActiveTab, go,
}: OverviewTabProps) {
  return (
    <>
      {/* Loading skeleton */}
      {overviewLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-6 animate-pulse">
              <div className="h-4 bg-slate-800 rounded w-1/3 mb-3" />
              <div className="h-3 bg-slate-800 rounded w-2/3 mb-2" />
              <div className="h-3 bg-slate-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Error banner */}
      {overviewError && !overviewLoading && (
        <div className="bg-red-950/30 border border-red-800 rounded-lg px-4 py-3 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-medium text-red-300">Failed to load cluster data</span>
            <p className="text-xs text-red-400 mt-0.5">Check your permissions or cluster connectivity. Some data may be unavailable.</p>
          </div>
        </div>
      )}

      {/* Firing alerts banner */}
      {firingAlerts.length > 0 && (
        <div className={cn('border rounded-lg px-4 py-3',
          alertCounts.critical > 0 ? 'bg-red-950/30 border-red-800' : 'bg-amber-950/30 border-amber-800'
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className={cn('w-5 h-5', alertCounts.critical > 0 ? 'text-red-400' : 'text-amber-400')} />
              <div>
                <span className={cn('text-sm font-medium', alertCounts.critical > 0 ? 'text-red-300' : 'text-amber-300')}>
                  {firingAlerts.length} alert{firingAlerts.length !== 1 ? 's' : ''} firing
                </span>
                <span className="text-xs ml-2 text-slate-400">
                  {alertCounts.critical > 0 && <span className="text-red-400 mr-2">{alertCounts.critical} critical</span>}
                  {alertCounts.warning > 0 && <span className="text-amber-400 mr-2">{alertCounts.warning} warning</span>}
                  {alertCounts.info > 0 && <span className="text-blue-400">{alertCounts.info} info</span>}
                </span>
              </div>
            </div>
            <button onClick={() => go('/alerts', 'Alerts')} className={cn('text-xs flex items-center gap-1', alertCounts.critical > 0 ? 'text-red-400 hover:text-red-300' : 'text-amber-400 hover:text-amber-300')}>
              View alerts <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {/* Top 3 alert names */}
          {firingAlerts.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 ml-8">
              {[...new Set(firingAlerts.map(a => a.labels?.alertname).filter(Boolean))].slice(0, 3).map(name => (
                <span key={name} className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">{name}</span>
              ))}
              {new Set(firingAlerts.map(a => a.labels?.alertname)).size > 3 && (
                <span className="text-xs text-slate-500">+{new Set(firingAlerts.map(a => a.labels?.alertname)).size - 3} more</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* No alerts -- green signal */}
      {firingAlerts.length === 0 && !overviewLoading && (
        <div className="bg-emerald-950/20 border border-emerald-800/50 rounded-lg px-4 py-2.5 flex items-center gap-3">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-300">No alerts firing</span>
        </div>
      )}

      {/* Row 1: Key info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {/* Health score */}
        <InfoCard
          label="Cluster Health"
          value={(() => {
            const total = operators.length;
            if (total === 0) return '\u2014';
            const healthy = total - opDegraded - opProgressing;
            const score = Math.round((healthy / total) * 100);
            return `${score}%`;
          })()}
          sub={opDegraded > 0 ? `${opDegraded} degraded` : firingAlerts.length > 0 ? `${firingAlerts.length} alerts` : 'All systems go'}
          onClick={() => setActiveTab('readiness')}
          className={cn(
            opDegraded > 0 ? 'border-red-800' :
            firingAlerts.length > 0 ? 'border-amber-800' :
            'border-emerald-800/50'
          )}
        />
        <InfoCard label="Cluster Version" value={cvVersion || '\u2014'} sub={cvChannel} />
        <InfoCard label="Platform" value={platform || '\u2014'} sub={(() => { try { return apiUrl ? new URL(apiUrl).hostname : ''; } catch { return ''; } })()} />
        <InfoCard label="Control Plane" value={isHyperShift ? 'Hosted (External)' : controlPlaneTopology ? `Self-managed (${controlPlaneTopology})` : '\u2014'} sub={isHyperShift ? 'Managed externally' : ''} />
        <InfoCard label="Cluster Age" value={clusterAge?.label || '\u2014'} sub={clusterAge?.date ? new Date(clusterAge.date).toLocaleDateString() : ''} />
        <InfoCard label="Nodes" value={String(nodes.length)} sub={`${nodeRoles.map(([r, c]) => `${c} ${r}`).join(', ')} \u2192`} onClick={() => go('/compute', 'Compute')} />
        <InfoCard label="Namespaces" value={String(nsStats.total)} sub={`${nsStats.user} user, ${nsStats.system} system \u2192`} onClick={() => setActiveTab('quotas')} />
        <InfoCard label="CRDs" value={String(crds.length)} sub={`${crdGroupCount} API groups \u2192`} onClick={() => go('/crds', 'Custom Resources')} />
      </div>

      {/* Update banner */}
      {availableUpdates.length > 0 && (
        <div className="bg-blue-950/30 border border-blue-800 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ArrowUpCircle className="w-5 h-5 text-blue-400" />
            <div>
              <span className="text-sm font-medium text-blue-300">Cluster update available</span>
              <span className="text-xs text-blue-400 ml-2">{availableUpdates[0]?.version}</span>
            </div>
          </div>
          <button onClick={() => setActiveTab('updates')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            View updates <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Status signals row */}
      {(expiringCerts.length > 0 || quotaHotSpots.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Certificate expiry warnings */}
          {expiringCerts.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-300">{expiringCerts.length} cert{expiringCerts.length !== 1 ? 's' : ''} expiring within 30 days</span>
              </div>
              <div className="space-y-1.5">
                {expiringCerts.slice(0, 3).map((cert) => (
                  <div key={`${cert.namespace}/${cert.name}`} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 truncate">{cert.namespace}/{cert.name}</span>
                    <span className={cn('shrink-0 ml-2 px-1.5 py-0.5 rounded',
                      cert.daysLeft <= 7 ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'
                    )}>{cert.daysLeft <= 0 ? 'Expired' : `${cert.daysLeft}d left`}</span>
                  </div>
                ))}
                {expiringCerts.length > 3 && <div className="text-xs text-slate-500">+{expiringCerts.length - 3} more</div>}
              </div>
              <button onClick={() => setActiveTab('config')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
                View certificates <ArrowRight className="w-3 h-3" />
              </button>
            </Card>
          )}

          {/* Quota hot spots */}
          {quotaHotSpots.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-300">{quotaHotSpots.length} quota{quotaHotSpots.length !== 1 ? 's' : ''} above 80%</span>
              </div>
              <div className="space-y-2">
                {quotaHotSpots.map((spot, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-slate-300">{spot.namespace} \u2014 {spot.resource}</span>
                      <span className={cn('font-mono', spot.pct >= 90 ? 'text-red-400' : 'text-amber-400')}>{spot.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', spot.pct >= 90 ? 'bg-red-500' : 'bg-amber-500')} style={{ width: `${Math.min(100, spot.pct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setActiveTab('quotas')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
                View quotas <ArrowRight className="w-3 h-3" />
              </button>
            </Card>
          )}
        </div>
      )}

      {/* Cluster Capacity */}
      <Panel title="Cluster Capacity" icon={<Server className="w-4 h-4 text-cyan-500" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-400 mb-1">CPU (allocatable)</div>
            <div className="text-lg font-bold text-slate-100">{clusterCapacity.cpuAllocatable.toFixed(0)} cores</div>
            <div className="text-xs text-slate-500">{clusterCapacity.cpuCapacity.toFixed(0)} total capacity</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Memory (allocatable)</div>
            <div className="text-lg font-bold text-slate-100">{formatMem(clusterCapacity.memAllocatable)}</div>
            <div className="text-xs text-slate-500">{formatMem(clusterCapacity.memCapacity)} total capacity</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Max Pods</div>
            <div className="text-lg font-bold text-slate-100">{clusterCapacity.pods.toLocaleString()}</div>
            <div className="text-xs text-slate-500">across {nodes.length} nodes</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">Per-Node Average</div>
            <div className="text-lg font-bold text-slate-100">{nodes.length > 0 ? (clusterCapacity.cpuAllocatable / nodes.length).toFixed(1) : 0} CPU</div>
            <div className="text-xs text-slate-500">{nodes.length > 0 ? formatMem(clusterCapacity.memAllocatable / nodes.length) : '\u2014'} memory</div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Control Plane Status */}
        <Panel title="Control Plane" icon={<Shield className="w-4 h-4 text-green-500" />}>
          <div className="space-y-2.5">
            {[
              { name: 'API Server', op: apiServerOperator, detail: (() => {
                const rev = apiServerOperator?.status?.latestAvailableRevision;
                return rev ? `revision ${rev}` : '';
              })() },
              { name: 'etcd', op: etcdOperator, detail: (() => {
                const msg = (etcdOperator?.status?.conditions || []).find((c: Condition) => c.type === 'EtcdMembersAvailable')?.message || '';
                return msg || '';
              })() },
            ].map(({ name, op, detail }) => {
              const status = op ? getOperatorStatus(op) : 'unknown';
              return (
                <div key={name} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    {status === 'healthy' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> :
                     status === 'degraded' ? <XCircle className="w-3.5 h-3.5 text-red-500" /> :
                     status === 'progressing' ? <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" /> :
                     <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />}
                    <span className="text-sm text-slate-200">{name}</span>
                    {detail && <span className="text-xs text-slate-500">{detail}</span>}
                  </div>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded',
                    status === 'healthy' ? 'bg-green-900/50 text-green-300' :
                    status === 'degraded' ? 'bg-red-900/50 text-red-300' :
                    status === 'progressing' ? 'bg-blue-900/50 text-blue-300' :
                    'bg-slate-800 text-slate-400'
                  )}>{status === 'healthy' ? 'Available' : status === 'degraded' ? 'Degraded' : status === 'progressing' ? 'Updating' : 'Unknown'}</span>
                </div>
              );
            })}
            <div className="border-t border-slate-800 pt-2 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">ClusterOperators ({operators.length})</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> {operators.length - opDegraded - opProgressing}</span>
                  {opDegraded > 0 && <span className="flex items-center gap-1 text-xs text-red-400"><XCircle className="w-3 h-3" /> {opDegraded}</span>}
                  {opProgressing > 0 && <span className="flex items-center gap-1 text-xs text-yellow-400"><RefreshCw className="w-3 h-3" /> {opProgressing}</span>}
                </div>
              </div>
              {/* Named degraded operators */}
              {degradedOperators.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {degradedOperators.map((op) => (
                    <div key={op.name} className="flex items-start gap-2 p-2 rounded bg-red-950/20 border border-red-900/30">
                      <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-red-300">{op.name}</span>
                        {op.message && <p className="text-xs text-red-400/70 mt-0.5 line-clamp-2">{op.message}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => go('/r/config.openshift.io~v1~clusteroperators', 'ClusterOperators')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">View all operators <ArrowRight className="w-3 h-3" /></button>
        </Panel>

        {/* Nodes */}
        <Panel title={`Nodes (${nodes.length})`} icon={<Server className="w-4 h-4 text-blue-500" />}>
          <div className="space-y-2 mb-3">
            {nodeRoles.map(([role, count]) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-sm text-slate-300">{role}</span>
                <span className="text-sm font-mono text-slate-400">{count}</span>
              </div>
            ))}
            {(() => {
              const readyNodes = nodes.filter((n) => {
                const node = n as unknown as Node;
                const conditions: Condition[] = node.status?.conditions || [];
                return conditions.some((c) => c.type === 'Ready' && c.status === 'True');
              });
              const unready = nodes.length - readyNodes.length;
              return (
                <div className="flex items-center gap-3 pt-1 border-t border-slate-800">
                  <span className="flex items-center gap-1.5 text-sm text-green-400"><CheckCircle className="w-3.5 h-3.5" /> {readyNodes.length} ready</span>
                  {unready > 0 && <span className="flex items-center gap-1.5 text-sm text-red-400"><XCircle className="w-3.5 h-3.5" /> {unready} not ready</span>}
                </div>
              );
            })()}
          </div>
          <button onClick={() => go('/compute', 'Compute')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">Compute overview <ArrowRight className="w-3 h-3" /></button>
        </Panel>

        {/* Identity Providers */}
        <Panel title="Identity Providers" icon={<Shield className="w-4 h-4 text-teal-500" />}>
          {identityProviders.length === 0 ? (
            <div className="text-sm text-slate-500 py-2">No identity providers configured</div>
          ) : (
            <div className="space-y-1">
              {identityProviders.map((idp, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                  <span className="text-sm text-slate-200">{idp.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-400 rounded">{idp.type}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setActiveTab('config')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
            Manage providers <ArrowRight className="w-3 h-3" />
          </button>
        </Panel>

        {/* Certificate & Ingress */}
        <Panel title="Ingress & Certificates" icon={<Shield className="w-4 h-4 text-orange-500" />}>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Apps Domain</span>
              <span className="text-xs font-mono text-slate-400">{ingressConfig?.spec?.domain || '\u2014'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Default Certificate</span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded',
                ingressConfig?.spec?.defaultCertificate ? 'bg-green-900/50 text-green-300' : 'bg-yellow-900/50 text-yellow-300'
              )}>{ingressConfig?.spec?.defaultCertificate ? 'Custom' : 'Self-signed'}</span>
            </div>
            {certExpiry && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Router Cert Expires</span>
                <span className={cn('text-xs px-1.5 py-0.5 rounded',
                  certExpiry.daysLeft < 30 ? 'bg-red-900/50 text-red-300' :
                  certExpiry.daysLeft < 90 ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-green-900/50 text-green-300'
                )}>{certExpiry.daysLeft}d ({certExpiry.date.toLocaleDateString()})</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Quotas / Limit Ranges</span>
              <span className="text-xs text-slate-400">{quotas.length} quotas, {limitRanges.length} limits</span>
            </div>
          </div>
          <button onClick={() => setActiveTab('config')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
            Cluster config <ArrowRight className="w-3 h-3" />
          </button>
        </Panel>
      </div>

      {/* Recent Warning Events */}
      {latestEvents.length > 0 && (
        <Panel title={`Recent Warning Events (${recentEvents.length})`} icon={<AlertCircle className="w-4 h-4 text-amber-500" />}>
          <div className="space-y-1.5">
            {latestEvents.map((event, i) => {
              const ev = event as any;
              const reason = ev.reason || 'Event';
              const message = ev.message || '';
              const objectKind = ev.involvedObject?.kind || '';
              const objectName = ev.involvedObject?.name || '';
              const ns = ev.involvedObject?.namespace || event.metadata.namespace || '';
              const timestamp = ev.lastTimestamp || ev.firstTimestamp || event.metadata.creationTimestamp || '';
              const timeAgo = timestamp ? (() => {
                const ms = Date.now() - new Date(timestamp).getTime();
                if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
                if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
                if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
                return `${Math.floor(ms / 86400000)}d`;
              })() : '';

              return (
                <button key={i} onClick={() => { if (objectName && objectKind) go(`/r/v1~${objectKind.toLowerCase()}s/${ns}/${objectName}`, objectName); }}
                  className="w-full flex items-start gap-2.5 p-2 rounded hover:bg-slate-800/50 text-left transition-colors">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{reason}</span>
                      {objectKind && objectName && (
                        <span className="text-xs text-slate-500">{objectKind}/{objectName}</span>
                      )}
                      {timeAgo && <span className="text-xs text-slate-600 ml-auto shrink-0">{timeAgo} ago</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{message}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <button onClick={() => setActiveTab('timeline')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-3">
            View full timeline <ArrowRight className="w-3 h-3" />
          </button>
        </Panel>
      )}
    </>
  );
}
