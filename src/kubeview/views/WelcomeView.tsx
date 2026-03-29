import React, { useState } from 'react';
import {
  ArrowRight, Shield, Bell, Settings,
  HardDrive, Package, Globe, Server, Puzzle, Users, Hammer,
  CheckCircle, XCircle, GitBranch, Clock, ChevronDown,
  Github, HeartPulse, Search, AlertCircle, RefreshCw,
  FileCode, History, GitGraph, ScrollText, Camera,
  Diff, Monitor, Terminal, Rocket, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBriefing, fetchMemoryStats, type BriefingResponse, type MemoryStats } from '../engine/fixHistory';
import { useUIStore } from '../store/uiStore';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { usePrefetchOnHover } from '../hooks/usePrefetchOnHover';
import { isFeatureEnabled } from '../engine/featureFlags';
import type { K8sResource } from '../engine/renderers';
import type { Node, Condition } from '../engine/types';

/** Detect platform for keyboard shortcut display */
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');
const MOD_KEY = isMac ? '\u2318' : 'Ctrl+';

export default function WelcomeView() {
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const connectionStatus = useUIStore((s) => s.connectionStatus);
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const launchpad = isFeatureEnabled('welcomeLaunchpad');

  const { data: nodes = [], isLoading: nodesLoading, isError: nodesError } = useK8sListWatch({ apiPath: '/api/v1/nodes' });

  const typedNodes = nodes as K8sResource[];
  const isConnected = connectionStatus === 'connected';

  // Compute ready node count (#4)
  const readyCount = React.useMemo(() =>
    typedNodes.filter(n => {
      const conditions = ((n as unknown as Node).status?.conditions || []) as Condition[];
      return conditions.some(c => c.type === 'Ready' && c.status === 'True');
    }).length,
  [typedNodes]);

  const [showAllCapabilities, setShowAllCapabilities] = useState(true);
  const [allViewsOpen, setAllViewsOpen] = useState(!launchpad);

  // Launchpad: top issues count from firing alerts
  const { data: firingAlerts = [] } = useQuery<Array<{ labels: Record<string, string>; state: string }>>({
    queryKey: ['welcome', 'firing-alerts'],
    queryFn: async () => {
      const res = await fetch('/api/prometheus/api/v1/alerts');
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data?.alerts || []).filter((a: { state: string }) => a.state === 'firing');
    },
    refetchInterval: 30000,
    enabled: launchpad,
  });
  const topIssuesCount = firingAlerts.length;

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
    retry: 1,
  });

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* ── Hero ── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 px-8 py-12 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.08)_0%,transparent_60%)]" />
          <div className="relative">
            {/* Logo (#10) */}
            <svg className="w-12 h-12 mx-auto mb-4" viewBox="0 0 32 32" aria-hidden="true">
              <defs>
                <linearGradient id="welcome-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2563eb"/><stop offset="100%" stopColor="#7c3aed"/></linearGradient>
                <linearGradient id="welcome-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#60a5fa"/><stop offset="50%" stopColor="#ffffff"/><stop offset="100%" stopColor="#a78bfa"/></linearGradient>
              </defs>
              <rect width="32" height="32" rx="7" fill="url(#welcome-bg)"/>
              <polyline points="4,16.5 9,16.5 11,16.5 13,12 15,21 17,7 19,25 21,13 23,16.5 25,16.5 28,16.5" fill="none" stroke="url(#welcome-line)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="17" cy="7" r="1.2" fill="white" opacity="0.5"/>
            </svg>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mb-3">
              <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent">OpenShift Pulse</span>
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto leading-relaxed">
              Your cluster at a glance. Incidents, remediation, and production readiness — all in one place.
            </p>
            <div className="mt-5">
              <ClusterStatusPill
                isConnected={isConnected}
                connectionStatus={connectionStatus}
                nodeCount={typedNodes.length}
                readyCount={readyCount}
                isLoading={nodesLoading}
                isError={nodesError}
                onRetry={() => queryClient.invalidateQueries({ queryKey: ['k8s'] })}
                onGoAdmin={() => go('/admin', 'Administration')}
              />
            </div>
          </div>
        </div>

        {/* ── Briefing Card ── */}
        {briefingLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-4 animate-pulse">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-5 h-5 rounded bg-slate-700" />
              <div className="h-5 w-32 rounded bg-slate-700" />
            </div>
            <div className="h-4 w-64 rounded bg-slate-700" />
          </div>
        )}
        {briefingError && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-4">
            <div className="flex items-center gap-3">
              <HeartPulse className="w-5 h-5 text-slate-500" />
              <span className="text-sm text-slate-500">Unable to load briefing</span>
              <button onClick={() => queryClient.invalidateQueries({ queryKey: ['briefing'] })} className="text-xs text-blue-400 hover:text-blue-300">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {briefing && !briefingLoading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-4">
            <div className="flex items-center gap-3 mb-2">
              <HeartPulse className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-slate-100">{briefing.greeting}</h2>
            </div>
            <p className="text-sm text-slate-400 mb-3">{briefing.summary}</p>
            {(briefing.actions.completed > 0 || briefing.investigations > 0) && (
              <div className="flex gap-4 text-xs">
                {briefing.actions.completed > 0 && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {briefing.actions.completed} fixed
                  </span>
                )}
                {briefing.actions.failed > 0 && (
                  <span className="flex items-center gap-1 text-red-400">
                    <XCircle className="w-3.5 h-3.5" />
                    {briefing.actions.failed} failed
                  </span>
                )}
                {briefing.investigations > 0 && (
                  <span className="flex items-center gap-1 text-blue-400">
                    <Search className="w-3.5 h-3.5" />
                    {briefing.investigations} investigated
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Memory: What I've Learned ── */}
        {memoryStats && memoryStats.enabled && (memoryStats.incidents > 0 || memoryStats.runbooks > 0) && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-4">
            <div className="flex items-center gap-3 mb-2">
              <History className="w-5 h-5 text-violet-400" />
              <h2 className="text-lg font-semibold text-slate-100">What I've Learned</h2>
            </div>
            <div className="flex gap-6 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-100">{memoryStats.incidents}</div>
                <div className="text-xs text-slate-500">incidents</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-violet-400">{memoryStats.runbooks}</div>
                <div className="text-xs text-slate-500">runbooks learned</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">{memoryStats.patterns}</div>
                <div className="text-xs text-slate-500">patterns detected</div>
              </div>
            </div>
            {memoryStats.runbooks > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                The agent uses these to diagnose similar issues faster. Give thumbs up on helpful responses to teach it more.
              </p>
            )}
          </div>
        )}

        {/* ── Launchpad: Cluster State Summary ── */}
        {launchpad && (
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => go('/compute', 'Compute')}
              className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center hover:bg-slate-800/60 hover:border-slate-700 transition-colors"
            >
              <div className={cn('text-lg font-bold', readyCount === typedNodes.length ? 'text-emerald-400' : 'text-amber-400')}>
                {readyCount}/{typedNodes.length}
              </div>
              <div className="text-xs text-slate-500">Nodes ready</div>
            </button>
            <button
              onClick={() => go('/alerts', 'Alerts')}
              className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center hover:bg-slate-800/60 hover:border-slate-700 transition-colors"
            >
              <div className={cn('text-lg font-bold', topIssuesCount > 0 ? 'text-red-400' : 'text-emerald-400')}>
                {topIssuesCount}
              </div>
              <div className="text-xs text-slate-500">Alerts firing</div>
            </button>
            <button
              onClick={() => go('/admin', 'Administration')}
              className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center hover:bg-slate-800/60 hover:border-slate-700 transition-colors"
            >
              <div className={cn('text-lg font-bold', isConnected ? 'text-emerald-400' : 'text-red-400')}>
                {isConnected ? 'Up' : 'Down'}
              </div>
              <div className="text-xs text-slate-500">Cluster</div>
            </button>
          </div>
        )}

        {/* ── Launchpad: Onboarding CTA ── */}
        {launchpad && isFeatureEnabled('onboarding') && (
          <button
            onClick={() => go('/onboarding', 'Onboarding')}
            className="group relative w-full flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-br from-violet-500/20 to-violet-600/5 border-violet-500/20 hover:border-violet-500/40 transition-all text-left"
          >
            <span className="text-violet-400" aria-hidden="true"><Rocket className="w-5 h-5" /></span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-100">Production Setup</div>
              <div className="text-xs text-slate-400 mt-0.5">Run the readiness wizard — verify connectivity, security, alerting, and GitOps</div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-700 group-hover:text-violet-400 transition-colors" aria-hidden="true" />
          </button>
        )}

        {/* ── Launchpad: Top Issues ── */}
        {launchpad && topIssuesCount > 0 && (
          <button
            onClick={() => go('/alerts', 'Alerts')}
            className="group relative w-full flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20 hover:border-red-500/40 transition-all text-left"
          >
            <span className="text-red-400" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-300">{topIssuesCount} alert{topIssuesCount !== 1 ? 's' : ''} firing</div>
              <div className="text-xs text-slate-400 mt-0.5">View and triage active incidents</div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-700 group-hover:text-red-400 transition-colors" aria-hidden="true" />
          </button>
        )}

        {/* ── Primary Actions ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ActionCard
            icon={<HeartPulse className="w-5 h-5" />}
            accentClass="from-blue-500/20 to-blue-600/5 border-blue-500/20"
            iconColor="text-blue-400"
            title="Cluster Pulse"
            description="Risk score, attention items, and daily health briefing"
            onClick={() => go('/pulse', 'Pulse')}
            path="/pulse"
          />
          <ActionCard
            icon={<Bell className="w-5 h-5" />}
            accentClass="from-red-500/20 to-red-600/5 border-red-500/20"
            iconColor="text-red-400"
            title="Incident Center"
            description="Unified triage — findings, alerts, errors, and automated remediation"
            onClick={() => go('/incidents', 'Incidents')}
          />
          <ActionCard
            icon={<Shield className="w-5 h-5" />}
            accentClass="from-emerald-500/20 to-emerald-600/5 border-emerald-500/20"
            iconColor="text-emerald-400"
            title="Production Readiness"
            description="30 gates across security, reliability, observability — wizard and continuous checks"
            onClick={() => go('/onboarding', 'Onboarding')}
          />
        </div>

        {/* ── All Views ── */}
        <section aria-labelledby="all-views-heading">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-800" />
            <h2 id="all-views-heading" className="text-xs font-semibold text-slate-500 uppercase tracking-widest">All Views</h2>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <ViewTile icon={<HeartPulse className="w-4 h-4 text-blue-400" />} title="Pulse"       onClick={() => go('/pulse', 'Pulse')} path="/pulse" />
            <ViewTile icon={<Bell className="w-4 h-4 text-red-400" />}        title="Incidents"    onClick={() => go('/incidents', 'Incidents')} />
            <ViewTile icon={<Package className="w-4 h-4 text-blue-400" />}    title="Workloads"    onClick={() => go('/workloads', 'Workloads')} path="/workloads" />
            <ViewTile icon={<Server className="w-4 h-4 text-blue-400" />}     title="Compute"      onClick={() => go('/compute', 'Compute')} path="/compute" />
            <ViewTile icon={<Globe className="w-4 h-4 text-cyan-400" />}      title="Networking"   onClick={() => go('/networking', 'Networking')} path="/networking" />
            <ViewTile icon={<HardDrive className="w-4 h-4 text-orange-400" />} title="Storage"     onClick={() => go('/storage', 'Storage')} path="/storage" />
            <ViewTile icon={<Globe className="w-4 h-4 text-blue-400" />}      title="Fleet"        onClick={() => go('/fleet', 'Fleet')} />
            <ViewTile icon={<Bell className="w-4 h-4 text-amber-400" />}      title="Alerts"       onClick={() => go('/alerts', 'Alerts')} />
            <ViewTile icon={<Users className="w-4 h-4 text-teal-400" />}      title="Identity"     onClick={() => go('/identity', 'Identity')} />
            <ViewTile icon={<Shield className="w-4 h-4 text-indigo-400" />}   title="Security"     onClick={() => go('/security', 'Security')} path="/security" />
            <ViewTile icon={<GitBranch className="w-4 h-4 text-violet-400" />} title="GitOps"      onClick={() => go('/gitops', 'GitOps')} />
            <ViewTile icon={<Settings className="w-4 h-4 text-slate-400" />}  title="Admin"        onClick={() => go('/admin', 'Administration')} />
            <ViewTile icon={<Rocket className="w-4 h-4 text-violet-400" />}   title="Onboarding"   onClick={() => go('/onboarding', 'Onboarding')} />
            <ViewTile icon={<Hammer className="w-4 h-4 text-amber-500" />}    title="Builds"       onClick={() => go('/builds', 'Builds')} path="/builds" />
            <ViewTile icon={<Puzzle className="w-4 h-4 text-violet-400" />}   title="CRDs"         onClick={() => go('/crds', 'CRDs')} />
          </div>
        </section>

        {/* ── Keyboard Shortcuts (#1 fix 11px, #12 platform-aware) ── */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ShortcutPill keys={`${MOD_KEY}K`} label="Command Palette" />
          <ShortcutPill keys={`${MOD_KEY}B`} label="Resource Browser" />
          <ShortcutPill keys="j / k" label="Navigate Table" />
        </div>

        {/* ── Footer (#10 fix hover) ── */}
        <footer className="flex items-center justify-center gap-3 text-sm text-slate-500 pb-6">
          <a
            href="https://github.com/alimobrem/OpenshiftPulse"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors"
            aria-label="View source on GitHub (opens in new tab)"
          >
            <Github className="w-3 h-3" aria-hidden="true" /> GitHub
          </a>
          <span>·</span>
          <span>v{__APP_VERSION__}</span>
        </footer>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ClusterStatusPill({ isConnected, connectionStatus, nodeCount, readyCount, isLoading, isError, onRetry, onGoAdmin }: {
  isConnected: boolean; connectionStatus: string; nodeCount: number; readyCount: number; isLoading: boolean; isError?: boolean;
  onRetry?: () => void; onGoAdmin?: () => void;
}) {
  // #8 error state
  if (isError && !isLoading) {
    return (
      <div className="flex flex-col items-center gap-2">
        <span role="status" aria-live="polite" className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-950/30 border border-red-900/40 text-xs text-red-400">
          <AlertCircle className="w-3 h-3" aria-hidden="true" />
          Unable to reach cluster API
        </span>
        <p className="text-xs text-slate-500">Make sure <code className="px-1 py-0.5 bg-slate-800 rounded text-slate-400">oc proxy --port=8001</code> is running</p>
        <div className="flex items-center gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          )}
          {onGoAdmin && (
            <button
              onClick={onGoAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors"
            >
              <Settings className="w-3 h-3" aria-hidden="true" />
              Administration
            </button>
          )}
        </div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <span role="status" aria-live="polite" className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
        Connecting...
      </span>
    );
  }
  if (!isConnected) {
    return (
      <span role="status" aria-live="polite" className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-950/30 border border-red-900/40 text-xs text-red-400">
        <XCircle className="w-3 h-3" aria-hidden="true" />
        {connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
      </span>
    );
  }
  // #4 show ready/total
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-950/30 border border-emerald-900/40 text-xs text-emerald-400">
      <CheckCircle className="w-3 h-3" aria-hidden="true" />
      Connected · {readyCount}/{nodeCount} node{nodeCount !== 1 ? 's' : ''} ready
    </span>
  );
}

function ActionCard({ icon, accentClass, iconColor, title, description, onClick, path }: {
  icon: React.ReactNode; accentClass: string; iconColor: string;
  title: string; description: string; onClick: () => void; path?: string;
}) {
  const prefetch = usePrefetchOnHover(path || '');
  const hoverProps = path ? { onMouseEnter: prefetch.onMouseEnter, onFocus: prefetch.onFocus, onMouseLeave: prefetch.onMouseLeave } : {};
  return (
    <button
      onClick={onClick}
      {...hoverProps}
      className={`group relative flex flex-col gap-3 p-5 rounded-xl border bg-gradient-to-br ${accentClass} hover:border-blue-500/30 transition-all text-left`}
    >
      <span className={iconColor} aria-hidden="true">{icon}</span>
      <div>
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <div className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</div>
      </div>
      <ArrowRight className="absolute top-5 right-5 w-4 h-4 text-slate-700 group-hover:text-blue-400 transition-colors" aria-hidden="true" />
    </button>
  );
}

function ViewTile({ icon, title, onClick, path }: {
  icon: React.ReactNode; title: string; onClick: () => void; path?: string;
}) {
  const prefetch = usePrefetchOnHover(path || '');
  const hoverProps = path ? { onMouseEnter: prefetch.onMouseEnter, onFocus: prefetch.onFocus, onMouseLeave: prefetch.onMouseLeave } : {};
  return (
    <button
      onClick={onClick}
      {...hoverProps}
      className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-slate-800/60 bg-slate-900/50 hover:bg-slate-800/60 hover:border-slate-700 transition-all text-left"
      aria-label={`Open ${title}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">{title}</span>
    </button>
  );
}

function CapabilityRow({ icon, title, description, iconColor = 'text-blue-400', onClick, path }: {
  icon: React.ReactNode; title: string; description: string; iconColor?: string; onClick?: () => void; path?: string;
}) {
  const prefetch = usePrefetchOnHover(path || '');
  const hoverProps = path ? { onMouseEnter: prefetch.onMouseEnter, onFocus: prefetch.onFocus, onMouseLeave: prefetch.onMouseLeave } : {};
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      {...hoverProps}
      className={cn(
        'flex items-start gap-3 px-4 py-3 w-full text-left',
        onClick && 'hover:bg-slate-800/30 transition-colors cursor-pointer'
      )}
    >
      <span className={`${iconColor} mt-0.5 shrink-0`} aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-200">{title}</span>
        <span className="text-xs text-slate-500 ml-2">{description}</span>
      </div>
      {onClick && <ArrowRight className="w-3 h-3 text-slate-700 shrink-0 mt-1" aria-hidden="true" />}
    </Wrapper>
  );
}

function ShortcutPill({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-800/60">
      <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-xs font-mono text-slate-300 border border-slate-700/60" aria-label={keys}>{keys}</kbd>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}
