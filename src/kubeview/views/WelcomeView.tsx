import {
  HeartPulse, Clock, Search, GitBranch, Terminal, FilePlus,
  Keyboard, ArrowRight, Zap, Eye, Shield, Bell, Settings,
  Puzzle, HardDrive, Activity, Cpu,
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
          <h1 className="text-4xl font-bold text-slate-100 mb-3">
            Welcome to <span className="text-blue-400">OpenShiftView</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            A next-generation console for managing your OpenShift cluster.
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
              onClick={() => go('/troubleshoot', 'Troubleshoot')}
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
            <Shortcut keys="⌘ ." label="Action Panel" description="Quick actions on current resource" />
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
            <PageLink icon={<Activity className="w-5 h-5 text-orange-400" />} title="Troubleshoot" description="Auto-diagnose issues with interactive runbooks" onClick={() => go('/troubleshoot', 'Troubleshoot')} />
            <PageLink icon={<Bell className="w-5 h-5 text-red-400" />} title="Alerts" description="Prometheus alerts, rules, and silences" onClick={() => go('/alerts', 'Alerts')} />
            <PageLink icon={<Clock className="w-5 h-5 text-blue-400" />} title="Timeline" description="Chronological cluster event feed" onClick={() => go('/timeline', 'Timeline')} />
            <PageLink icon={<HardDrive className="w-5 h-5 text-orange-400" />} title="Storage" description="PVCs, PVs, StorageClasses, capacity" onClick={() => go('/storage', 'Storage')} />
            <PageLink icon={<Shield className="w-5 h-5 text-indigo-400" />} title="Access Control" description="RBAC roles, cluster-admin audit" onClick={() => go('/access-control', 'Access Control')} />
            <PageLink icon={<Puzzle className="w-5 h-5 text-violet-400" />} title="Operators" description="ClusterOperator health and versions" onClick={() => go('/operators', 'Operators')} />
            <PageLink icon={<Settings className="w-5 h-5 text-slate-400" />} title="Administration" description="Cluster config, updates, snapshots, quotas" onClick={() => go('/admin', 'Administration')} />
            <PageLink icon={<FilePlus className="w-5 h-5 text-amber-400" />} title="Create Resource" description="YAML templates with autocomplete" onClick={() => go('/create/v1~pods', 'Create')} />
          </div>
        </div>

        {/* Features */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            Key Capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Feature title="Auto-Generated Tables" description="Every resource type gets sortable columns, search, filters, and pagination — auto-detected from the data." />
            <Feature title="Smart Diagnosis" description="Pods, deployments, and nodes are automatically diagnosed for CrashLoopBackOff, OOM, scheduling failures, and more." />
            <Feature title="Cluster Config Editor" description="Configure OAuth providers, proxy, image registries, scheduler profiles, TLS, and initiate cluster upgrades." />
            <Feature title="Config Snapshots" description="Capture cluster state, persist snapshots, and compare side-by-side to track what changed." />
            <Feature title="Dependency Graph" description="Visualize relationships between deployments, services, pods, and config maps with blast radius analysis." />
            <Feature title="YAML Editor" description="Edit resources with syntax highlighting, validation, diff view, and context-aware snippets for 12+ resource types." />
            <Feature title="Inline Actions" description="Scale deployments, restart pods, cordon nodes, and delete resources directly from any view." />
            <Feature title="Metrics & Correlation" description="View CPU, memory, and custom Prometheus metrics with auto-generated PromQL. Correlate with events for root cause analysis." />
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
