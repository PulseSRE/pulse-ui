import React, { useEffect } from 'react';
import { GitBranch, RefreshCw, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useArgoCD, useArgoCDRefresh } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { k8sPatch } from '../engine/query';
import { useUIStore } from '../store/uiStore';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { Card } from '../components/primitives/Card';
import { showErrorToast } from '../engine/errorToast';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { SectionHeader } from '../components/primitives/SectionHeader';
import { StatCard } from '../components/primitives/StatCard';
import { Button } from '../components/primitives/Button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/primitives/Tabs';
import { useGitOpsConfig } from '../hooks/useGitOpsConfig';
import { useGitOpsSetupStore } from '../store/gitopsSetupStore';
import { GitOpsSetupWizard } from './argocd/GitOpsSetupWizard';
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
  const { openWizard, wizardOpen, completedSteps, detectCompletedSteps } = useGitOpsSetupStore();

  // Detect setup progress on mount
  useEffect(() => {
    detectCompletedSteps();
  }, [available]);
  const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab | null;
  const [activeTab, setActiveTabState] = React.useState<Tab>(
    urlTab && ['applications', 'history', 'drift', 'projects', 'rollouts'].includes(urlTab) ? urlTab : 'applications',
  );
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'applications') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [confirmSync, setConfirmSync] = React.useState<{name: string, ns: string} | null>(null);

  const outOfSyncCount = (applications || []).filter(a => a.status?.sync?.status === 'OutOfSync').length;
  const degradedCount = (applications || []).filter(a => a.status?.health?.status === 'Degraded').length;

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
        metadata: {
          annotations: {
            'argocd.argoproj.io/refresh': 'hard',
          },
        },
      });
      addToast({ type: 'success', title: 'Sync triggered', detail: `Application ${appName} is syncing` });
      setTimeout(() => refresh(), 3000);
    } catch (err) {
      showErrorToast(err, 'Sync failed');
    } finally {
      setSyncing(null);
    }
  };

  // Show loading while detecting
  if (detecting) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Detecting ArgoCD...</p>
        </div>
      </div>
    );
  }

  // Not available — show setup wizard CTA
  if (!available) {
    return (
      <div className="h-full overflow-auto bg-slate-950 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <SectionHeader
            icon={<GitBranch className="w-6 h-6 text-violet-500" />}
            title="GitOps"
            subtitle="Manage your cluster declaratively via Git"
          />

          <Card className="p-8 text-center">
            <Sparkles className="w-12 h-12 text-violet-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-100 mb-2">Set Up GitOps</h2>
            <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
              A guided wizard will install the OpenShift GitOps operator, configure your Git provider,
              and create your first ArgoCD application — all without leaving Pulse.
            </p>
            <Button onClick={() => openWizard()} size="lg" className="bg-violet-600 hover:bg-violet-500 px-8 py-3">
              <Sparkles className="w-4 h-4" />
              Start Setup Wizard
            </Button>
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
        <GitOpsSetupWizard />
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
        <SectionHeader
          icon={<GitBranch className="w-6 h-6 text-violet-500" />}
          title="GitOps"
          subtitle={<>ArgoCD Applications, sync status, and drift detection{namespace && <span className="text-violet-400 ml-1">· {namespace}</span>}</>}
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => openWizard(isConfigured ? 'select-resources' : undefined)} className="bg-violet-600 hover:bg-violet-500">
                <Sparkles className="w-3.5 h-3.5" />
                {isConfigured ? 'Configure GitOps' : 'Set Up GitOps'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refresh()} disabled={applicationsLoading}>
                <RefreshCw className={cn('w-3.5 h-3.5', applicationsLoading && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          }
        />

        {/* Setup hint when not fully configured */}
        {!isConfigured && (
          <div className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-lg p-4">
            <Sparkles className="w-5 h-5 text-violet-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-200">Continue GitOps Setup</p>
              <p className="text-xs text-slate-400">Configure your Git provider to enable auto-PR and drift tracking</p>
            </div>
            <Button size="sm" onClick={() => openWizard()} className="bg-violet-600 hover:bg-violet-500">
              <Sparkles className="w-3.5 h-3.5" />
              Continue Setup
            </Button>
          </div>
        )}

        {/* Summary */}
        <MetricGrid>
          <StatCard label="Applications" value={applications.length} />
          <StatCard label="Synced" value={applications.filter(a => a.status?.sync?.status === 'Synced').length} variant="success" />
          <StatCard label="Out of Sync" value={outOfSyncCount} variant={outOfSyncCount > 0 ? 'warning' : 'default'} highlight={outOfSyncCount > 0} />
          <StatCard label="Degraded" value={degradedCount} variant={degradedCount > 0 ? 'error' : 'default'} highlight={degradedCount > 0} />
        </MetricGrid>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* Loading */}
          {(detecting || applicationsLoading) && applications.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            </div>
          ) : (
            <>
              <TabsContent value="applications">
                <ApplicationsTab
                  applications={applications || []}
                  syncing={syncing}
                  onSync={handleSync}
                  go={go}
                />
              </TabsContent>
              <TabsContent value="history">
                <SyncHistoryTab applications={applications || []} go={go} />
              </TabsContent>
              <TabsContent value="drift">
                <DriftTab applications={applications || []} onSync={handleSync} syncing={syncing} go={go} />
              </TabsContent>
              <TabsContent value="projects">
                <ProjectsTab />
              </TabsContent>
              {useArgoCDStore.getState().rolloutsAvailable && (
                <TabsContent value="rollouts">
                  <RolloutsTab rollouts={useArgoCDStore.getState().rollouts || []} go={go} />
                </TabsContent>
              )}
            </>
          )}
        </Tabs>
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
      <GitOpsSetupWizard />
    </div>
  );
}
