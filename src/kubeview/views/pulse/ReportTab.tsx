import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, AlertTriangle, AlertOctagon, Server, Cpu, MemoryStick,
  HeartPulse, Clock, ArrowRight, CheckCircle, Activity, Lock, Bell,
  ChevronRight, RotateCcw, Scale, UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../../engine/query';
import { queryInstant } from '../../components/metrics/prometheus';
import { Panel } from '../../components/primitives/Panel';
import type { K8sResource } from '../../engine/renderers';

const SYSTEM_NS_PREFIXES = ['openshift-', 'kube-', 'default', 'openshift'];
function isSystemNamespace(ns?: string): boolean {
  if (!ns) return false;
  return SYSTEM_NS_PREFIXES.some((p) => ns === p || ns.startsWith(p + '-') || ns === p);
}

interface CertInfo {
  name: string;
  namespace: string;
  daysUntilExpiry: number | null;
  expirySource: 'cert-manager' | 'service-ca' | 'creation-estimate' | 'unknown';
}

function parseCertExpiry(secret: K8sResource): CertInfo {
  const name = secret.metadata.name;
  const namespace = secret.metadata.namespace || '';
  const annotations = secret.metadata.annotations || {};

  const certManagerExpiry = annotations['cert-manager.io/certificate-expiry'];
  if (certManagerExpiry) {
    const expiry = new Date(certManagerExpiry);
    if (!isNaN(expiry.getTime())) {
      return { name, namespace, daysUntilExpiry: Math.floor((expiry.getTime() - Date.now()) / 86_400_000), expirySource: 'cert-manager' };
    }
  }

  const serviceCaExpiry = annotations['service.beta.openshift.io/expiry'];
  if (serviceCaExpiry) {
    const expiry = new Date(serviceCaExpiry);
    if (!isNaN(expiry.getTime())) {
      return { name, namespace, daysUntilExpiry: Math.floor((expiry.getTime() - Date.now()) / 86_400_000), expirySource: 'service-ca' };
    }
  }

  const created = secret.metadata.creationTimestamp;
  if (created) {
    const estimatedExpiry = new Date(new Date(created).getTime() + 365 * 86_400_000);
    return { name, namespace, daysUntilExpiry: Math.floor((estimatedExpiry.getTime() - Date.now()) / 86_400_000), expirySource: 'creation-estimate' };
  }

  return { name, namespace, daysUntilExpiry: null, expirySource: 'unknown' };
}

interface AttentionItem {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  path: string;
  pathTitle: string;
}

function RiskScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 60;
  const stroke = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = clamped <= 20 ? '#22c55e' : clamped <= 50 ? '#eab308' : clamped <= 75 ? '#f97316' : '#ef4444';
  const bgColor = clamped <= 20 ? 'text-green-400' : clamped <= 50 ? 'text-yellow-400' : clamped <= 75 ? 'text-orange-400' : 'text-red-400';
  const label = clamped <= 20 ? 'Healthy' : clamped <= 50 ? 'Caution' : clamped <= 75 ? 'At Risk' : 'Critical';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx="75" cy="75" r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 75 75)" className="transition-all duration-700" />
        <text x="75" y="70" textAnchor="middle" className="fill-slate-100 text-3xl font-bold" style={{ fontSize: '36px' }}>{clamped}</text>
        <text x="75" y="90" textAnchor="middle" className="fill-slate-500 text-xs" style={{ fontSize: '12px' }}>/ 100</text>
      </svg>
      <span className={cn('text-xs font-semibold', bgColor)}>{label}</span>
    </div>
  );
}

export interface ReportTabProps {
  nodes: K8sResource[];
  allPods: K8sResource[];
  operators: K8sResource[];
  go: (path: string, title: string) => void;
}

