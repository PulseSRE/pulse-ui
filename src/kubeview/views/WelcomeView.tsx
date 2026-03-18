import {
  HeartPulse, Clock, Search, GitBranch, Terminal, FilePlus,
  Keyboard, ArrowRight, Zap, Eye, Shield, Bell, Settings,
  HardDrive, Activity, Cpu, Package, Globe, Server, Puzzle, Users,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

export default function WelcomeView() {
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const go = useNavigateTab();

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto space-y-8 py-8">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-100 mb-3">
            Welcome to <span className="text-blue-400">ShiftOps</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            A next-generation console for managing your OpenShift cluster with
            55 automated health checks and an 84/100 SysAdmin review score.
            Every view is auto-generated from the API — browse any resource type,
            see what needs attention, and take action in seconds.
          </p>
        </div>

        {/* Quick Start */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Quick Start
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuickAction
              icon={<HeartPulse className="w-6 h-6 text-blue-400" />}
              title="Check Cluster Health"
              description="See active issues, CPU/memory usage, and degraded operators at a glance"
              onClick={() => go('/pulse', 'Pulse')}
            />
            <QuickAction
              icon={<Search className="w-6 h-6 text-emerald-400" />}
              title="Find Resources"
              description="Press ⌘K to search any resource type — pods, services, secrets, CRDs"
              onClick={openCommandPalette}
            />
            <QuickAction
              icon={<GitBranch className="w-6 h-6 text-orange-400" />}
              title="Troubleshoot Issues"
              description="Auto-diagnose problems with interactive runbooks and namespace health"
              onClick={() => go('/pulse', 'Pulse')}
            />
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-purple-400" />
            Keyboard Shortcuts
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Shortcut keys="⌘ K" label="Command Palette" description="Search resources, pages, actions" />
            <Shortcut keys="⌘ B" label="Resource Browser" description="Browse all API groups" />
            <Shortcut keys="⌘ ." label="Resource Browser" description="Browse all API groups" />
            <Shortcut keys="j / k" label="Navigate Table" description="Move up/down in resource lists" />
          </div>
        </div>

        {/* Pages */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-400" />
            Built-in Views
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <PageLink icon={<HeartPulse className="w-5 h-5 text-blue-400" />} title="Cluster Pulse" description="Active issues, CPU/memory, operator health" onClick={() => go('/pulse', 'Pulse')} />
            <PageLink icon={<Bell className="w-5 h-5 text-red-400" />} title="Alerts" description="Alerts with severity filters, silence management, grouping" onClick={() => go('/alerts', 'Alerts')} />
            <PageLink icon={<Clock className="w-5 h-5 text-blue-400" />} title="Timeline" description="Chronological cluster event feed" onClick={() => go('/timeline', 'Timeline')} />
            <PageLink icon={<Package className="w-5 h-5 text-blue-400" />} title="Workloads" description="Deployments, StatefulSets, DaemonSets, Jobs, Pods" onClick={() => go('/workloads', 'Workloads')} />
            <PageLink icon={<Globe className="w-5 h-5 text-cyan-400" />} title="Networking" description="Services, Routes, Ingresses, Network Policies" onClick={() => go('/networking', 'Networking')} />
            <PageLink icon={<Server className="w-5 h-5 text-blue-400" />} title="Compute" description="Nodes, machines, capacity, autoscaling" onClick={() => go('/compute', 'Compute')} />
            <PageLink icon={<HardDrive className="w-5 h-5 text-orange-400" />} title="Storage" description="PVCs, PVs, StorageClasses, capacity" onClick={() => go('/storage', 'Storage')} />
            <PageLink icon={<Shield className="w-5 h-5 text-indigo-400" />} title="Access Control" description="RBAC roles, cluster-admin audit" onClick={() => go('/access-control', 'Access Control')} />
            <PageLink icon={<Users className="w-5 h-5 text-teal-400" />} title="User Management" description="Users, groups, service accounts, impersonation" onClick={() => go('/users', 'Users')} />
            <PageLink icon={<Package className="w-5 h-5 text-blue-400" />} title="Software" description="Installed software, operators, deploy, Helm, templates" onClick={() => go('/create/v1~pods', 'Software')} />
            <PageLink icon={<Settings className="w-5 h-5 text-slate-400" />} title="Administration" description="Readiness, operators, config, updates, snapshots" onClick={() => go('/admin', 'Administration')} />
          </div>
        </div>

        {/* Features */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            Key Capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Feature title="Operator Catalog" description="Browse 500+ operators, one-click install with progress tracking, and post-install configuration guidance." />
            <Feature title="Production Readiness" description="32 automated checks across 6 categories — infrastructure, storage, security, networking, observability, reliability." />
            <Feature title="Workload Health Audit" description="24 automated checks across Workloads, Storage, Networking, Compute with per-resource pass/fail and YAML fix examples." />
            <Feature title="Smart Diagnosis" description="Fetches pod logs, detects 10 error patterns (Permission denied, OOM, DNS), shows actual error with specific fix." />
            <Feature title="Alert Management" description="Severity filters, group by namespace, silence creation from alerts, runbook links, firing duration." />
            <Feature title="RBAC-Aware UI" description="Actions hidden/disabled based on user permissions via SelfSubjectAccessReview." />
            <Feature title="User Impersonation" description="Test permissions by impersonating any user or service account." />
            <Feature title="Metrics Charts" description="SVG sparkline charts on all overview pages with threshold-based colors." />
            <Feature title="Cluster Config Editor" description="Configure OAuth, proxy, image registries, scheduler, TLS, initiate upgrades, manage snapshots." />
            <Feature title="Auto-Generated Tables" description="Every resource type gets sortable columns, search, filters, per-row delete, and auto-generated YAML from CRD schemas." />
            <Feature title="Compute Overview" description="Per-node metrics with utilization bars, Machine Management, autoscaling guidance, health checks." />
            <Feature title="Deployment Logs" description="View logs from all pods in a deployment with pod selector tabs and merged view." />
            <Feature title="Dependency Graph" description="Visualize relationships between deployments, services, pods, and config maps with blast radius analysis." />
          </div>
        </div>

        {/* Footer CTA */}
        <div className="text-center pb-8">
          <button
            onClick={() => go('/pulse', 'Pulse')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            Go to Cluster Pulse
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, title, description, onClick }: {
  icon: React.ReactNode; title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-3 p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-blue-600 transition-colors text-center"
    >
      {icon}
      <div>
        <div className="text-sm font-semibold text-slate-200">{title}</div>
        <div className="text-xs text-slate-400 mt-1">{description}</div>
      </div>
    </button>
  );
}

function Shortcut({ keys, label, description }: { keys: string; label: string; description: string }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
      <kbd className="px-2 py-1 bg-slate-700 rounded text-xs font-mono text-slate-200 whitespace-nowrap shrink-0">{keys}</kbd>
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </div>
  );
}

function PageLink({ icon, title, description, onClick }: {
  icon: React.ReactNode; title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-800 transition-colors text-left w-full"
    >
      {icon}
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-600" />
    </button>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
      <div>
        <div className="font-medium text-slate-200">{title}</div>
        <div className="text-slate-400">{description}</div>
      </div>
    </div>
  );
}
