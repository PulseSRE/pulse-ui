import React from 'react';
import {
  ArrowRight, Shield, Bell, Settings,
  HardDrive, Package, Globe, Server, Puzzle, Users, Hammer,
  Keyboard, CheckCircle, XCircle,
  Github, HeartPulse, Search,
  FileCode, History, GitGraph, ScrollText, Camera,
  Diff, Monitor, Terminal,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import type { K8sResource } from '../engine/renderers';

export default function WelcomeView() {
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const connectionStatus = useUIStore((s) => s.connectionStatus);
  const go = useNavigateTab();

  const { data: nodes = [], isLoading: nodesLoading } = useK8sListWatch({ apiPath: '/api/v1/nodes' });

  const typedNodes = nodes as K8sResource[];
  const isConnected = connectionStatus === 'connected';

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* ── Hero ── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/40 px-8 py-12 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.08)_0%,transparent_60%)]" />
          <div className="relative">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mb-3">
              Welcome to <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent">ShiftOps</span>
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto leading-relaxed">
              67 automated health checks, real-time diagnosis, and one-click remediation — built for day-2 operations.
            </p>
            <div className="mt-5">
              <ClusterStatusPill
                isConnected={isConnected}
                connectionStatus={connectionStatus}
                nodeCount={typedNodes.length}
                isLoading={nodesLoading}
              />
            </div>
          </div>
        </div>

        {/* ── Cluster Pulse (primary CTA) ── */}
        <button
          onClick={() => go('/pulse', 'Pulse')}
          className="group relative w-full flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-br from-blue-500/20 to-blue-600/5 border-blue-500/20 hover:border-blue-500/40 transition-all text-left"
        >
          <span className="text-blue-400"><HeartPulse className="w-6 h-6" /></span>
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-100">Cluster Pulse</div>
            <div className="text-xs text-slate-400 mt-0.5">Risk score, attention items, and live issues</div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-700 group-hover:text-blue-400 transition-colors" />
        </button>

        {/* ── Quick Nav Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ViewTile icon={<Server className="w-4 h-4 text-blue-400" />}   title="Compute"        onClick={() => go('/compute', 'Compute')} />
          <ViewTile icon={<Package className="w-4 h-4 text-blue-400" />}  title="Workloads"      onClick={() => go('/workloads', 'Workloads')} />
          <ViewTile icon={<Settings className="w-4 h-4 text-slate-400" />} title="Administration" onClick={() => go('/admin', 'Administration')} />
          <ViewTile icon={<Bell className="w-4 h-4 text-red-400" />}      title="Alerts"         onClick={() => go('/alerts', 'Alerts')} />
        </div>

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
            description={'\u2318\u2009K to search 500+ resource types, \u2318\u2009B to browse by API group'}
            onClick={openCommandPalette}
          />
        </div>

        {/* ── All Views ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">All Views</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <ViewTile icon={<Package className="w-4 h-4 text-blue-400" />}  title="Software"      onClick={() => go('/software', 'Software')} />
            <ViewTile icon={<Globe className="w-4 h-4 text-cyan-400" />}    title="Networking"     onClick={() => go('/networking', 'Networking')} />
            <ViewTile icon={<HardDrive className="w-4 h-4 text-orange-400" />} title="Storage"     onClick={() => go('/storage', 'Storage')} />
            <ViewTile icon={<Hammer className="w-4 h-4 text-amber-500" />}  title="Builds"        onClick={() => go('/builds', 'Builds')} />
            <ViewTile icon={<Shield className="w-4 h-4 text-indigo-400" />} title="Security"      onClick={() => go('/security', 'Security')} />
            <ViewTile icon={<Users className="w-4 h-4 text-teal-400" />}    title="User Mgmt"     onClick={() => go('/users', 'Users')} />
            <ViewTile icon={<Shield className="w-4 h-4 text-violet-400" />} title="Access Control" onClick={() => go('/access-control', 'Access Control')} />
            <ViewTile icon={<Puzzle className="w-4 h-4 text-violet-400" />} title="CRDs"          onClick={() => go('/crds', 'CRDs')} />
          </div>
        </div>

        {/* ── Key Capabilities ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Key Capabilities</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 divide-y divide-slate-800/60">
            <CapabilityRow iconColor="text-violet-400" icon={<FileCode className="w-4 h-4" />} title="YAML Editor" description="Edit any resource with autocomplete, diff preview, and server-side dry-run validation" />
            <CapabilityRow iconColor="text-teal-400" icon={<Users className="w-4 h-4" />} title="Impersonation" description="Test RBAC by acting as another user or group — all API calls use impersonation headers" />
            <CapabilityRow iconColor="text-cyan-400" icon={<History className="w-4 h-4" />} title="Rollback" description="Compare deployment revisions side-by-side and roll back with one click" />
            <CapabilityRow iconColor="text-indigo-400" icon={<GitGraph className="w-4 h-4" />} title="Dependency Graph" description="Visualize resource relationships — pods, services, ingress, volumes, owner chains" />
            <CapabilityRow iconColor="text-blue-400" icon={<ScrollText className="w-4 h-4" />} title="Log Streaming" description="Real-time pod logs with search, follow, timestamps, and download" />
            <CapabilityRow iconColor="text-amber-400" icon={<Camera className="w-4 h-4" />} title="Cluster Snapshots" description="Capture and compare cluster state over time — operators, CRDs, storage, RBAC" />
            <CapabilityRow iconColor="text-violet-400" icon={<Diff className="w-4 h-4" />} title="Resource Diffing" description="See exactly what changed before saving — YAML diff preview against the live version" />
            <CapabilityRow iconColor="text-emerald-400" icon={<Monitor className="w-4 h-4" />} title="Workload Audit" description="6 automated health checks per domain — limits, probes, PDBs, replicas, TLS" />
            <CapabilityRow iconColor="text-indigo-400" icon={<Shield className="w-4 h-4" />} title="Security Audit" description="TLS, encryption, SCCs, network policies, secrets management — 9 checks" />
            <CapabilityRow iconColor="text-orange-400" icon={<Terminal className="w-4 h-4" />} title="Pod Shell" description="Shell access to containers and nodes for live debugging" />
          </div>
        </div>

        {/* ── Keyboard Shortcuts ── */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ShortcutPill keys={'\u2318K'} label="Command Palette" />
          <ShortcutPill keys={'\u2318B'} label="Resource Browser" />
          <ShortcutPill keys="j / k" label="Navigate Table" />
        </div>

        {/* ── Footer ── */}
        <footer className="flex items-center justify-center gap-3 text-xs text-slate-600 pb-2">
          <a
            href="https://github.com/alimobrem/ShiftOps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-slate-400 transition-colors"
          >
            <Github className="w-3 h-3" /> GitHub
          </a>
          <span>·</span>
          <span>v3.0.0</span>
        </footer>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function ClusterStatusPill({ isConnected, connectionStatus, nodeCount, isLoading }: {
  isConnected: boolean; connectionStatus: string; nodeCount: number; isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
        Connecting...
      </span>
    );
  }
  if (!isConnected) {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-950/30 border border-red-900/40 text-xs text-red-400">
        <XCircle className="w-3 h-3" />
        {connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-950/30 border border-emerald-900/40 text-xs text-emerald-400">
      <CheckCircle className="w-3 h-3" />
      Connected · {nodeCount} node{nodeCount !== 1 ? 's' : ''}
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
      <span className={iconColor}>{icon}</span>
      <div>
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <div className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</div>
      </div>
      <ArrowRight className="absolute top-5 right-5 w-4 h-4 text-slate-700 group-hover:text-blue-400 transition-colors" />
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
    >
      {icon}
      <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">{title}</span>
    </button>
  );
}

function CapabilityRow({ icon, title, description, iconColor = 'text-blue-400' }: {
  icon: React.ReactNode; title: string; description: string; iconColor?: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`${iconColor} mt-0.5 shrink-0`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-200">{title}</span>
        <span className="text-xs text-slate-500 ml-2">{description}</span>
      </div>
    </div>
  );
}

function ShortcutPill({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-800/60">
      <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[11px] font-mono text-slate-300 border border-slate-700/60">{keys}</kbd>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}
