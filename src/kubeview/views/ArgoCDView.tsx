import React from 'react';
import { GitBranch, RefreshCw, Loader2, Info, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useArgoCD, useArgoCDRefresh } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { k8sPatch } from '../engine/query';
import { useUIStore } from '../store/uiStore';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { Card } from '../components/primitives/Card';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { useGitOpsConfig } from '../hooks/useGitOpsConfig';
import { ApplicationsTab } from './argocd/ApplicationsTab';
import { SyncHistoryTab } from './argocd/SyncHistoryTab';
import { DriftTab } from './argocd/DriftTab';
import { ProjectsTab } from './argocd/ProjectsTab';
import { RolloutsTab } from './argocd/RolloutsTab';

type Tab = 'applications' | 'history' | 'drift' | 'projects' | 'rollouts';

export default function ArgoCDView() {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const { available, detecting, applications, applicationsLoading, namespace } = useArgoCD();
  const refresh = useArgoCDRefresh();
  const { isConfigured } = useGitOpsConfig();
  const [activeTab, setActiveTab] = React.useState<Tab>('applications');
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [confirmSync, setConfirmSync] = React.useState<{name: string, ns: string} | null>(null);

  const outOfSyncCount = applications.filter(a => a.status?.sync?.status === 'OutOfSync').length;
  const degradedCount = applications.filter(a => a.status?.health?.status === 'Degraded').length;

  const handleSync = (appName: string, appNs: string) => {
    setConfirmSync({ name: appName, ns: appNs });
  };

  const executeSync = async () => {
    if (!confirmSync) return;
    const { name: appName, ns: appNs } = confirmSync;
    setConfirmSync(null);
    setSyncing(appName);
    try {
      await k8sPatch(`/apis/argoproj.io/v1alpha1/namespaces/${appNs}/applications/${appName}`, {
        operation: {
          initiatedBy: { username: 'pulse', automated: false },
          sync: { revision: 'HEAD' },
        },
      });
      addToast({ type: 'success', title: 'Sync triggered', detail: `Application ${appName} is syncing` });
      setTimeout(() => refresh(), 3000);
    } catch (err) {
      addToast({ type: 'error', title: 'Sync failed', detail: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setSyncing(null);
    }
  };

  // Not available — show setup guide
  if (!available && !detecting) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <GitBranch className="w-6 h-6 text-violet-500" /> GitOps
            </h1>
            <p className="text-sm text-slate-400 mt-1">Manage your cluster declaratively via Git</p>
          </div>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-4">Get Started with GitOps</h2>
            <p className="text-sm text-slate-400 mb-6">GitOps uses Git as the single source of truth for your cluster configuration. Changes are made via pull requests, and ArgoCD ensures your cluster matches the desired state in Git.</p>

            <div className="space-y-4">
              <StepCard number={1} title="Install OpenShift GitOps" description="Install the OpenShift GitOps operator from OperatorHub. This deploys ArgoCD in the openshift-gitops namespace and provides ArgoCD Application CRDs." action="Open Operator Catalog" onClick={() => go('/create/v1~pods?tab=operators&q=openshift+gitops', 'Operator Catalog')} />
              <StepCard number={2} title="Create a Git Repository" description="Create a Git repo (GitHub, GitLab, or Bitbucket) to store your Kubernetes manifests. Organize by environment or application." />
              <StepCard number={3} title="Create an ArgoCD Application" description="Define an Application resource that points to your Git repo and target namespace. ArgoCD will sync your manifests to the cluster." />
              <StepCard number={4} title="Configure Pulse Integration" description="Go to Admin → GitOps tab to connect Pulse to your Git provider. This enables auto-PR on resource edits and drift tracking." action="Configure" onClick={() => go('/admin?tab=gitops', 'Admin')} />
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Why GitOps?</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-400">
              <div><span className="text-emerald-400 font-medium">Audit Trail</span> — Every change tracked in Git history</div>
              <div><span className="text-blue-400 font-medium">Rollback</span> — Revert to any previous state with git revert</div>
              <div><span className="text-violet-400 font-medium">Drift Detection</span> — ArgoCD alerts when cluster diverges from Git</div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'applications', label: `Applications (${applications.length})` },
    { id: 'history', label: 'Sync History' },
    { id: 'drift', label: `Drift${outOfSyncCount > 0 ? ` (${outOfSyncCount})` : ''}` },
    { id: 'projects', label: 'Projects' },
    ...(useArgoCDStore.getState().rolloutsAvailable ? [{ id: 'rollouts' as Tab, label: 'Rollouts' }] : []),
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <GitBranch className="w-6 h-6 text-violet-500" />
              GitOps
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              ArgoCD Applications, sync status, and drift detection
              {namespace && <span className="text-violet-400 ml-1">· {namespace}</span>}
            </p>
          </div>
          <button
            onClick={() => refresh()}
            disabled={applicationsLoading}
            className="px-3 py-1.5 text-xs text-slate-400 rounded hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', applicationsLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* Summary */}
        <MetricGrid>
          <Card className="p-3">
            <div className="text-xs text-slate-400 mb-1">Applications</div>
            <div className="text-xl font-bold text-slate-100">{applications.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-slate-400 mb-1">Synced</div>
            <div className="text-xl font-bold text-emerald-400">
              {applications.filter(a => a.status?.sync?.status === 'Synced').length}
            </div>
          </Card>
          <Card className={cn('p-3', outOfSyncCount > 0 && 'border-amber-800')}>
            <div className="text-xs text-slate-400 mb-1">Out of Sync</div>
            <div className={cn('text-xl font-bold', outOfSyncCount > 0 ? 'text-amber-400' : 'text-slate-400')}>
              {outOfSyncCount}
            </div>
          </Card>
          <Card className={cn('p-3', degradedCount > 0 && 'border-red-800')}>
            <div className="text-xs text-slate-400 mb-1">Degraded</div>
            <div className={cn('text-xl font-bold', degradedCount > 0 ? 'text-red-400' : 'text-slate-400')}>
              {degradedCount}
            </div>
          </Card>
        </MetricGrid>

        {/* Git repo setup guidance when not configured */}
        {!isConfigured && (
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center shrink-0">
                <GitBranch className="w-4 h-4 text-violet-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-100 mb-1">Connect your Git repository</h3>
                <p className="text-xs text-slate-400 mb-3">
                  Configure your Git provider to enable auto-PR when editing resources, catch-up PRs for urgent changes, and full drift tracking between Git and cluster state.
                </p>
                <div className="flex flex-wrap gap-4 text-xs text-slate-500 mb-3">
                  <span><span className="text-emerald-400">1.</span> Create a Git repo for your K8s manifests</span>
                  <span><span className="text-emerald-400">2.</span> Generate a personal access token</span>
                  <span><span className="text-emerald-400">3.</span> Configure in Admin → GitOps</span>
                </div>
                <button
                  onClick={() => go('/admin?tab=gitops', 'Admin')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
                >
                  Configure Git Provider <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* Tabs */}
        <Card className="flex gap-1 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {t.label}
            </button>
          ))}
        </Card>

        {/* Loading */}
        {(detecting || applicationsLoading) && applications.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'applications' && (
              <ApplicationsTab
                applications={applications}
                syncing={syncing}
                onSync={handleSync}
                go={go}
              />
            )}
            {activeTab === 'history' && (
              <SyncHistoryTab applications={applications} go={go} />
            )}
            {activeTab === 'drift' && (
              <DriftTab applications={applications} onSync={handleSync} syncing={syncing} go={go} />
            )}
            {activeTab === 'projects' && (
              <ProjectsTab />
            )}
            {activeTab === 'rollouts' && <RolloutsTab />}
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmSync}
        title="Confirm Sync"
        description={`Trigger sync for ${confirmSync?.name}?`}
        confirmLabel="Sync"
        variant="warning"
        onConfirm={executeSync}
        onClose={() => setConfirmSync(null)}
      />
    </div>
  );
}

function StepCard({ number, title, description, action, onClick }: {
  number: number; title: string; description: string; action?: string; onClick?: () => void;
}) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-slate-800 bg-slate-800/30">
      <div className="w-7 h-7 rounded-full bg-violet-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
        {number}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <p className="text-xs text-slate-400 mt-1">{description}</p>
        {action && onClick && (
          <button onClick={onClick} className="mt-2 text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors">
            {action} <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
