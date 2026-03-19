import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, AlertTriangle, AlertOctagon, Server,
  HeartPulse, ArrowRight, CheckCircle, Lock,
  ChevronRight, ChevronDown, Info, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../../engine/query';
import { queryInstant } from '../../components/metrics/prometheus';
import { MetricCard } from '../../components/metrics/Sparkline';
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
    if (!isNaN(expiry.getTime())) return { name, namespace, daysUntilExpiry: Math.floor((expiry.getTime() - Date.now()) / 86_400_000), expirySource: 'cert-manager' };
  }
  const serviceCaExpiry = annotations['service.beta.openshift.io/expiry'];
  if (serviceCaExpiry) {
    const expiry = new Date(serviceCaExpiry);
    if (!isNaN(expiry.getTime())) return { name, namespace, daysUntilExpiry: Math.floor((expiry.getTime() - Date.now()) / 86_400_000), expirySource: 'service-ca' };
  }
  const created = secret.metadata.creationTimestamp;
  if (created) {
    const estimatedExpiry = new Date(new Date(created).getTime() + 365 * 86_400_000);
    return { name, namespace, daysUntilExpiry: Math.floor((estimatedExpiry.getTime() - Date.now()) / 86_400_000), expirySource: 'creation-estimate' };
  }
  return { name, namespace, daysUntilExpiry: null, expirySource: 'unknown' };
}

interface AttentionItem {
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  path: string;
  pathTitle: string;
}

function RiskScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 44;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = clamped <= 20 ? '#22c55e' : clamped <= 50 ? '#eab308' : clamped <= 75 ? '#f97316' : '#ef4444';
  const label = clamped <= 20 ? 'Healthy' : clamped <= 50 ? 'Caution' : clamped <= 75 ? 'At Risk' : 'Critical';
  const bgColor = clamped <= 20 ? 'text-green-400' : clamped <= 50 ? 'text-yellow-400' : clamped <= 75 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)" className="transition-all duration-700" />
        <text x="50" y="47" textAnchor="middle" className="fill-slate-100 font-bold" style={{ fontSize: '26px' }}>{clamped}</text>
        <text x="50" y="62" textAnchor="middle" className="fill-slate-500" style={{ fontSize: '10px' }}>/ 100</text>
      </svg>
      <div>
        <div className={cn('text-sm font-semibold', bgColor)}>{label}</div>
        <div className="text-xs text-slate-500 mt-0.5">Cluster Risk Score</div>
      </div>
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
  const [showScoreDetails, setShowScoreDetails] = useState(false);

  // Queries
  const { data: tlsSecrets = [] } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', 'tls-secrets'],
    queryFn: async () => {
      const secrets = await k8sList<K8sResource>('/api/v1/secrets');
      return secrets.filter((s: any) => s.type === 'kubernetes.io/tls');
    },
    staleTime: 120_000, refetchInterval: 300_000,
  });

  type PromResult = { metric: Record<string, string>; value: number };
  const { data: firingAlerts = [] } = useQuery<PromResult[]>({
    queryKey: ['prom', 'firing-alerts'],
    queryFn: () => queryInstant('ALERTS{alertstate="firing"}').catch((): PromResult[] => []),
    staleTime: 30_000, refetchInterval: 60_000,
  });

  // Derived
  const userPods = useMemo(() => allPods.filter(p => !isSystemNamespace(p.metadata.namespace)), [allPods]);
  const unhealthyNodes = useMemo(() => nodes.filter((n: any) => {
    const ready = (n.status?.conditions || []).find((c: any) => c.type === 'Ready');
    return !ready || ready.status !== 'True';
  }), [nodes]);
  const degradedOperators = useMemo(() => operators.filter((co: any) =>
    (co.status?.conditions || []).some((c: any) => c.type === 'Degraded' && c.status === 'True')
  ), [operators]);
  const failedPods = useMemo(() => allPods.filter((p: any) => {
    if (isSystemNamespace(p.metadata?.namespace)) return false;
    const owners = p.metadata?.ownerReferences || [];
    if (owners.some((o: any) => o.kind === 'Job')) return false;
    const name = p.metadata?.name || '';
    if (name.startsWith('installer-') || name.startsWith('revision-pruner-')) return false;
    const statuses = p.status?.containerStatuses || [];
    if (statuses.some((cs: any) => { const w = cs.state?.waiting?.reason; return w === 'CrashLoopBackOff' || w === 'ImagePullBackOff' || w === 'ErrImagePull'; })) return true;
    if (p.status?.phase === 'Failed') { return !(statuses.length > 0 && statuses.every((cs: any) => cs.state?.terminated)); }
    return false;
  }), [allPods]);

  const criticalAlerts = useMemo(() => firingAlerts.filter(a => a.metric.severity === 'critical'), [firingAlerts]);
  const warningAlerts = useMemo(() => firingAlerts.filter(a => a.metric.severity === 'warning'), [firingAlerts]);

  const certInfos = useMemo(() => tlsSecrets.map(parseCertExpiry).filter(c => c.daysUntilExpiry !== null), [tlsSecrets]);
  const certsExpiringSoon7 = useMemo(() => certInfos.filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry < 7), [certInfos]);
  const certsExpiringSoon30 = useMemo(() => certInfos.filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry >= 7 && c.daysUntilExpiry < 30), [certInfos]);
  const urgentCerts = useMemo(() => [...certInfos].filter(c => (c.daysUntilExpiry ?? 999) < 30).sort((a, b) => (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999)).slice(0, 3), [certInfos]);

  const readyNodes = nodes.filter((n: any) => (n.status?.conditions || []).some((c: any) => c.type === 'Ready' && c.status === 'True'));
  const runningPods = userPods.filter((p: any) => p.status?.phase === 'Running');

  // Risk score
  const factors = useMemo(() => [
    { label: 'Critical alerts', count: criticalAlerts.length, points: 20, max: 40 as number | null, score: Math.min(40, criticalAlerts.length * 20) },
    { label: 'Warning alerts', count: warningAlerts.length, points: 5, max: 20 as number | null, score: Math.min(20, warningAlerts.length * 5) },
    { label: 'Unhealthy nodes', count: unhealthyNodes.length, points: 15, max: null, score: unhealthyNodes.length * 15 },
    { label: 'Degraded operators', count: degradedOperators.length, points: 10, max: null, score: degradedOperators.length * 10 },
    { label: 'Certs expiring <7d', count: certsExpiringSoon7.length, points: 15, max: null, score: certsExpiringSoon7.length * 15 },
    { label: 'Certs expiring <30d', count: certsExpiringSoon30.length, points: 5, max: null, score: certsExpiringSoon30.length * 5 },
    { label: 'Failed pods', count: failedPods.length, points: 3, max: 15 as number | null, score: Math.min(15, failedPods.length * 3) },
  ], [criticalAlerts, warningAlerts, unhealthyNodes, degradedOperators, certsExpiringSoon7, certsExpiringSoon30, failedPods]);

  const riskScore = useMemo(() => Math.min(100, factors.reduce((s, f) => s + f.score, 0)), [factors]);

  // Attention items
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    for (const co of degradedOperators) items.push({ severity: 'critical', title: `Operator ${co.metadata.name} degraded`, detail: 'Cluster operator not functioning', path: '/admin?tab=operators', pathTitle: 'Operators' });
    for (const n of unhealthyNodes) items.push({ severity: 'critical', title: `Node ${n.metadata.name} NotReady`, detail: 'Not accepting workloads', path: `/r/v1~nodes/_/${n.metadata.name}`, pathTitle: n.metadata.name });
    for (const a of criticalAlerts) items.push({ severity: 'critical', title: a.metric.alertname || 'Critical alert', detail: a.metric.namespace ? `in ${a.metric.namespace}` : 'cluster-scoped', path: '/alerts', pathTitle: 'Alerts' });
    for (const p of failedPods.slice(0, 5)) {
      const reason = (p as any).status?.containerStatuses?.find((cs: any) => cs.state?.waiting)?.state?.waiting?.reason || 'Error';
      items.push({ severity: 'warning', title: `${p.metadata.name} — ${reason}`, detail: p.metadata.namespace || '', path: `/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, pathTitle: p.metadata.name });
    }
    for (const c of certsExpiringSoon7) items.push({ severity: 'critical', title: `Cert ${c.name} expires in ${c.daysUntilExpiry}d`, detail: c.namespace, path: `/r/v1~secrets/${c.namespace}/${c.name}`, pathTitle: c.name });
    return items;
  }, [degradedOperators, unhealthyNodes, criticalAlerts, failedPods, certsExpiringSoon7]);

  const hasProblems = attentionItems.length > 0 || urgentCerts.length > 0;

  return (
    <div className="space-y-5">
      {/* Row 1: Risk score + Vitals */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Risk score — compact */}
        <div className="lg:col-span-1 bg-slate-900 rounded-lg border border-slate-800 p-4 flex flex-col items-center justify-center relative">
          <RiskScoreRing score={riskScore} />
          <button onClick={() => setShowScoreDetails(!showScoreDetails)}
            className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            <Info className="w-3 h-3" />
            Details
          </button>
          {showScoreDetails && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowScoreDetails(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 w-80 rounded-lg border border-slate-600 bg-slate-800 shadow-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-slate-200">Score Breakdown</h4>
                  <span className="text-xs text-slate-500">max 100</span>
                </div>
                <div className="space-y-1.5 mb-3">
                  {factors.map((f) => (
                    <div key={f.label} className="flex items-center gap-2 text-xs">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', f.score > 0 ? 'bg-red-500' : 'bg-slate-700')} />
                      <span className="flex-1 text-slate-300">{f.label}</span>
                      <span className="text-slate-500 tabular-nums">{f.count} x {f.points}{f.max ? ` (cap ${f.max})` : ''}</span>
                      <span className={cn('w-7 text-right font-mono tabular-nums', f.score > 0 ? 'text-red-400' : 'text-slate-600')}>+{f.score}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-700 text-xs">
                  <span className="text-slate-400">Total</span>
                  <span className="text-slate-200 font-mono font-bold">{riskScore}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Vitals */}
        <div className="lg:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard title="CPU" query="sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / sum(machine_cpu_cores) * 100" unit="%" color="#3b82f6" thresholds={{ warning: 70, critical: 90 }} />
          <MetricCard title="Memory" query="(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100" unit="%" color="#8b5cf6" thresholds={{ warning: 75, critical: 90 }} />
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider">
              <Server className="w-3.5 h-3.5" />Nodes
            </div>
            <div className={cn('text-2xl font-bold mt-1', unhealthyNodes.length > 0 ? 'text-red-400' : 'text-green-400')}>
              {readyNodes.length} / {nodes.length}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">ready</div>
          </div>
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider">
              <HeartPulse className="w-3.5 h-3.5" />Pods
            </div>
            <div className={cn('text-2xl font-bold mt-1', failedPods.length > 0 ? 'text-amber-400' : 'text-green-400')}>
              {runningPods.length} / {userPods.length}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">user namespaces</div>
          </div>
        </div>
      </div>

      {/* Attention items — only if there are problems */}
      {attentionItems.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-red-900/30">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-slate-200">Needs Attention</span>
            <span className="text-xs text-slate-500 ml-auto">{attentionItems.length} item{attentionItems.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-slate-800/50">
            {attentionItems.map((item, i) => (
              <button key={i} onClick={() => go(item.path, item.pathTitle)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/50 transition-colors text-left group">
                {item.severity === 'critical'
                  ? <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                  : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-200">{item.title}</span>
                  <span className="text-xs text-slate-500 ml-2">{item.detail}</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Network + Disk — compact row */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard title="Network In" query="sum(rate(node_network_receive_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024" unit=" MB/s" color="#06b6d4" />
        <MetricCard title="Disk I/O" query="sum(rate(node_disk_read_bytes_total[5m]) + rate(node_disk_written_bytes_total[5m])) / 1024 / 1024" unit=" MB/s" color="#f59e0b" />
      </div>

      {/* Cert expiry — only if there are certs expiring within 30 days */}
      {urgentCerts.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-yellow-900/30">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-slate-200">Certificates Expiring Soon</span>
            </div>
            <button onClick={() => go('/admin?tab=certificates', 'Certificates')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-800/50">
            {urgentCerts.map((cert) => {
              const days = cert.daysUntilExpiry ?? 0;
              const color = days < 7 ? 'text-red-400' : 'text-amber-400';
              return (
                <button key={`${cert.namespace}/${cert.name}`} onClick={() => go(`/r/v1~secrets/${cert.namespace}/${cert.name}`, cert.name)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-800/50 transition-colors text-left group">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-200">{cert.name}</span>
                    <span className="text-xs text-slate-500 ml-2">{cert.namespace}</span>
                  </div>
                  <span className={cn('text-xs font-medium font-mono', color)}>{days}d</span>
                  <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* All clear state */}
      {!hasProblems && (
        <div className="bg-slate-900 rounded-lg border border-green-900/30 p-6 text-center">
          <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
          <div className="text-sm font-medium text-slate-200">All clear</div>
          <div className="text-xs text-slate-500 mt-1">{nodes.length} nodes, {operators.length} operators, {userPods.length} user pods — no issues detected</div>
          <div className="flex items-center justify-center gap-3 mt-4">
            <button onClick={() => go('/alerts', 'Alerts')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors flex items-center gap-1.5">
              <FileText className="w-3 h-3" /> Alerts
            </button>
            <button onClick={() => go('/admin?tab=certificates', 'Certificates')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Certificates
            </button>
            <button onClick={() => go('/admin?tab=readiness', 'Readiness')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> Readiness
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
