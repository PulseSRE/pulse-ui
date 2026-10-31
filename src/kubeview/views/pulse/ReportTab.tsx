import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, AlertTriangle, AlertOctagon, Server,
  HeartPulse, ArrowRight, CheckCircle, Lock,
  ChevronRight, ChevronDown, Info, FileText,
  Activity, Database, Gauge, Calendar,
  ArrowUpCircle, Clock, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList, k8sGet } from '../../engine/query';
import { useIncidentFeed } from '../../hooks/useIncidentFeed';
import { fetchTlsSecrets, summarizeTlsSecrets } from '../../engine/certExpiry';
import { safeQuery } from '../../engine/safeQuery';
import { AIIconStatic, AI_ACCENT, PromptPill } from '../../components/agent/AIBranding';
import { askPulse } from '../../engine/askPulse';
import { generateSmartPrompts } from '../../engine/smartPrompts';
import { parseResourceValue } from '../../engine/formatting';
import { queryInstant } from '../../components/metrics/prometheus';
import { MetricCard } from '../../components/metrics/Sparkline';
import { CHART_COLORS } from '../../engine/colors';
import { MetricGrid } from '../../components/primitives/MetricGrid';
import { diagnoseResource, type Diagnosis } from '../../engine/diagnosis';
import { resourceDetailUrl } from '../../engine/gvr';
import type { K8sResource } from '../../engine/renderers';
import type { Node, Pod, ClusterOperator, ClusterVersion, Condition, Event, Secret, PersistentVolumeClaim } from '../../engine/types';
import type { Deployment } from '../../engine/types/apps';
import { useClusterStore } from '../../store/clusterStore';
import { compareVersions } from '../../engine/version';
import { useArgoCDStore } from '../../store/argoCDStore';
import { Card } from '../../components/primitives/Card';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { RemoteMetricsNotice } from '../../components/metrics/RemoteMetricsNotice';
import { metricsAvailableFor } from '../../components/metrics/prometheus';

/** ResourceQuota resource */
interface ResourceQuota extends K8sResource {
  status?: { hard?: Record<string, string>; used?: Record<string, string>; [key: string]: unknown };
}

import { isSystemNamespace } from '../../engine/namespace';

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

interface AttentionItem {
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  path: string;
  pathTitle: string;
  steps?: string[];
}

const ZEN_MESSAGES = [
  'Your cluster is healthy. Nothing needs your attention right now.',
  'Zero issues detected. Time for proactive improvements?',
  'Everything is running smoothly. You\'ve earned this moment.',
  'All systems green. A good time to review and optimize.',
  'Cluster health is excellent. Consider planning ahead.',
];

function getZenMessage(): string {
  // Pick a message based on the current hour so it feels fresh but stable within the hour
  return ZEN_MESSAGES[new Date().getHours() % ZEN_MESSAGES.length];
}

interface ClusterZenProps {
  nodeCount: number;
  podCount: number;
  deploymentCount: number;
  go: (path: string, title: string) => void;
  onDismiss: () => void;
}

