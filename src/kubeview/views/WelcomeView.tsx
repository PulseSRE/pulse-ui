import React, { useState } from 'react';
import {
  ArrowRight, Shield, Bell, Settings,
  HardDrive, Package, Globe, Server, Puzzle, Users, Hammer,
  CheckCircle, XCircle, GitBranch, ChevronDown,
  Github, HeartPulse, Search, AlertCircle, RefreshCw,
  History, Rocket, AlertTriangle, GitPullRequest,
  Monitor, Sparkles, Brain, Store, FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBriefing, fetchMemoryStats, type BriefingResponse, type MemoryStats } from '../engine/fixHistory';
import { useCustomViewStore } from '../store/customViewStore';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { usePrefetchOnHover } from '../hooks/usePrefetchOnHover';
import { useMonitorStore } from '../store/monitorStore';
import { useIncidentFeed } from '../hooks/useIncidentFeed';
import { isFeatureEnabled } from '../engine/featureFlags';
import type { K8sResource } from '../engine/renderers';
import type { Node, Condition } from '../engine/types';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');
const MOD_KEY = isMac ? '\u2318' : 'Ctrl+';

export default function WelcomeView() {
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const connectionStatus = useUIStore((s) => s.connectionStatus);
  const go = useNavigateTab();
  const queryClient = useQueryClient();

  const { data: nodes = [], isLoading: nodesLoading, isError: nodesError } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const typedNodes = nodes as K8sResource[];
  const isConnected = connectionStatus === 'connected';

  const readyCount = React.useMemo(() =>
    typedNodes.filter(n => {
      const conditions = ((n as unknown as Node).status?.conditions || []) as Condition[];
      return conditions.some(c => c.type === 'Ready' && c.status === 'True');
    }).length,
  [typedNodes]);

  const { data: firingAlerts = [] } = useQuery<Array<{ labels: Record<string, string>; state: string }>>({
    queryKey: ['welcome', 'firing-alerts'],
    queryFn: async () => {
      const res = await fetch('/api/prometheus/api/v1/alerts');
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data?.alerts || []).filter((a: { state: string }) => a.state === 'firing');
    },
    refetchInterval: 30000,
  });
  const alertCount = firingAlerts.length;
  const pendingActions = useMonitorStore((s) => s.pendingActions.length);

  const customViews = useCustomViewStore((s) => s.views);

  const { data: memoryStats } = useQuery<MemoryStats>({
    queryKey: ['memory-stats'],
    queryFn: fetchMemoryStats,
    staleTime: 30_000,
    retry: false,
  });

  const { data: briefing, isLoading: briefingLoading, isError: briefingError } = useQuery<BriefingResponse>({
    queryKey: ['briefing'],
    queryFn: () => fetchBriefing(12),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Hero: compact with inline status ── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 px-8 py-8">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.08)_0%,transparent_60%)]" />
          <div className="relative flex items-center gap-6">
            <svg className="w-14 h-14 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
              <defs>
                <linearGradient id="welcome-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2563eb"/><stop offset="100%" stopColor="#7c3aed"/></linearGradient>
                <linearGradient id="welcome-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#60a5fa"/><stop offset="50%" stopColor="#ffffff"/><stop offset="100%" stopColor="#a78bfa"/></linearGradient>
              </defs>
              <rect width="32" height="32" rx="7" fill="url(#welcome-bg)"/>
              <polyline points="4,16.5 9,16.5 11,16.5 13,12 15,21 17,7 19,25 21,13 23,16.5 25,16.5 28,16.5" fill="none" stroke="url(#welcome-line)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight">
                <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent">OpenShift Pulse</span>
              </h1>
              <p className="text-sm text-slate-400 mt-1">Your cluster at a glance — incidents, remediation, and production readiness.</p>
            </div>
            <ClusterStatusPill
              isConnected={isConnected}
              connectionStatus={connectionStatus}
              nodeCount={typedNodes.length}
              readyCount={readyCount}
              isLoading={nodesLoading}
              isError={nodesError}
              onRetry={() => queryClient.invalidateQueries({ queryKey: ['k8s'] })}
            />
          </div>
        </div>

        {/* ── Quick Stats Row ── */}
        <div className="grid grid-cols-4 gap-3">
          <QuickStat
            label="Nodes"
            value={`${readyCount}/${typedNodes.length}`}
            valueClass={readyCount === typedNodes.length ? 'text-emerald-400' : 'text-amber-400'}
            onClick={() => go('/compute', 'Compute')}
          />
          <QuickStat
            label="Alerts"
            value={alertCount}
            valueClass={alertCount > 0 ? 'text-red-400' : 'text-emerald-400'}
            onClick={() => go('/incidents', 'Incidents')}
          />
          <QuickStat
            label="Pending Reviews"
            value={pendingActions}
            valueClass={pendingActions > 0 ? 'text-amber-400' : 'text-slate-400'}
            onClick={() => go('/reviews', 'Reviews')}
          />
          <QuickStat
            label="Cluster"
            value={isConnected ? 'Healthy' : 'Down'}
            valueClass={isConnected ? 'text-emerald-400' : 'text-red-400'}
            onClick={() => go('/admin', 'Administration')}
          />
        </div>

        {/* ── AI Briefing ── */}
        <BriefingCard
          briefing={briefing}
          isLoading={briefingLoading}
          isError={briefingError}
          onRetry={() => queryClient.invalidateQueries({ queryKey: ['briefing'] })}
          onNavigate={go}
        />

        {/* ── Alerts Banner ── */}
        {alertCount > 0 && (
          <button
            onClick={() => go('/incidents', 'Incidents')}
            className="group w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-red-500/20 bg-red-950/20 hover:border-red-500/40 transition-all text-left"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-sm font-medium text-red-300">{alertCount} alert{alertCount !== 1 ? 's' : ''} firing</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-red-400 transition-colors ml-auto" />
          </button>
        )}

        {/* ── Primary Navigation: 2 rows of 4 ── */}
        <div className="grid grid-cols-4 gap-2">
          <NavCard icon={<HeartPulse className="w-5 h-5" />} color="text-blue-400" border="border-blue-500/20" title="Pulse" sub="Health briefing" onClick={() => go('/pulse', 'Pulse')} path="/pulse" />
          <NavCard icon={<Bell className="w-5 h-5" />} color="text-red-400" border="border-red-500/20" title="Incidents" sub="Triage & auto-fix" onClick={() => go('/incidents', 'Incidents')} />
          <NavCard icon={<GitPullRequest className="w-5 h-5" />} color="text-violet-400" border="border-violet-500/20" title="Reviews" sub="Approve changes" onClick={() => go('/reviews', 'Reviews')} />
          <NavCard icon={<Package className="w-5 h-5" />} color="text-blue-400" border="border-blue-500/20" title="Workloads" sub="Deployments & pods" onClick={() => go('/workloads', 'Workloads')} path="/workloads" />
          <NavCard icon={<Server className="w-5 h-5" />} color="text-blue-400" border="border-slate-800" title="Compute" sub="Nodes & capacity" onClick={() => go('/compute', 'Compute')} path="/compute" />
          <NavCard icon={<Globe className="w-5 h-5" />} color="text-cyan-400" border="border-slate-800" title="Networking" sub="Routes & policies" onClick={() => go('/networking', 'Networking')} path="/networking" />
          <NavCard icon={<HardDrive className="w-5 h-5" />} color="text-orange-400" border="border-slate-800" title="Storage" sub="PVCs & volumes" onClick={() => go('/storage', 'Storage')} path="/storage" />
          <NavCard icon={<Shield className="w-5 h-5" />} color="text-emerald-400" border="border-emerald-500/20" title="Readiness" sub="30 production gates" onClick={() => go('/readiness', 'Production Readiness')} />
        </div>

        {/* ── More Views (collapsible) ── */}
        <MoreViews go={go} memoryStats={memoryStats} customViews={customViews} />

        {/* ── Agent Preferences (collapsed) ── */}
        <a
          href="/agent"
          className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-medium text-slate-400">Agent Settings</span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-600 -rotate-90" />
        </a>

        {/* ── Footer ── */}
        <footer className="flex items-center justify-center gap-4 text-xs text-slate-600 pb-4">
          <div className="flex items-center gap-2">
            <ShortcutKey keys={`${MOD_KEY}K`} /> <span>Search</span>
          </div>
          <span>·</span>
          <div className="flex items-center gap-2">
            <ShortcutKey keys={`${MOD_KEY}B`} /> <span>Browse</span>
          </div>
          <span>·</span>
          <a href="https://github.com/alimobrem/OpenshiftPulse" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">
            <Github className="w-3 h-3 inline" /> v{__APP_VERSION__}
          </a>
        </footer>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function QuickStat({ label, value, valueClass, onClick }: {
  label: string; value: string | number; valueClass?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-3 text-center hover:bg-slate-800/60 hover:border-slate-700 transition-colors"
    >
      <div className={cn('text-xl font-bold', valueClass)}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </button>
  );
}

function BriefingCard({ briefing, isLoading, isError, onRetry, onNavigate }: {
  briefing?: BriefingResponse; isLoading: boolean; isError: boolean;
  onRetry: () => void; onNavigate: (path: string, title: string) => void;
}) {
  const { counts: incidentCounts } = useIncidentFeed({ limit: 0 });
  const findingsCount = useMonitorStore((s) => s.findings.length);
  if (isLoading) {
    return (
      <div className="rounded-lg border border-violet-500/20 bg-slate-900 p-4 animate-pulse">
        <div className="h-5 w-40 bg-slate-700 rounded mb-3" />
        <div className="h-4 w-full bg-slate-700 rounded mb-2" />
        <div className="h-4 w-2/3 bg-slate-700 rounded" />
      </div>
    );
  }
  if (isError || !briefing) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2 text-slate-500">
          <Sparkles className="w-4 h-4" />
          <span className="text-sm">Agent briefing unavailable</span>
          <button onClick={onRetry} className="ml-auto text-blue-400 hover:text-blue-300"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-violet-500/20 bg-slate-900 p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -inset-px rounded-lg bg-violet-500/5" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-slate-100">{briefing.greeting}</h2>
          <span className="ml-auto text-[11px] text-slate-600">last {briefing.hours}h</span>
        </div>
        <p className="text-sm text-slate-400 mb-3">{briefing.summary}</p>
        {(briefing.actions.completed > 0 || briefing.investigations > 0) && (
          <div className="flex gap-4 text-xs">
            {briefing.actions.completed > 0 && (
              <button onClick={() => onNavigate('/incidents', 'Incidents')} className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
                <CheckCircle className="w-3.5 h-3.5" /> {briefing.actions.completed} fixed
              </button>
            )}
            {briefing.actions.failed > 0 && (
              <button onClick={() => onNavigate('/incidents', 'Incidents')} className="flex items-center gap-1 text-red-400 hover:text-red-300">
                <XCircle className="w-3.5 h-3.5" /> {briefing.actions.failed} failed
              </button>
            )}
            {briefing.investigations > 0 && (
              <button onClick={() => onNavigate('/incidents', 'Incidents')} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                <Search className="w-3.5 h-3.5" /> {briefing.investigations} investigated
              </button>
            )}
          </div>
        )}
        {(incidentCounts.total > 0 || findingsCount > 0) && (
          <button
            onClick={() => onNavigate('/incidents', 'Incidents')}
            className="mt-3 flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Right now:{' '}
              {incidentCounts.total > 0 && (
                <span className={incidentCounts.critical > 0 ? 'text-red-400' : 'text-amber-400'}>
                  {incidentCounts.total} active incident{incidentCounts.total !== 1 ? 's' : ''}
                  {incidentCounts.critical > 0 && ` (${incidentCounts.critical} critical)`}
                </span>
              )}
              {incidentCounts.total > 0 && findingsCount > 0 && ', '}
              {findingsCount > 0 && (
                <span className="text-violet-400">{findingsCount} finding{findingsCount !== 1 ? 's' : ''}</span>
              )}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function NavCard({ icon, color, border, title, sub, onClick, path }: {
  icon: React.ReactNode; color: string; border: string; title: string; sub: string; onClick: () => void; path?: string;
}) {
  const prefetch = usePrefetchOnHover(path || '');
  const hoverProps = path ? { onMouseEnter: prefetch.onMouseEnter, onFocus: prefetch.onFocus, onMouseLeave: prefetch.onMouseLeave } : {};
  return (
    <button
      onClick={onClick}
      {...hoverProps}
      className={cn('group flex flex-col items-center gap-1.5 rounded-lg border bg-slate-900/50 px-3 py-4 hover:bg-slate-800/70 transition-all text-center', border)}
    >
      <span className={color}>{icon}</span>
      <span className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{title}</span>
      <span className="text-[11px] text-slate-500">{sub}</span>
    </button>
  );
}

function MoreViews({ go, memoryStats, customViews }: {
  go: (path: string, title: string) => void; memoryStats?: MemoryStats; customViews: Array<{ id: string; title: string }>;
}) {
  const [open, setOpen] = useState(false);

  const secondaryViews = [
    { icon: <Globe className="w-4 h-4 text-blue-400" />, title: 'Fleet', onClick: () => go('/fleet', 'Fleet') },
    { icon: <Bell className="w-4 h-4 text-amber-400" />, title: 'Alerts', onClick: () => go('/alerts', 'Alerts') },
    { icon: <Users className="w-4 h-4 text-teal-400" />, title: 'Identity', onClick: () => go('/identity', 'Identity') },
    { icon: <Shield className="w-4 h-4 text-indigo-400" />, title: 'Security', onClick: () => go('/security', 'Security') },
    { icon: <GitBranch className="w-4 h-4 text-violet-400" />, title: 'GitOps', onClick: () => go('/gitops', 'GitOps') },
    { icon: <Settings className="w-4 h-4 text-slate-400" />, title: 'Admin', onClick: () => go('/admin', 'Administration') },
    { icon: <Hammer className="w-4 h-4 text-amber-500" />, title: 'Builds', onClick: () => go('/workloads?tab=builds', 'Workloads') },
    { icon: <Puzzle className="w-4 h-4 text-violet-400" />, title: 'CRDs', onClick: () => go('/admin?tab=crds', 'Administration') },
    { icon: <Package className="w-4 h-4 text-blue-400" />, title: 'Create', onClick: () => go('/create', 'Create Resources') },
    { icon: <History className="w-4 h-4 text-violet-400" />, title: 'Memory', onClick: () => go('/memory', "What I've Learned") },
  ];

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <div className="h-px flex-1 bg-slate-800" />
        <span className="font-semibold uppercase tracking-widest">{open ? 'Fewer views' : 'More views'}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        <div className="h-px flex-1 bg-slate-800" />
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {secondaryViews.map((v) => (
            <button
              key={v.title}
              onClick={v.onClick}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800/60 bg-slate-900/50 hover:bg-slate-800/60 hover:border-slate-700 transition-all text-left text-sm text-slate-300 hover:text-slate-100"
            >
              {v.icon}
              {v.title}
            </button>
          ))}
          {customViews.map((v) => (
            <button
              key={v.id}
              onClick={() => go(`/custom/${v.id}`, v.title)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800/60 bg-slate-900/50 hover:bg-slate-800/60 hover:border-slate-700 transition-all text-left text-sm text-slate-300 hover:text-slate-100"
            >
              <Monitor className="w-4 h-4 text-violet-400" />
              {v.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterStatusPill({ isConnected, connectionStatus, nodeCount, readyCount, isLoading, isError, onRetry }: {
  isConnected: boolean; connectionStatus: string; nodeCount: number; readyCount: number; isLoading: boolean; isError?: boolean; onRetry?: () => void;
}) {
  if (isError && !isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-950/30 border border-red-900/40 text-xs text-red-400">
          <AlertCircle className="w-3 h-3" /> API unreachable
        </span>
        {onRetry && (
          <button onClick={onRetry} className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" /> Connecting...
      </span>
    );
  }
  if (!isConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-950/30 border border-red-900/40 text-xs text-red-400">
        <XCircle className="w-3 h-3" /> {connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/30 border border-emerald-900/40 text-xs text-emerald-400">
      <CheckCircle className="w-3 h-3" /> {readyCount}/{nodeCount} nodes ready
    </span>
  );
}

function ShortcutKey({ keys }: { keys: string }) {
  return <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono text-slate-400 border border-slate-700/60">{keys}</kbd>;
}