export function ReportTab({ nodes, allPods, operators, go }: ReportTabProps) {
  // Additional queries unique to report
  const { data: tlsSecrets = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', 'tls-secrets'],
    queryFn: async () => {
      const secrets = await k8sList<K8sResource>('/api/v1/secrets');
      return secrets.filter((s: any) => s.type === 'kubernetes.io/tls');
    },
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  const { data: recentEvents = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', 'events-24h'],
    queryFn: async () => {
      const events = await k8sList<K8sResource>('/api/v1/events');
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return events.filter((e: any) => {
        const ts = e.lastTimestamp || e.metadata.creationTimestamp;
        return ts && new Date(ts).getTime() > cutoff;
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  type PromResult = { metric: Record<string, string>; value: number };
  const { data: firingAlerts = [] } = useQuery<PromResult[]>({
    queryKey: ['prom', 'firing-alerts'],
    queryFn: () => queryInstant('ALERTS{alertstate="firing"}').catch((): PromResult[] => []),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const { data: cpuData = [] } = useQuery<PromResult[]>({
    queryKey: ['prom', 'cluster-cpu'],
    queryFn: () => queryInstant('sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(machine_cpu_cores) * 100').catch((): PromResult[] => []),
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const { data: memData = [] } = useQuery<PromResult[]>({
    queryKey: ['prom', 'cluster-memory'],
    queryFn: () => queryInstant('(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100').catch((): PromResult[] => []),
    staleTime: 30_000, refetchInterval: 60_000,
  });

  // Derived data
  const userPods = useMemo(() => allPods.filter(p => !isSystemNamespace(p.metadata.namespace)), [allPods]);
  const unhealthyNodes = useMemo(() => nodes.filter((n: any) => {
    const ready = (n.status?.conditions || []).find((c: any) => c.type === 'Ready');
    return !ready || ready.status !== 'True';
  }), [nodes]);
  const degradedOperators = useMemo(() => operators.filter((co: any) =>
    (co.status?.conditions || []).some((c: any) => c.type === 'Degraded' && c.status === 'True')
  ), [operators]);
  const failedPods = useMemo(() => allPods.filter((p: any) => {
    const statuses = p.status?.containerStatuses || [];
    return statuses.some((cs: any) => {
      const w = cs.state?.waiting?.reason;
      return w === 'CrashLoopBackOff' || w === 'ImagePullBackOff' || w === 'ErrImagePull';
    }) || p.status?.phase === 'Failed';
  }), [allPods]);

  const criticalAlerts = useMemo(() => firingAlerts.filter(a => a.metric.severity === 'critical'), [firingAlerts]);
  const warningAlerts = useMemo(() => firingAlerts.filter(a => a.metric.severity === 'warning'), [firingAlerts]);

  const certInfos = useMemo(() => tlsSecrets.map(parseCertExpiry).filter(c => c.daysUntilExpiry !== null), [tlsSecrets]);
  const certsExpiringSoon7 = useMemo(() => certInfos.filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry < 7), [certInfos]);
  const certsExpiringSoon30 = useMemo(() => certInfos.filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry >= 7 && c.daysUntilExpiry < 30), [certInfos]);
  const topExpiring = useMemo(() => [...certInfos].sort((a, b) => (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999)).slice(0, 5), [certInfos]);

  // Risk score
  const riskScore = useMemo(() => {
    let score = 0;
    score += Math.min(40, criticalAlerts.length * 20);
    score += Math.min(20, warningAlerts.length * 5);
    score += unhealthyNodes.length * 15;
    score += degradedOperators.length * 10;
    score += certsExpiringSoon7.length * 15;
    score += certsExpiringSoon30.length * 5;
    score += Math.min(15, failedPods.length * 3);
    return Math.min(100, score);
  }, [criticalAlerts, warningAlerts, unhealthyNodes, degradedOperators, certsExpiringSoon7, certsExpiringSoon30, failedPods]);

  // Attention items
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    for (const co of degradedOperators) items.push({ severity: 'critical', title: `Operator ${co.metadata.name} is degraded`, detail: 'Cluster operator not functioning', path: '/admin?tab=operators', pathTitle: 'Operators' });
    for (const n of unhealthyNodes) items.push({ severity: 'critical', title: `Node ${n.metadata.name} is NotReady`, detail: 'Node is not accepting workloads', path: `/r/v1~nodes/_/${n.metadata.name}`, pathTitle: n.metadata.name });
    for (const a of criticalAlerts) items.push({ severity: 'critical', title: a.metric.alertname || 'Critical alert', detail: a.metric.namespace ? `in ${a.metric.namespace}` : 'cluster-scoped', path: '/alerts', pathTitle: 'Alerts' });
    for (const p of failedPods.slice(0, 10)) {
      const reason = (p as any).status?.containerStatuses?.find((cs: any) => cs.state?.waiting)?.state?.waiting?.reason || 'Error';
      items.push({ severity: 'warning', title: `Pod ${p.metadata.name} — ${reason}`, detail: p.metadata.namespace || '', path: `/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, pathTitle: p.metadata.name });
    }
    for (const c of certsExpiringSoon7) items.push({ severity: 'critical', title: `Certificate ${c.name} expires in ${c.daysUntilExpiry}d`, detail: c.namespace, path: `/r/v1~secrets/${c.namespace}/${c.name}`, pathTitle: c.name });
    for (const c of certsExpiringSoon30) items.push({ severity: 'warning', title: `Certificate ${c.name} expires in ${c.daysUntilExpiry}d`, detail: c.namespace, path: `/r/v1~secrets/${c.namespace}/${c.name}`, pathTitle: c.name });
    return items.slice(0, 8);
  }, [degradedOperators, unhealthyNodes, criticalAlerts, failedPods, certsExpiringSoon7, certsExpiringSoon30]);

  // Vitals
  const cpuPct = cpuData.length > 0 ? cpuData[0].value : null;
  const memPct = memData.length > 0 ? memData[0].value : null;
  const readyNodes = nodes.filter((n: any) => (n.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True'));
  const runningPods = userPods.filter((p: any) => p.status?.phase === 'Running');

  // Change summary
  const changeSummary = useMemo(() => {
    let newAlerts = 0, podsRestarted = 0, deploymentsScaled = 0, rbacChanges = 0;
    for (const e of recentEvents) {
      const reason = (e as any).reason || '';
      const kind = (e as any).involvedObject?.kind || '';
      if (reason === 'Firing' || reason === 'AlertFiring') newAlerts++;
      if (reason === 'BackOff' || reason === 'Killing' || reason === 'Restarted') podsRestarted++;
      if ((reason === 'ScalingReplicaSet' || reason === 'SuccessfulRescale') && kind === 'Deployment') deploymentsScaled++;
      if (kind === 'RoleBinding' || kind === 'ClusterRoleBinding') rbacChanges++;
    }
    for (const p of allPods) {
      for (const cs of ((p as any).status?.containerStatuses || [])) {
        if (cs.restartCount > 5) podsRestarted++;
      }
    }
    return { newAlerts, podsRestarted, deploymentsScaled, rbacChanges };
  }, [recentEvents, allPods]);

  const SEVERITY_COLORS = { critical: 'text-red-400', warning: 'text-amber-400', info: 'text-blue-400' } as const;

  return (
    <div className="space-y-6">
      {/* Risk Score + Attention */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Cluster Risk Score" icon={<Shield className="w-4 h-4 text-blue-400" />}>
          <div className="flex flex-col items-center py-2">
            <RiskScoreRing score={riskScore} />
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400">
              <span>Critical alerts: {criticalAlerts.length}</span>
              <span>Warning alerts: {warningAlerts.length}</span>
              <span>Unhealthy nodes: {unhealthyNodes.length}</span>
              <span>Degraded operators: {degradedOperators.length}</span>
              <span>Certs &lt;7d: {certsExpiringSoon7.length}</span>
              <span>Failed pods: {failedPods.length}</span>
            </div>
          </div>
        </Panel>

        <div className="lg:col-span-2">
          <Panel title="Needs Attention" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}>
            {attentionItems.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-slate-500">
                <CheckCircle className="w-8 h-8 mb-2 text-green-500" />
                <span className="text-sm">All clear — no items need attention</span>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {attentionItems.map((item, i) => {
                  const Icon = item.severity === 'critical' ? AlertOctagon : AlertTriangle;
                  return (
                    <button key={i} onClick={() => go(item.path, item.pathTitle)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-slate-800/60 transition-colors text-left group">
                      <Icon className={cn('w-4 h-4 shrink-0', SEVERITY_COLORS[item.severity])} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{item.title}</div>
                        <div className="text-xs text-slate-500 truncate">{item.detail}</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <VitalCard icon={<Cpu className="w-3.5 h-3.5" />} label="CPU Usage" value={cpuPct !== null ? `${cpuPct.toFixed(1)}%` : '--'}
          color={cpuPct !== null ? (cpuPct > 85 ? 'text-red-400' : cpuPct > 70 ? 'text-amber-400' : 'text-green-400') : undefined} />
        <VitalCard icon={<MemoryStick className="w-3.5 h-3.5" />} label="Memory Usage" value={memPct !== null ? `${memPct.toFixed(1)}%` : '--'}
          color={memPct !== null ? (memPct > 85 ? 'text-red-400' : memPct > 70 ? 'text-amber-400' : 'text-green-400') : undefined} />
        <VitalCard icon={<Server className="w-3.5 h-3.5" />} label="Node Health" value={`${readyNodes.length} / ${nodes.length}`}
          color={unhealthyNodes.length > 0 ? 'text-red-400' : 'text-green-400'} />
        <VitalCard icon={<HeartPulse className="w-3.5 h-3.5" />} label="Pod Health" value={`${runningPods.length} / ${userPods.length}`}
          color={failedPods.length > 0 ? 'text-amber-400' : 'text-green-400'} />
      </div>

      {/* Change Summary + Cert Expiry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Since Yesterday" icon={<Clock className="w-4 h-4 text-blue-400" />}>
          <div className="divide-y divide-slate-800/50">
            <ChangeStat icon={<Bell className="w-4 h-4" />} label="New alerts fired" count={changeSummary.newAlerts} />
            <ChangeStat icon={<RotateCcw className="w-4 h-4" />} label="Pods restarted" count={changeSummary.podsRestarted} />
            <ChangeStat icon={<Scale className="w-4 h-4" />} label="Deployments scaled" count={changeSummary.deploymentsScaled} />
            <ChangeStat icon={<UserCheck className="w-4 h-4" />} label="RBAC changes" count={changeSummary.rbacChanges} />
          </div>
        </Panel>

        <Panel title="Certificate Expiry" icon={<Lock className="w-4 h-4 text-blue-400" />}>
          {topExpiring.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-slate-500">
              <Lock className="w-6 h-6 mb-2" />
              <span className="text-sm">No TLS certificates found</span>
            </div>
          ) : (
            <div className="space-y-1">
              {topExpiring.map((cert) => {
                const days = cert.daysUntilExpiry ?? 0;
                const color = days < 7 ? 'text-red-400' : days < 30 ? 'text-amber-400' : 'text-green-400';
                const bgColor = days < 7 ? 'bg-red-500/10' : days < 30 ? 'bg-amber-500/10' : 'bg-green-500/10';
                return (
                  <button key={`${cert.namespace}/${cert.name}`} onClick={() => go(`/r/v1~secrets/${cert.namespace}/${cert.name}`, cert.name)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/60 transition-colors text-left group">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200 truncate">{cert.name}</div>
                      <div className="text-xs text-slate-500 truncate">{cert.namespace}{cert.expirySource === 'creation-estimate' ? ' (estimated)' : ''}</div>
                    </div>
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', color, bgColor)}>{cert.daysUntilExpiry}d</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />
                  </button>
                );
              })}
              <button onClick={() => go('/admin?tab=certificates', 'Certificates')}
                className="w-full flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 py-2">
                View all certificates <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function VitalCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-3 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider">{icon}{label}</div>
      <div className={cn('text-2xl font-bold', color || 'text-slate-100')}>{value}</div>
    </div>
  );
}

function ChangeStat({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="text-slate-400">{icon}</div>
      <div className="flex-1 text-sm text-slate-300">{label}</div>
      <span className={cn('text-sm font-semibold tabular-nums', count > 0 ? 'text-slate-100' : 'text-slate-600')}>{count}</span>
    </div>
  );
}
