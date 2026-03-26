import React, { useState } from 'react';
import {
  ArrowRight, Shield, Bell, Settings,
  HardDrive, Package, Globe, Server, Puzzle, Users, Hammer,
  CheckCircle, XCircle, GitBranch, Clock, ChevronDown,
  Github, HeartPulse, Search, AlertCircle, RefreshCw,
  FileCode, History, GitGraph, ScrollText, Camera,
  Diff, Monitor, Terminal, Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '../store/uiStore';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
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
              Welcome to <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent">OpenShift Pulse</span>
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto leading-relaxed">
              A single pane of glass for your OpenShift cluster — health audits, real-time diagnosis, and one-click remediation.
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

        {/* ── Cluster Pulse (primary CTA) ── */}
        <button
          onClick={() => go('/pulse', 'Pulse')}
          className="group relative w-full flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-br from-blue-500/20 to-blue-600/5 border-blue-500/20 hover:border-blue-500/40 transition-all text-left"
          aria-label="Open Cluster Pulse — risk score, attention items, and live issues"
        >
          <span className="text-blue-400" aria-hidden="true"><HeartPulse className="w-6 h-6" /></span>
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-100">Cluster Pulse</div>
            <div className="text-xs text-slate-400 mt-0.5">Risk score, attention items, and live issues</div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-700 group-hover:text-blue-400 transition-colors" aria-hidden="true" />
        </button>

        {/* ── Quick Nav Row ── */}
        <MetricGrid>
          <ViewTile icon={<Server className="w-4 h-4 text-blue-400" />}   title="Compute"        onClick={() => go('/compute', 'Compute')} />
          <ViewTile icon={<Package className="w-4 h-4 text-blue-400" />}  title="Workloads"      onClick={() => go('/workloads', 'Workloads')} />
          <ViewTile icon={<Settings className="w-4 h-4 text-slate-400" />} title="Administration" onClick={() => go('/admin', 'Administration')} />
          <ViewTile icon={<Bell className="w-4 h-4 text-red-400" />}      title="Alerts"         onClick={() => go('/alerts', 'Alerts')} />
        </MetricGrid>

        {/* ── Start Here ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionCard
            icon={<Shield className="w-5 h-5" />}
            accentClass="from-emerald-500/20 to-emerald-600/5 border-emerald-500/20"
            iconColor="text-emerald-400"
            title="Readiness Checklist"
            description="Production readiness checks across workloads, networking, storage, and compute"
            onClick={() => go('/admin?tab=readiness', 'Admin')}
          />
          <ActionCard
            icon={<Search className="w-5 h-5" />}
            accentClass="from-violet-500/20 to-violet-600/5 border-violet-500/20"
            iconColor="text-violet-400"
            title="Find Anything"
            description={`${MOD_KEY}K to search 500+ resource types, ${MOD_KEY}B to browse by API group`}
            onClick={openCommandPalette}
          />
        </div>

        {/* ── All Views (#5 — now includes all 15 navigable views) ── */}
        <section aria-labelledby="all-views-heading">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-800" />
            <h2 id="all-views-heading" className="text-xs font-semibold text-slate-500 uppercase tracking-widest">All Views</h2>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <ViewTile icon={<HeartPulse className="w-4 h-4 text-blue-400" />} title="Pulse"          onClick={() => go('/pulse', 'Pulse')} />
            <ViewTile icon={<Server className="w-4 h-4 text-blue-400" />}     title="Compute"        onClick={() => go('/compute', 'Compute')} />
            <ViewTile icon={<Package className="w-4 h-4 text-blue-400" />}    title="Workloads"      onClick={() => go('/workloads', 'Workloads')} />
            <ViewTile icon={<Globe className="w-4 h-4 text-cyan-400" />}      title="Networking"     onClick={() => go('/networking', 'Networking')} />
            <ViewTile icon={<HardDrive className="w-4 h-4 text-orange-400" />} title="Storage"       onClick={() => go('/storage', 'Storage')} />
            <ViewTile icon={<Bell className="w-4 h-4 text-red-400" />}        title="Alerts"         onClick={() => go('/alerts', 'Alerts')} />
            <ViewTile icon={<Hammer className="w-4 h-4 text-amber-500" />}    title="Builds"         onClick={() => go('/builds', 'Builds')} />
            <ViewTile icon={<Shield className="w-4 h-4 text-indigo-400" />}   title="Security"       onClick={() => go('/security', 'Security')} />
            <ViewTile icon={<Users className="w-4 h-4 text-teal-400" />}      title="User Management" onClick={() => go('/users', 'Users')} />
            <ViewTile icon={<Shield className="w-4 h-4 text-violet-400" />}   title="Access Control" onClick={() => go('/access-control', 'Access Control')} />
            <ViewTile icon={<Puzzle className="w-4 h-4 text-violet-400" />}   title="CRDs"           onClick={() => go('/crds', 'CRDs')} />
            <ViewTile icon={<GitBranch className="w-4 h-4 text-violet-400" />} title="GitOps"        onClick={() => go('/gitops', 'GitOps')} />
            <ViewTile icon={<Globe className="w-4 h-4 text-blue-400" />} title="Fleet"          onClick={() => go('/fleet', 'Fleet')} />
            <ViewTile icon={<Bot className="w-4 h-4 text-cyan-400" />} title="Agent"          onClick={() => go('/agent', 'Agent')} />
            <ViewTile icon={<Settings className="w-4 h-4 text-slate-400" />}  title="Administration" onClick={() => go('/admin', 'Administration')} />
            <ViewTile icon={<Package className="w-4 h-4 text-blue-400" />}    title="Software"       onClick={() => go('/create/v1~pods', 'Software')} />
            <ViewTile icon={<Clock className="w-4 h-4 text-blue-400" />}      title="Timeline"       onClick={() => go('/admin?tab=timeline', 'Timeline')} />
          </div>
        </section>

        {/* ── Key Capabilities (#6 clickable, #7 show 6 with toggle, #11 accurate count) ── */}
        <section aria-labelledby="capabilities-heading">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-800" />
            <h2 id="capabilities-heading" className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Key Capabilities</h2>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 divide-y divide-slate-800/60">
            <CapabilityRow iconColor="text-violet-400" icon={<FileCode className="w-4 h-4" />} title="YAML Editor" description="Autocomplete, diff preview, server-side dry-run validation" onClick={() => go('/r/apps~v1~deployments', 'Deployments')} />
            <CapabilityRow iconColor="text-violet-400" icon={<GitBranch className="w-4 h-4" />} title="GitOps / ArgoCD" description="Sync badges, auto-PR on save, drift detection — GitHub, GitLab, Bitbucket" onClick={() => go('/gitops', 'GitOps')} />
            <CapabilityRow iconColor="text-cyan-400" icon={<Bot className="w-4 h-4" />} title="AI Agent" description="Claude-powered SRE diagnostics, security scanning, and cluster operations" onClick={() => go('/agent', 'Agent')} />
            <CapabilityRow iconColor="text-blue-400" icon={<Clock className="w-4 h-4" />} title="Incident Timeline" description="Correlated alerts, events, rollouts, and config changes" onClick={() => go('/admin?tab=timeline', 'Timeline')} />
            <CapabilityRow iconColor="text-emerald-400" icon={<Monitor className="w-4 h-4" />} title="Health Audits" description="77 automated checks with YAML fix examples and remediation steps" onClick={() => go('/admin?tab=readiness', 'Readiness')} />
            <CapabilityRow iconColor="text-indigo-400" icon={<Shield className="w-4 h-4" />} title="Security Audit" description="TLS, encryption, SCCs, network policies, ACS detection" onClick={() => go('/security', 'Security')} />
            <CapabilityRow iconColor="text-cyan-400" icon={<History className="w-4 h-4" />} title="Rollback" description="Compare deployment revisions and roll back with one click" onClick={() => go('/workloads', 'Workloads')} />
            {showAllCapabilities && (
              <>
                <CapabilityRow iconColor="text-teal-400" icon={<Users className="w-4 h-4" />} title="Impersonation" description="Test RBAC as another user — all API calls use impersonation headers" onClick={() => go('/users', 'Users')} />
                <CapabilityRow iconColor="text-indigo-400" icon={<GitGraph className="w-4 h-4" />} title="Dependency Graph" description="Visualize resource relationships — pods, services, volumes, owner chains" onClick={() => go('/workloads', 'Workloads')} />
                <CapabilityRow iconColor="text-blue-400" icon={<ScrollText className="w-4 h-4" />} title="Log Streaming" description="Real-time pod logs with search, follow, timestamps, download" onClick={() => go('/workloads', 'Workloads')} />
                <CapabilityRow iconColor="text-amber-400" icon={<Camera className="w-4 h-4" />} title="Cluster Snapshots" description="Capture and compare cluster state over time" onClick={() => go('/admin?tab=snapshots', 'Snapshots')} />
                <CapabilityRow iconColor="text-violet-400" icon={<Diff className="w-4 h-4" />} title="Resource Diffing" description="YAML diff preview against the live version before saving" onClick={() => go('/workloads', 'Workloads')} />
                <CapabilityRow iconColor="text-orange-400" icon={<Terminal className="w-4 h-4" />} title="Pod Shell" description="Shell access to containers and nodes for live debugging" onClick={() => go('/compute', 'Compute')} />
              </>
            )}
          </div>
          <button
            onClick={() => setShowAllCapabilities(v => !v)}
            className="flex items-center gap-1.5 mx-auto mt-3 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAllCapabilities && 'rotate-180')} />
            {showAllCapabilities ? 'Show fewer' : 'Show all 12 capabilities'}
          </button>
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

function ActionCard({ icon, accentClass, iconColor, title, description, onClick }: {
  icon: React.ReactNode; accentClass: string; iconColor: string;
  title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
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

function ViewTile({ icon, title, onClick }: {
  icon: React.ReactNode; title: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-slate-800/60 bg-slate-900/50 hover:bg-slate-800/60 hover:border-slate-700 transition-all text-left"
      aria-label={`Open ${title}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">{title}</span>
    </button>
  );
}

function CapabilityRow({ icon, title, description, iconColor = 'text-blue-400', onClick }: {
  icon: React.ReactNode; title: string; description: string; iconColor?: string; onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
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
