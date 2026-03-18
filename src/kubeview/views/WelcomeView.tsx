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
            67 automated health checks and a 93/100 SysAdmin review score.
            Browse any resource, diagnose issues, manage software, and audit
            security — all from one place.
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
              icon={<Shield className="w-6 h-6 text-orange-400" />}
              title="Production Readiness"
              description="67 automated checks — cluster readiness, workloads, storage, networking, compute, RBAC"
              onClick={() => go('/admin?tab=readiness', 'Admin')}
            />
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-purple-400" />
            Keyboard Shortcuts
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Shortcut keys="⌘ K / ⌘ ." label="Command Palette" description="Search resources, pages, quick actions" />
            <Shortcut keys="⌘ B" label="Resource Browser" description="Browse all API groups and resources" />
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
            <PageLink icon={<HeartPulse className="w-5 h-5 text-blue-400" />} title="Cluster Pulse" description="Health overview, issues, runbooks, namespace health" onClick={() => go('/pulse', 'Pulse')} />
            <PageLink icon={<Package className="w-5 h-5 text-blue-400" />} title="Software" description="Installed inventory, operators, deploy, Helm, templates" onClick={() => go('/create/v1~pods', 'Software')} />
            <PageLink icon={<Package className="w-5 h-5 text-blue-400" />} title="Workloads" description="Deployments, pods, health audit with 6 checks" onClick={() => go('/workloads', 'Workloads')} />
            <PageLink icon={<Globe className="w-5 h-5 text-cyan-400" />} title="Networking" description="Routes, services, ingress, network policies, 6 checks" onClick={() => go('/networking', 'Networking')} />
            <PageLink icon={<Server className="w-5 h-5 text-blue-400" />} title="Compute" description="Nodes, machines, MachineConfig, autoscaling, 6 checks" onClick={() => go('/compute', 'Compute')} />
            <PageLink icon={<HardDrive className="w-5 h-5 text-orange-400" />} title="Storage" description="PVCs, StorageClasses, CSI drivers, snapshots, 6 checks" onClick={() => go('/storage', 'Storage')} />
            <PageLink icon={<Shield className="w-5 h-5 text-indigo-400" />} title="Access Control" description="RBAC audit, recent changes, cluster-admin tracking" onClick={() => go('/access-control', 'Access Control')} />
            <PageLink icon={<Users className="w-5 h-5 text-teal-400" />} title="User Management" description="Users, groups, impersonation, identity audit, sessions" onClick={() => go('/users', 'Users')} />
            <PageLink icon={<Settings className="w-5 h-5 text-slate-400" />} title="Administration" description="Readiness (67 checks), config (10 sections), updates, snapshots" onClick={() => go('/admin', 'Administration')} />
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-red-400" />
            Alerts & Incident Response
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuickAction
              icon={<Bell className="w-6 h-6 text-red-400" />}
              title="View Alerts"
              description="Firing alerts with severity filters, grouping by namespace, and runbook links"
              onClick={() => go('/alerts', 'Alerts')}
            />
            <QuickAction
              icon={<Activity className="w-6 h-6 text-blue-400" />}
              title="Silence Management"
              description="Create silences from alerts, set duration presets, expire with confirmation"
              onClick={() => go('/alerts?tab=silences', 'Alerts')}
            />
            <QuickAction
              icon={<HeartPulse className="w-6 h-6 text-orange-400" />}
              title="Diagnose Issues"
              description="Smart diagnosis with log analysis, runbooks, and namespace health"
              onClick={() => go('/pulse?tab=issues', 'Pulse')}
            />
          </div>
        </div>

        {/* Features */}
        <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            Key Capabilities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Feature title="67 Health Checks" description="31 cluster-level readiness checks + 36 domain-specific audits across workloads, storage, networking, compute, RBAC, and identity." />
            <Feature title="Software Hub" description="Installed inventory, 500+ operators, Quick Deploy, Helm charts, 30 YAML templates — all in one page." />
            <Feature title="Smart Diagnosis" description="Fetches pod logs and PVC events, detects 10 error patterns, shows actual errors with specific fix steps." />
            <Feature title="Alert Management" description="Severity filters, group by namespace, silence creation, runbook links, firing duration, silenced indicators." />
            <Feature title="User Management" description="Users, groups, service accounts with one-click impersonation. Identity & Access Audit with 6 checks." />
            <Feature title="RBAC Security" description="6 RBAC audit checks, recent changes panel, cluster-admin tracking, privilege escalation alerts." />
            <Feature title="Metrics Charts" description="SVG sparkline charts on all overview pages with threshold-based color changes." />
            <Feature title="YAML Editor" description="CodeMirror with 71 context-aware snippets (insert at cursor), schema panel, linting, diff view." />
            <Feature title="Cluster Config" description="10 config sections — OAuth, Proxy, Image, Ingress, Scheduler, API Server, DNS, Network, FeatureGate, Console." />
            <Feature title="Snapshots" description="Capture cluster state including RBAC and config. Compare side-by-side to detect drift and privilege changes." />
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