function ClusterZen({ nodeCount, podCount, deploymentCount, go, onDismiss }: ClusterZenProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8">
      {/* Animated icon */}
      <div className="relative mb-8">
        <div className="absolute inset-0 rounded-full bg-emerald-500/10 scale-150 kv-pulse" />
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-emerald-950/60 border border-emerald-800/40">
          <Shield className="w-10 h-10 text-emerald-400" />
        </div>
      </div>

      {/* Headline */}
      <h2 className="text-3xl font-bold text-slate-100 tracking-tight mb-3">
        All Systems Nominal
      </h2>

      {/* Sub-message */}
      <p className="text-base text-slate-400 max-w-md text-center leading-relaxed mb-8">
        {getZenMessage()}
      </p>

      {/* Quick stats */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-10">
        <span className="text-emerald-400 font-medium">{nodeCount}</span> node{nodeCount !== 1 ? 's' : ''} healthy
        <span className="text-slate-700 mx-1">&middot;</span>
        <span className="text-emerald-400 font-medium">{podCount}</span> pod{podCount !== 1 ? 's' : ''} running
        <span className="text-slate-700 mx-1">&middot;</span>
        <span className="text-emerald-400 font-medium">{deploymentCount}</span> deployment{deploymentCount !== 1 ? 's' : ''} available
      </div>

      {/* Proactive suggestions */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
        <button
          onClick={() => go('/security', 'Security')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700/50 transition-colors"
        >
          <Shield className="w-4 h-4 text-emerald-400" />
          Review Security Posture
        </button>
        <button
          onClick={() => go('/workloads', 'Workloads')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700/50 transition-colors"
        >
          <Gauge className="w-4 h-4 text-emerald-400" />
          Check Resource Optimization
        </button>
        <button
          onClick={() => go('/compute?tab=capacity', 'Capacity')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700/50 transition-colors"
        >
          <Server className="w-4 h-4 text-emerald-400" />
          Explore Capacity Planning
        </button>
      </div>

      {/* Show full report */}
      <button
        onClick={onDismiss}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <Eye className="w-3.5 h-3.5" />
        Show full report
      </button>
    </div>
  );
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

function ZoneHeader({ number, title, subtitle, icon }: { number: number; title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-bold text-slate-400">{number}</div>
      <div className="flex items-center gap-2 flex-1">
        {icon}
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <span className="text-xs text-slate-500 italic">{subtitle}</span>
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={cn('w-2 h-2 rounded-full shrink-0', ok ? 'bg-green-500' : 'bg-red-500')} />;
}

export interface ReportTabProps {
  nodes: Node[];
  allPods: Pod[];
  deployments: Deployment[];
  pvcs: PersistentVolumeClaim[];
  operators: ClusterOperator[];
  /** Lists that failed to load; those areas are unknown, not clear. */
  unavailable?: string[];
  /**
   * The events PulseView already watches. The report used to list every
   * event in the cluster a second time on its own poll.
   */
  events?: Event[];
  /**
   * Open findings + firing alerts as the posture bar counts them. "All clear"
   * is only shown when this is 0, so the page cannot say "3 critical" above
   * and "All clear" below.
   */
  postureIssues?: number;
  go: (path: string, title: string) => void;
}

/**
 * Kinds whose events are real changes — rollouts, scaling, configuration —
 * rather than pod lifecycle noise (Pulled, Scheduled, Killing, …).
 */
const CHANGE_KINDS = new Set([
  'Deployment', 'StatefulSet', 'DaemonSet', 'DeploymentConfig', 'CronJob',
  'HorizontalPodAutoscaler', 'ConfigMap', 'MachineConfigPool', 'ClusterVersion', 'ClusterOperator',
]);
const RECENT_CHANGES_SHOWN = 8;

export function ReportTab({ nodes, allPods, deployments, pvcs, operators, unavailable = [], events = [], postureIssues, go }: ReportTabProps) {
  const clusterId = useActiveClusterId();
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [zenDismissed, setZenDismissed] = useState(() => sessionStorage.getItem('pulse-zen-dismissed') === 'true');
  /** Open AI sidebar in chat mode with a prompt */
  const askAgent = useCallback((prompt: string) => {
    askPulse(prompt);
  }, []);

  const toggleExpanded = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // === Queries ===
  const { data: tlsSecrets = [], isError: tlsSecretsError } = useQuery<Secret[]>({
    queryKey: ['k8s', 'list', 'tls-secrets', clusterId],
    queryFn: () => fetchTlsSecrets<Secret>(clusterId),
    staleTime: 120_000, refetchInterval: 300_000,
  });

  type PromResult = { metric: Record<string, string>; value: number };

  // Firing alerts come from the incident feed, not a second query of our own.
  //
  // This tab used to run its own firing-alert query against the query API
  // while useIncidentFeed independently fetched /api/v1/rules, so the same
  // alerts were pulled twice, cached twice, and classified twice. The two
  // disagreed in front of users: the posture bar reported "1 critical —
  // SearchPVCNotPresent" while this tab, reading severity straight off the
  // alert, correctly reported 0 critical for the same moment. Two numbers for
  // one question is worse than either number alone.
  //
  // normalizeSeverity maps Prometheus severity through unchanged for
  // critical and warning, so the classification here is the same as before —
  // it is now simply the only one.
  const {
    incidents: alertIncidents,
    isError: alertsFetchError,
    alertsUnavailable,
  } = useIncidentFeed({ sources: ['prometheus-alert'], limit: 0 });
  // A remote cluster's alerts cannot be read: as unknown as a failed fetch.
  const alertsError = alertsFetchError || alertsUnavailable;

  const { data: apiLatency } = useQuery<number | null>({
    queryKey: ['prom', 'api-latency', clusterId],
    queryFn: async () => {
      const result = (await safeQuery(() => queryInstant('histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!~"WATCH|LIST"}[5m])) by (le))', undefined, clusterId))) ?? [];
      return result.length > 0 ? result[0].value * 1000 : null;
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });

  const { data: etcdLeaderChanges } = useQuery<number | null>({
    queryKey: ['prom', 'etcd-leader-changes', clusterId],
    queryFn: async () => {
      const result = (await safeQuery(() => queryInstant('max(changes(etcd_server_is_leader[1h]))', undefined, clusterId))) ?? [];
      return result.length > 0 ? result[0].value : null;
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });

  const { data: pvUsage = [] } = useQuery<PromResult[]>({
    queryKey: ['prom', 'pv-usage', clusterId],
    queryFn: async () => ((await safeQuery(() => queryInstant('kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100', undefined, clusterId))) ?? []) as PromResult[],
    staleTime: 60_000, refetchInterval: 120_000,
  });

  const { data: resourceQuotas = [] } = useQuery<ResourceQuota[]>({
    queryKey: ['k8s', 'list', 'resourcequotas', undefined, clusterId],
    queryFn: () => k8sList<ResourceQuota>('/api/v1/resourcequotas', undefined, clusterId),
    staleTime: 120_000, refetchInterval: 300_000,
  });

  // Subscribe, so drift appears when the Argo store finishes loading.
  const argoApplications = useArgoCDStore((s) => s.applications);
  const { data: clusterVersion, isError: clusterVersionError, isPending: clusterVersionPending } = useQuery<ClusterVersion | null>({
    queryKey: ['k8s', 'get', 'clusterversion', clusterId],
    queryFn: () => safeQuery(() => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version', clusterId)),
    staleTime: 300_000, refetchInterval: 600_000,
  });

  // Rollouts and config changes in the last hour, from the watched events.
  const recentEvents = useMemo(() => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    return events.filter((e) =>
      CHANGE_KINDS.has(e.involvedObject?.kind || '')
      && (e.lastTimestamp || e.metadata?.creationTimestamp || '') >= oneHourAgo);
  }, [events]);

  // === Derived data ===
  const userPods = useMemo(() => allPods.filter(p => !isSystemNamespace(p.metadata.namespace)), [allPods]);
  const unhealthyNodes = useMemo(() => nodes.filter((n) => {
    const ready = (n.status?.conditions || []).find((c) => c.type === 'Ready');
    return !ready || ready.status !== 'True';
  }), [nodes]);
  const degradedOperators = useMemo(() => operators.filter((co) =>
    (co.status?.conditions || []).some((c) => c.type === 'Degraded' && c.status === 'True')
  ), [operators]);
  const failedPods = useMemo(() => allPods.filter((p) => {
    if (isSystemNamespace(p.metadata?.namespace)) return false;
    const owners = p.metadata?.ownerReferences || [];
    if (owners.some((o) => o.kind === 'Job')) return false;
    const name = p.metadata?.name || '';
    if (name.startsWith('installer-') || name.startsWith('revision-pruner-')) return false;
    const statuses = p.status?.containerStatuses || [];
    if (statuses.some((cs) => { const w = cs.state?.waiting?.reason; return w === 'CrashLoopBackOff' || w === 'ImagePullBackOff' || w === 'ErrImagePull'; })) return true;
    if (p.status?.phase === 'Failed') { return !(statuses.length > 0 && statuses.every((cs) => cs.state?.terminated)); }
    return false;
  }), [allPods]);

  const criticalAlerts = useMemo(() => alertIncidents.filter(a => a.severity === 'critical'), [alertIncidents]);
  const warningAlerts = useMemo(() => alertIncidents.filter(a => a.severity === 'warning'), [alertIncidents]);

  const { certs: certInfos, unreadable: unreadableCerts } = useMemo(() => summarizeTlsSecrets(tlsSecrets), [tlsSecrets]);
  const certsExpiringSoon7 = useMemo(() => certInfos.filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry < 7), [certInfos]);
  const certsExpiringSoon30 = useMemo(() => certInfos.filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry >= 7 && c.daysUntilExpiry < 30), [certInfos]);
  // Zone 1 lists 7–30 days; under 7 days is an Attention item in Zone 3.
  const urgentCerts = useMemo(() => [...certInfos].filter(c => c.daysUntilExpiry !== null && c.daysUntilExpiry >= 7 && c.daysUntilExpiry < 30).sort((a, b) => (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999)).slice(0, 5), [certInfos]);

  const readyNodes = useMemo(() => nodes.filter((n) => (n.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True')), [nodes]);
  const runningPods = useMemo(() => userPods.filter((p) => p.status?.phase === 'Running'), [userPods]);

  // Nodes under pressure
  const pressuredNodes = useMemo(() => nodes.filter((n) => {
    const conditions = n.status?.conditions || [];
    return conditions.some((c) =>
      (c.type === 'DiskPressure' || c.type === 'MemoryPressure' || c.type === 'PIDPressure') && c.status === 'True'
    );
  }), [nodes]);

  // PVs over 85% used
  const pvOverloaded = useMemo(() => pvUsage.filter(p => p.value > 85), [pvUsage]);

  // Quota overages
  const quotaOverages = useMemo(() => {
    const overages: { namespace: string; name: string; resource: string; used: string; hard: string }[] = [];
    for (const rq of resourceQuotas) {
      const hard = rq.status?.hard || {};
      const used = rq.status?.used || {};
      for (const resource of Object.keys(hard)) {
        const hardVal = parseResourceValue(hard[resource]);
        const usedVal = parseResourceValue(used[resource] || '0');
        if (hardVal > 0 && usedVal > hardVal) {
          overages.push({ namespace: rq.metadata.namespace || '', name: rq.metadata.name, resource, used: used[resource], hard: hard[resource] });
        }
      }
    }
    return overages;
  }, [resourceQuotas]);

  // Top restarting pods
  const topRestartingPods = useMemo(() => {
    return userPods
      .map((p) => {
        const restarts = (p.status?.containerStatuses || []).reduce((sum: number, cs) => sum + (cs.restartCount || 0), 0);
        return { pod: p, restarts };
      })
      .filter(r => r.restarts > 5)
      .sort((a, b) => b.restarts - a.restarts)
      .slice(0, 5);
  }, [userPods]);

  // Cluster version update
  const updateAvailable = useMemo(() => {
    if (!clusterVersion) return null;
    const currentVersion = clusterVersion.status?.desired?.version || '';
    const updates = clusterVersion.status?.availableUpdates || [];
    if (updates.length === 0) return null;
    // CVO does not order availableUpdates; show the newest.
    const latest = [...updates].sort((a, b) => compareVersions(b.version || '', a.version || ''))[0];
    return { current: currentVersion, available: latest?.version || '', count: updates.length };
  }, [clusterVersion]);

  // Recent changes — individual events with links + who
  const recentChanges = useMemo(() => {
    return recentEvents
      .filter(e => e.involvedObject?.name)
      .sort((a, b) => {
        const ta = a.lastTimestamp || a.metadata.creationTimestamp || '';
        const tb = b.lastTimestamp || b.metadata.creationTimestamp || '';
        return tb.localeCompare(ta);
      })
      .slice(0, RECENT_CHANGES_SHOWN)
      .map(e => {
        const obj = e.involvedObject || {} as Event['involvedObject'];
        const kind = obj.kind || '';
        const name = obj.name || '';
        const namespace = obj.namespace || '';
        const path = resourceDetailUrl({
          apiVersion: obj.apiVersion || 'v1',
          kind,
          metadata: { name, namespace: namespace || undefined },
        });
        const source = e.source?.component || (e as Event & { reportingComponent?: string }).reportingComponent || '';
        const reason = e.reason || '';
        const message = e.message || '';
        const timestamp = e.lastTimestamp || e.metadata.creationTimestamp || '';
        const ago = timestamp ? formatTimeAgo(timestamp) : '';
        return { kind, name, namespace, reason, message, source, path, ago };
      });
  }, [recentEvents]);

  // Control plane operators
  const controlPlaneOps = useMemo(() => {
    const cpNames = ['kube-apiserver', 'etcd', 'authentication', 'kube-controller-manager', 'kube-scheduler'];
    if (isHyperShift) {
      // On HyperShift, only show CP operators that actually exist in the cluster
      return cpNames
        .map(name => {
          const op = operators.find((o) => o.metadata.name === name);
          if (!op) return null;
          const conditions: Condition[] = op.status?.conditions || [];
          const available = conditions.some((c) => c.type === 'Available' && c.status === 'True');
          const degraded = conditions.some((c) => c.type === 'Degraded' && c.status === 'True');
          return { name, available, degraded, found: true };
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);
    }
    return cpNames.map(name => {
      const op = operators.find((o) => o.metadata.name === name);
      if (!op) return { name, available: false, degraded: false, found: false };
      const conditions: Condition[] = op.status?.conditions || [];
      const available = conditions.some((c) => c.type === 'Available' && c.status === 'True');
      const degraded = conditions.some((c) => c.type === 'Degraded' && c.status === 'True');
      return { name, available, degraded, found: true };
    });
  }, [operators, isHyperShift]);

  // Diagnosed resources (for Zone 3 issues)
  const _diagnosedResources = useMemo(() => {
    const all = [...userPods, ...deployments, ...nodes, ...pvcs];
    const results: { resource: K8sResource; diagnoses: Diagnosis[]; maxSeverity: 'critical' | 'warning' | 'info' }[] = [];
    for (const resource of all) {
      const diagnoses = diagnoseResource(resource);
      if (diagnoses.length > 0) {
        const hasCritical = diagnoses.some(d => d.severity === 'critical');
        const hasWarning = diagnoses.some(d => d.severity === 'warning');
        results.push({ resource, diagnoses, maxSeverity: hasCritical ? 'critical' : hasWarning ? 'warning' : 'info' });
      }
    }
    return results.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.maxSeverity] - { critical: 0, warning: 1, info: 2 }[b.maxSeverity]));
  }, [userPods, deployments, nodes, pvcs]);

  // Risk score
  const factors = useMemo(() => [
    { label: 'Critical alerts', count: criticalAlerts.length, points: 20, max: 40 as number | null, score: Math.min(40, criticalAlerts.length * 20) },
    { label: 'Warning alerts', count: warningAlerts.length, points: 5, max: 20 as number | null, score: Math.min(20, warningAlerts.length * 5) },
    // Node and operator factors stay uncapped: an all-NotReady cluster must be
    // able to reach "Critical" on that alone.
    { label: 'Unhealthy nodes', count: unhealthyNodes.length, points: 15, max: null, score: unhealthyNodes.length * 15 },
    { label: 'Degraded operators', count: degradedOperators.length, points: 10, max: null, score: degradedOperators.length * 10 },
    // Certificate factors are capped: a bulk rotation can put dozens of
    // secrets in one bucket at once, and uncapped that one category rendered
    // as "+915" against "max 100" in the breakdown.
    { label: 'Certs expiring <7d', count: certsExpiringSoon7.length, points: 15, max: 30 as number | null, score: Math.min(30, certsExpiringSoon7.length * 15) },
    { label: 'Certs expiring <30d', count: certsExpiringSoon30.length, points: 5, max: 15 as number | null, score: Math.min(15, certsExpiringSoon30.length * 5) },
    { label: 'Failed pods', count: failedPods.length, points: 3, max: 15 as number | null, score: Math.min(15, failedPods.length * 3) },
  ], [criticalAlerts, warningAlerts, unhealthyNodes, degradedOperators, certsExpiringSoon7, certsExpiringSoon30, failedPods]);

  const riskScore = useMemo(() => Math.min(100, factors.reduce((s, f) => s + f.score, 0)), [factors]);

  const dismissZen = useCallback(() => {
    setZenDismissed(true);
    sessionStorage.setItem('pulse-zen-dismissed', 'true');
  }, []);

  // Attention items (Zone 3)
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    for (const co of degradedOperators) items.push({ severity: 'critical', title: `Operator ${co.metadata.name} degraded`, detail: 'Cluster operator not functioning', path: '/admin?tab=operators', pathTitle: 'Operators' });
    for (const n of unhealthyNodes) items.push({ severity: 'critical', title: `Node ${n.metadata.name} NotReady`, detail: 'Not accepting workloads', path: `/r/v1~nodes/_/${n.metadata.name}`, pathTitle: n.metadata.name,
      steps: ['Check kubelet status on the node', 'Review node conditions (DiskPressure, MemoryPressure)', 'Check network connectivity to control plane', 'Review system logs (journalctl -u kubelet)'] });
    for (const a of criticalAlerts) items.push({ severity: 'critical', title: a.title || 'Critical alert', detail: a.namespace ? `in ${a.namespace}` : 'cluster-scoped', path: '/alerts', pathTitle: 'Alerts' });
    for (const p of failedPods.slice(0, 5)) {
      const reason = p.status?.containerStatuses?.find((cs) => cs.state?.waiting)?.state?.waiting?.reason || 'Error';
      const steps = reason === 'CrashLoopBackOff'
        ? ['Check pod logs for error messages', 'Verify image exists and is pullable', 'Check resource limits (OOM kills)', 'Review liveness probe configuration']
        : reason === 'ImagePullBackOff' || reason === 'ErrImagePull'
        ? ['Verify image name and tag are correct', 'Check registry credentials (imagePullSecrets)', 'Verify network connectivity to registry']
        : ['Check pod events for details', 'Review pod logs', 'Verify configuration'];
      items.push({ severity: 'warning', title: `${p.metadata.name} — ${reason}`, detail: p.metadata.namespace || '', path: `/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, pathTitle: p.metadata.name, steps });
    }
    for (const c of certsExpiringSoon7) items.push({ severity: 'critical', title: `Cert ${c.name} expires in ${c.daysUntilExpiry}d`, detail: c.namespace, path: `/r/v1~secrets/${c.namespace}/${c.name}`, pathTitle: c.name });
    // ArgoCD drift
    const argoApps = argoApplications;
    const outOfSync = argoApps.filter(a => a.status?.sync?.status === 'OutOfSync');
    if (outOfSync.length > 0) {
      items.push({ severity: 'warning', title: `${outOfSync.length} ArgoCD app${outOfSync.length > 1 ? 's' : ''} out of sync`, detail: outOfSync.map(a => a.metadata.name).slice(0, 3).join(', '), path: '/gitops', pathTitle: 'GitOps' });
    }
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.title)) return false;
      seen.add(item.title);
      return true;
    });
  }, [degradedOperators, unhealthyNodes, criticalAlerts, failedPods, certsExpiringSoon7, argoApplications]);

  const pendingPods = useMemo(() => userPods.filter((p) => p.status?.phase === 'Pending'), [userPods]);

  // Zen state: cluster is healthy, no issues
  const isZenState = riskScore <= 5
    && !alertsError // don't show Zen if alerting is broken
    && unavailable.length === 0 // nor when a list failed to load
    && (nodes.length > 0 || allPods.length > 0) // must have actual data loaded
    && attentionItems.length === 0
    && criticalAlerts.length === 0
    && pendingPods.length === 0
    && topRestartingPods.length === 0
    && failedPods.length === 0
    && unhealthyNodes.length === 0
    && degradedOperators.length === 0;

  if (isZenState && !zenDismissed) {
    const availableDeployments = deployments.filter((d) => {
      const conditions = d.status?.conditions || [];
      return conditions.some((c) => c.type === 'Available' && c.status === 'True');
    });
    return (
      <ClusterZen
        nodeCount={readyNodes.length}
        podCount={runningPods.length}
        deploymentCount={availableDeployments.length}
        go={go}
        onDismiss={dismissZen}
      />
    );
  }

  return (
    <div className="space-y-6">

      {/* ═══════ ZONE 1: Heartbeat ═══════ */}
      <div className="space-y-3">
        <ZoneHeader number={1} title="Heartbeat" subtitle="If red, your day just changed" icon={<Activity className="w-4 h-4 text-red-400" />} />

        {alertsUnavailable && <RemoteMetricsNotice compact what="Alerts and metrics" className="px-1" />}
        {alertsFetchError && (
          <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-950/30 border border-yellow-800/50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Metrics unavailable — risk score may be incomplete</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Risk score */}
          <Card className="lg:col-span-1 p-4 flex flex-col items-center justify-center relative">
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
          </Card>

          {/* Control plane status */}
          <Card className="lg:col-span-4 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Control Plane</span>
              {isHyperShift && (
                <span className="text-xs px-2 py-0.5 bg-blue-900/60 text-blue-300 rounded-full border border-blue-700/50" title="Control plane managed externally. etcd, API server, and scheduler run in a management cluster.">
                  Hosted Control Plane
                </span>
              )}
            </div>
            {isHyperShift && controlPlaneOps.length === 0 ? (
              <div className="text-xs text-slate-500 italic mb-4">Control plane operators managed externally</div>
            ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              {controlPlaneOps.map(op => (
                <button key={op.name} onClick={() => go(`/r/config.openshift.io~v1~clusteroperators/_/${op.name}`, op.name)} className="flex items-center gap-2 hover:bg-slate-800/50 rounded-sm px-1.5 py-1 -mx-1.5 transition-colors text-left">
                  <StatusDot ok={op.found && op.available && !op.degraded} />
                  <span className="text-xs text-slate-300 truncate">{op.name}</span>
                </button>
              ))}
            </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => go('/compute', 'Compute')} className="flex items-center gap-3 px-3 py-2 bg-slate-800/50 rounded-sm hover:bg-slate-800 transition-colors text-left">
                <Gauge className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="text-xs text-slate-500">API Latency (p99)</div>
                  <div className={cn('text-sm font-mono font-bold', apiLatency !== null && apiLatency !== undefined && apiLatency > 500 ? 'text-red-400' : apiLatency !== null && apiLatency !== undefined && apiLatency > 200 ? 'text-amber-400' : 'text-green-400')}>
                    {apiLatency !== null && apiLatency !== undefined ? `${apiLatency.toFixed(0)}ms` : '—'}
                  </div>
                </div>
              </button>
              <button onClick={() => go('/compute', 'Compute')} className="flex items-center gap-3 px-3 py-2 bg-slate-800/50 rounded-sm hover:bg-slate-800 transition-colors text-left">
                <Database className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="text-xs text-slate-500">Etcd Leader Changes (1h)</div>
                  <div className={cn('text-sm font-mono font-bold', etcdLeaderChanges !== null && etcdLeaderChanges !== undefined && etcdLeaderChanges > 2 ? 'text-red-400' : etcdLeaderChanges !== null && etcdLeaderChanges !== undefined && etcdLeaderChanges > 0 ? 'text-amber-400' : etcdLeaderChanges !== null && etcdLeaderChanges !== undefined ? 'text-green-400' : 'text-slate-500')}>
                    {etcdLeaderChanges !== null && etcdLeaderChanges !== undefined ? etcdLeaderChanges : <span title="Metric unavailable (etcd may run outside this cluster)">N/A</span>}
                  </div>
                </div>
              </button>
            </div>
            {!metricsAvailableFor(clusterId) && <RemoteMetricsNotice compact what="API latency and etcd metrics" className="mt-2" />}

            {/* Urgent certs in Zone 1 */}
            {urgentCerts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-slate-400 font-medium">Certificates expiring in 7–30 days</span>
                  </div>
                  <button onClick={() => go('/admin?tab=certificates', 'Certificates')}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    View all <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-1">
                  {urgentCerts.map((cert) => {
                    const days = cert.daysUntilExpiry ?? 0;
                    const color = days < 7 ? 'text-red-400' : 'text-amber-400';
                    return (
                      <button key={`${cert.namespace}/${cert.name}`} onClick={() => go(`/r/v1~secrets/${cert.namespace}/${cert.name}`, cert.name)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800/50 rounded-sm transition-colors text-left text-xs group">
                        <span className="text-slate-300 truncate flex-1">{cert.name}</span>
                        <span className="text-slate-500">{cert.namespace}</span>
                        <span className={cn('font-mono font-medium', color)}>{days}d</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(unreadableCerts > 0 || tlsSecretsError) && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400" data-testid="unreadable-certs">
                <Lock className="w-3 h-3 text-slate-500" />
                {tlsSecretsError
                  ? 'TLS secrets could not be listed — certificate expiry is unknown'
                  : `${unreadableCerts} TLS secret${unreadableCerts !== 1 ? 's' : ''} could not be read — expiry unknown`}
              </div>
            )}

            {(degradedOperators.length > 0 || certsExpiringSoon7.length > 0) && (
              <a href="#pulse-attention" onClick={(e) => { e.preventDefault(); document.getElementById('pulse-attention')?.scrollIntoView?.({ behavior: 'smooth' }); }}
                className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-1 text-xs text-red-300 hover:text-red-200">
                {[degradedOperators.length > 0 && 'Degraded operators', certsExpiringSoon7.length > 0 && 'certificates expiring within 7 days'].filter(Boolean).join(' and ')} are listed under Needs Attention <ArrowRight className="w-3 h-3" />
              </a>
            )}
          </Card>
        </div>
      </div>

      {/* ═══════ ZONE 2: Bottleneck ═══════ */}
      <div className="space-y-3">
        <ZoneHeader number={2} title="Bottleneck" subtitle="Do I need to scale?" icon={<Gauge className="w-4 h-4 text-amber-400" />} />

        {/* Vitals row */}
        <MetricGrid>
          <MetricCard title="CPU" query="sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / sum(machine_cpu_cores) * 100" unit="%" color={CHART_COLORS.blue} thresholds={{ warning: 70, critical: 90 }} onClick={() => go('/compute', 'Compute')} />
          <MetricCard title="Memory" query="(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100" unit="%" color={CHART_COLORS.violet} thresholds={{ warning: 75, critical: 90 }} onClick={() => go('/compute', 'Compute')} />
          <button onClick={() => go('/compute', 'Compute')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 hover:border-slate-600 transition-colors text-left">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider">
              <Server className="w-3.5 h-3.5" />Nodes
            </div>
            <div className={cn('text-2xl font-bold mt-1', unhealthyNodes.length > 0 ? 'text-red-400' : 'text-green-400')}>
              {readyNodes.length} / {nodes.length}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">ready</div>
          </button>
          <button onClick={() => go('/workloads', 'Workloads')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 hover:border-slate-600 transition-colors text-left">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider">
              <HeartPulse className="w-3.5 h-3.5" />Pods
            </div>
            <div className={cn('text-2xl font-bold mt-1', failedPods.length > 0 ? 'text-amber-400' : 'text-green-400')}>
              {runningPods.length} / {userPods.length}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">user namespaces</div>
          </button>
        </MetricGrid>

        {/* Network + Disk */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard title="Network In" query="sum(rate(node_network_receive_bytes_total{device!~'lo|veth.*|br.*'}[5m])) / 1024 / 1024" unit=" MB/s" color={CHART_COLORS.cyan} onClick={() => go('/networking', 'Networking')} />
          <MetricCard title="Disk I/O" query="sum(rate(node_disk_read_bytes_total[5m]) + rate(node_disk_written_bytes_total[5m])) / 1024 / 1024" unit=" MB/s" color={CHART_COLORS.amber} onClick={() => go('/storage', 'Storage')} />
        </div>

        {/* Pressure / PV / Quota warnings */}
        {(pressuredNodes.length > 0 || pvOverloaded.length > 0 || quotaOverages.length > 0) && (
          <div className="bg-slate-900 rounded-lg border border-amber-900/30 divide-y divide-slate-800/50">
            {pressuredNodes.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-slate-200">Nodes Under Pressure</span>
                </div>
                <div className="space-y-1">
                  {pressuredNodes.map((n) => {
                    const conditions = (n.status?.conditions || []).filter((c) =>
                      (c.type === 'DiskPressure' || c.type === 'MemoryPressure' || c.type === 'PIDPressure') && c.status === 'True'
                    );
                    return (
                      <button key={n.metadata.name} onClick={() => go(`/r/v1~nodes/_/${n.metadata.name}`, n.metadata.name)}
                        className="w-full flex items-center gap-2 text-xs text-left hover:bg-slate-800/50 px-2 py-1 rounded-sm transition-colors">
                        <span className="text-slate-300">{n.metadata.name}</span>
                        <span className="text-amber-400">{conditions.map((c) => c.type).join(', ')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {pvOverloaded.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-slate-200">PVs Over 85% Used</span>
                  <span className="text-xs text-slate-500">{pvOverloaded.length} volume{pvOverloaded.length !== 1 ? 's' : ''}</span>
                  <button onClick={() => go('/storage', 'Storage')} className="text-xs text-blue-400 hover:text-blue-300 ml-auto flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></button>
                </div>
                <div className="space-y-1">
                  {pvOverloaded.slice(0, 5).map((pv, i) => (
                    <button key={i} onClick={() => go('/storage', 'Storage')} className="w-full flex items-center justify-between text-xs px-2 py-1 hover:bg-slate-800/50 rounded-sm transition-colors text-left">
                      <span className="text-slate-300 truncate">{pv.metric.persistentvolumeclaim || pv.metric.namespace || 'unknown'}</span>
                      <span className="text-amber-400 font-mono">{pv.value.toFixed(1)}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {quotaOverages.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-xs font-medium text-slate-200">Quota Overages</span>
                  <button onClick={() => go('/admin?tab=quotas', 'Quotas')} className="text-xs text-blue-400 hover:text-blue-300 ml-auto flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></button>
                </div>
                <div className="space-y-1">
                  {quotaOverages.slice(0, 5).map((q, i) => (
                    <button key={i} onClick={() => go('/admin?tab=quotas', 'Quotas')} className="w-full flex items-center gap-2 text-xs px-2 py-1 hover:bg-slate-800/50 rounded-sm transition-colors text-left">
                      <span className="text-slate-300">{q.namespace}/{q.name}</span>
                      <span className="text-slate-500">{q.resource}</span>
                      <span className="text-red-400 font-mono ml-auto">{q.used} / {q.hard}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════ ZONE 3: Fire Alarm ═══════ */}
      <div className="space-y-3" id="pulse-attention">
        <ZoneHeader number={3} title="Fire Alarm" subtitle="What's broken right now?" icon={<AlertOctagon className="w-4 h-4 text-red-400" />} />

        {attentionItems.length > 0 && (
          <div className="bg-slate-900 rounded-lg border border-red-900/30">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-slate-200">Needs Attention</span>
              <span className="text-xs text-slate-500 ml-auto">{attentionItems.length} item{attentionItems.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-slate-800/50">
              {attentionItems.map((item, i) => {
                const key = `attention-${i}`;
                const isExpanded = expandedItems.has(key);
                return (
                  <div key={i} className="relative group">
                    <button onClick={() => item.steps ? toggleExpanded(key) : go(item.path, item.pathTitle)}
                      className="w-full flex items-center gap-3 pl-4 pr-32 py-2.5 hover:bg-slate-800/50 transition-colors text-left">
                      {item.severity === 'critical'
                        ? <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                        : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-slate-200">{item.title}</span>
                        <span className="text-xs text-slate-500 ml-2">{item.detail}</span>
                      </div>
                      {item.steps
                        ? (isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-600 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />)
                        : <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />}
                    </button>
                    {/* Ask AI button: always visible (opacity-0 until hover hid it
                        from keyboard and touch users). */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        askAgent(`Diagnose: ${item.title}. ${item.detail}`);
                      }}
                      aria-label={`Ask AI to diagnose ${item.title}`}
                      className={cn(
                        'absolute right-12 top-2.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-opacity',
                        AI_ACCENT.bg, AI_ACCENT.text, AI_ACCENT.border, 'border',
                      )}
                      title="Ask Pulse Agent to diagnose"
                    >
                      <AIIconStatic size={10} /> Ask AI
                    </button>
                    {isExpanded && item.steps && (
                      <div className="px-4 pb-3 pl-11">
                        <ol className="space-y-1 mb-2">
                          {item.steps.map((step, si) => (
                            <li key={si} className="flex items-start gap-2 text-xs text-slate-400">
                              <span className="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{si + 1}</span>
                              {step}
                            </li>
                          ))}
                        </ol>
                        <button onClick={() => go(item.path, item.pathTitle)}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          Investigate <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {pendingPods.length > 0 && (
          <Card className="px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-medium text-slate-200">{pendingPods.length} Pending Pod{pendingPods.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-1">
              {pendingPods.slice(0, 3).map((p) => (
                <button key={p.metadata.uid} onClick={() => go(`/r/v1~pods/${p.metadata.namespace}/${p.metadata.name}`, p.metadata.name)}
                  className="w-full flex items-center justify-between text-xs text-left hover:bg-slate-800/50 px-2 py-1 rounded-sm transition-colors">
                  <span className="text-slate-300">{p.metadata.name}</span>
                  <span className="text-slate-500">{p.metadata.namespace}</span>
                </button>
              ))}
              {pendingPods.length > 3 && <div className="text-xs text-slate-500 px-2">+{pendingPods.length - 3} more</div>}
            </div>
          </Card>
        )}

        {topRestartingPods.length > 0 && (
          <Card className="px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-medium text-slate-200">Top Restarting Pods</span>
            </div>
            <div className="space-y-1">
              {topRestartingPods.map(({ pod, restarts }) => (
                <button key={pod.metadata.uid} onClick={() => go(`/r/v1~pods/${pod.metadata.namespace}/${pod.metadata.name}`, pod.metadata.name)}
                  className="w-full flex items-center justify-between text-xs text-left hover:bg-slate-800/50 px-2 py-1 rounded-sm transition-colors">
                  <span className="text-slate-300">{pod.metadata.name}</span>
                  <span className="text-amber-400 font-mono">{restarts} restarts</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* All clear in Zone 3 */}
        {unavailable.length > 0 && (
          <div role="status" className="w-full bg-slate-900 rounded-lg border border-amber-900/50 p-4 text-center">
            <div className="text-sm font-medium text-amber-300">Couldn't check {unavailable.join(', ')}</div>
            <div className="text-xs text-slate-400 mt-0.5">Those lists failed to load, so problems there would not show up here. Check your permissions or the cluster connection.</div>
          </div>
        )}
        {/* No all-clear while alerts could not be read: zero is then unknown. */}
        {/* Also silent while the posture bar above counts open findings or
            alerts: one page, one verdict. Not a link — there is nothing to open. */}
        {unavailable.length === 0 && !alertsError && !postureIssues && attentionItems.length === 0 && pendingPods.length === 0 && topRestartingPods.length === 0 && (
          <div role="status" className="w-full bg-slate-900 rounded-lg border border-green-900/30 p-4 text-center">
            <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-1" />
            <div className="text-sm font-medium text-slate-200">All clear</div>
            <div className="text-xs text-slate-500 mt-0.5">{nodes.length} nodes, {operators.length} operators, {userPods.length} user pods — no issues detected</div>
          </div>
        )}
      </div>

      {/* ═══════ ZONE 4: Roadmap ═══════ */}
      <div className="space-y-3">
        <ZoneHeader number={4} title="Roadmap" subtitle="What to work on next" icon={<Calendar className="w-4 h-4 text-blue-400" />} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Cluster update */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpCircle className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-medium text-slate-200">Cluster Updates</span>
            </div>
            {updateAvailable ? (
              <div>
                <div className="text-xs text-slate-400 mb-1">Current: <span className="text-slate-300 font-mono">{updateAvailable.current}</span></div>
                <div className="text-xs text-blue-400 mb-2">Available: <span className="font-mono">{updateAvailable.available}</span>{updateAvailable.count > 1 && ` (+${updateAvailable.count - 1} more)`}</div>
                <button onClick={() => go('/admin?tab=updates', 'Updates')}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  View updates <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ) : clusterVersion?.status?.conditions?.some((c) => c.type === 'RetrievedUpdates' && c.status === 'False') ? (
              <button onClick={() => go('/admin?tab=updates', 'Updates')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                Unknown — the cluster could not retrieve available updates
              </button>
            ) : clusterVersionError || (!clusterVersionPending && !clusterVersion) ? (
              // A failed or missing ClusterVersion is not "up to date".
              <button onClick={() => go('/admin?tab=updates', 'Updates')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                Unknown — ClusterVersion could not be read
              </button>
            ) : clusterVersionPending ? (
              <span className="text-xs text-slate-500">Checking…</span>
            ) : (
              <button onClick={() => go('/admin?tab=updates', 'Updates')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Up to date</button>
            )}
          </Card>

          {/* Recent changes */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-medium text-slate-200">Rollouts &amp; config changes (1h)</span>
              {recentEvents.length > RECENT_CHANGES_SHOWN && (
                <button onClick={() => go('/timeline', 'Timeline')} className="text-xs text-blue-400 hover:text-blue-300 ml-auto">
                  {recentEvents.length - RECENT_CHANGES_SHOWN} more on Timeline
                </button>
              )}
            </div>
            {recentChanges.length > 0 ? (
              <div className="space-y-1">
                {recentChanges.map((ev, i) => (
                  <button key={i} onClick={() => go(ev.path, ev.name)}
                    className="w-full flex items-center gap-2 text-xs text-left hover:bg-slate-800/50 px-2 py-1.5 rounded-sm transition-colors group">
                    <span className="text-slate-500 w-10 shrink-0 text-right font-mono">{ev.ago}</span>
                    <span className={cn('px-1 py-0.5 rounded-sm text-xs font-medium shrink-0',
                      ev.reason === 'Unhealthy' || ev.reason === 'BackOff' ? 'bg-red-900/40 text-red-300' :
                      ev.reason === 'Pulled' || ev.reason === 'Created' || ev.reason === 'Started' || ev.reason === 'Scheduled' || ev.reason === 'Killing' ? 'bg-green-900/40 text-green-300' :
                      'bg-slate-800 text-slate-400'
                    )}>{ev.reason}</span>
                    <span className="text-slate-300 truncate">{ev.name}</span>
                    {ev.source && <span className="text-slate-600 shrink-0 ml-auto">{ev.source}</span>}
                    <ChevronRight className="w-3 h-3 text-slate-700 group-hover:text-slate-500 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">No rollouts or config changes in the last hour</div>
            )}
          </Card>
        </div>

        {/* Quick links */}
        <div className="flex items-center gap-3">
          <button onClick={() => go('/security', 'Security')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-sm transition-colors flex items-center gap-1.5">
            <Shield className="w-3 h-3" /> Security
          </button>
          <button onClick={() => go('/readiness', 'Readiness')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-sm transition-colors flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Readiness
          </button>
          <button onClick={() => go('/admin?tab=certificates', 'Certificates')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-sm transition-colors flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> Certificates
          </button>
          <button onClick={() => go('/alerts', 'Alerts')} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-sm transition-colors flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Alerts
          </button>
        </div>

        {/* Ask the Agent — smart prompts */}
        <Card className={cn('p-4 border', AI_ACCENT.border)}>
          <div className="flex items-center gap-2 mb-3">
            <AIIconStatic size={14} />
            <span className={cn('text-xs font-medium', AI_ACCENT.text)}>Ask the Agent</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {generateSmartPrompts({
              failedPods: failedPods.map(p => {
                const reason = p.status?.containerStatuses?.find((cs) => cs.state?.waiting)?.state?.waiting?.reason || p.status?.phase || 'Failed';
                return { name: p.metadata.name, namespace: p.metadata.namespace || '', status: reason };
              }),
              degradedOperators: degradedOperators.map(o => ({ name: o.metadata.name })),
              currentView: '/pulse',
            }).slice(0, 4).map((sp, i) => (
              <PromptPill key={i} onClick={() => askAgent(sp.text)}>
                {sp.text}
              </PromptPill>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
