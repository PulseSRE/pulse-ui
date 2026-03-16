import { useNavigate } from 'react-router-dom';
import {
  HeartPulse,
  LayoutDashboard,
  Clock,
  Search,
  GitBranch,
  Terminal,
  FilePlus,
  GitCompare,
  Keyboard,
  ArrowRight,
  Zap,
  Eye,
  Shield,
} from 'lucide-react';
import { useUIStore } from '../store/uiStore';

export default function WelcomeView() {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  function go(path: string, title: string) {
    addTab({ title, path, pinned: false, closable: true });
    navigate(path);
  }

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
              icon={<Search className="w-6 h-6 text-emerald-400" />}
              title="Find Resources"
              description="Press ⌘K to search any resource type — pods, services, secrets, CRDs"
              onClick={openCommandPalette}
            />
            <QuickAction
              icon={<FilePlus className="w-6 h-6 text-amber-400" />}
              title="Create a Resource"
              description="Start from a YAML template with auto-complete snippets"
              onClick={() => go('/create/v1~pods', 'Create Pod')}
            />
            <QuickAction
              icon={<GitBranch className="w-6 h-6 text-orange-400" />}
              title="Troubleshoot Resource"
              description="Auto-diagnose issues, view dependencies, and investigate correlations"
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
            <Shortcut keys="Esc" label="Close Overlay" description="Close palette, browser, or panel" />
          </div>
        </div>

        {/* Pages */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-400" />
            Built-in Views
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PageLink
              icon={<HeartPulse className="w-5 h-5 text-blue-400" />}
              title="Cluster Pulse"
              description="Ops alerts — what needs attention right now"
              onClick={() => go('/pulse', 'Pulse')}
            />
            <PageLink
              icon={<LayoutDashboard className="w-5 h-5 text-purple-400" />}
              title="Dashboard"
              description="Metrics overview with CPU, memory, pod breakdown"
              onClick={() => go('/dashboard', 'Dashboard')}
            />
            <PageLink
              icon={<Clock className="w-5 h-5 text-blue-400" />}
              title="Timeline"
              description="Chronological event feed with filters"
              onClick={() => go('/timeline', 'Timeline')}
            />
            <PageLink
              icon={<GitCompare className="w-5 h-5 text-pink-400" />}
              title="Config Compare"
              description="Snapshot and diff cluster configuration"
              onClick={() => go('/config-compare', 'Config Compare')}
            />
          </div>
        </div>

        {/* Features */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Key Capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Feature title="Auto-Generated Tables" description="Every resource type gets sortable columns, search, and pagination — auto-detected from the resource data." />
            <Feature title="Smart Diagnosis" description="Pods, deployments, and nodes are automatically diagnosed for CrashLoopBackOff, OOM, scheduling failures, and more." />
            <Feature title="Inline Actions" description="Scale deployments, restart pods, cordon nodes, and delete resources directly from the table view." />
            <Feature title="Dependency Graph" description="Visualize relationships between deployments, services, pods, secrets, and config maps as an interactive SVG graph." />
            <Feature title="Multi-Container Logs" description="Stream logs from all containers in a pod with search, filtering, and download." />
            <Feature title="YAML Editor" description="Edit resources with syntax highlighting, validation, and starter snippets for 12 resource types." />
            <Feature title="Metrics & Charts" description="View CPU, memory, and custom Prometheus metrics with auto-generated PromQL queries." />
            <Feature title="Column Picker & Filters" description="Show/hide columns and filter each column individually for any resource type." />
          </div>
        </div>

        {/* Footer CTA */}
        <div className="text-center pb-8">
          <button
            onClick={() => go('/pulse', 'Pulse')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          >
            Get Started
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
