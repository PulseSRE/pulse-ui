import React from 'react';
import {
  CheckCircle, XCircle, AlertTriangle, RefreshCw, Loader2,
  ExternalLink, ArrowRight, HelpCircle, Pause, Clock, Box,
  AlertOctagon, Globe, Plus, Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArgoApplication, ArgoSyncStatus, ArgoHealthStatus } from '../../engine/types';
import { Card } from '../../components/primitives/Card';
import { timeAgo } from '../../engine/dateUtils';

const SAMPLE_APPLICATION_YAML = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: openshift-gitops
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/your-repo.git
    targetRevision: HEAD
    path: manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true`;

interface ApplicationsTabProps {
  applications: ArgoApplication[];
  syncing: string | null;
  onSync: (name: string, namespace: string) => void;
  go: (path: string, title: string) => void;
}

const HEALTH_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  Healthy: { icon: CheckCircle, color: 'text-emerald-400' },
  Degraded: { icon: XCircle, color: 'text-red-400' },
  Progressing: { icon: RefreshCw, color: 'text-blue-400' },
  Suspended: { icon: Pause, color: 'text-amber-400' },
  Missing: { icon: AlertTriangle, color: 'text-red-400' },
  Unknown: { icon: HelpCircle, color: 'text-slate-400' },
};

const SYNC_COLORS: Record<ArgoSyncStatus, string> = {
  Synced: 'bg-emerald-900/50 text-emerald-300',
  OutOfSync: 'bg-amber-900/50 text-amber-300',
  Unknown: 'bg-slate-800 text-slate-400',
};

export function ApplicationsTab({ applications, syncing, onSync, go }: ApplicationsTabProps) {
  const [expandedApp, setExpandedApp] = React.useState<string | null>(null);

  const [showYaml, setShowYaml] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  if (applications.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-8">
          <div className="text-center max-w-md">
            <HelpCircle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 text-sm font-medium">No ArgoCD Applications found</p>
            <p className="text-slate-500 text-xs mt-1 mb-4">
              Create an Application to start managing resources declaratively via Git.
              The Application tells ArgoCD which Git repo to watch and where to deploy.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setShowYaml(!showYaml)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Create Application
              </button>
              <button
                onClick={() => go('/create/v1~pods?tab=yaml', 'Import YAML')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Import YAML
              </button>
            </div>
          </div>
        </div>

        {showYaml && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-200">Sample Application YAML</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(SAMPLE_APPLICATION_YAML).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-xs rounded-sm transition-colors',
                  copied ? 'text-emerald-400 bg-emerald-900/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
                )}
              >
                {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="bg-slate-950 rounded-lg p-3 overflow-x-auto">
              <pre className="text-xs text-slate-300 font-mono whitespace-pre">{SAMPLE_APPLICATION_YAML}</pre>
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-500">
              <p><strong className="text-slate-400">Before applying:</strong> Update the following fields:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><code className="bg-slate-800 px-1 rounded-sm">metadata.name</code> — your application name</li>
                <li><code className="bg-slate-800 px-1 rounded-sm">spec.source.repoURL</code> — your Git repository URL</li>
                <li><code className="bg-slate-800 px-1 rounded-sm">spec.source.path</code> — directory containing your K8s manifests</li>
                <li><code className="bg-slate-800 px-1 rounded-sm">spec.destination.namespace</code> — target namespace on this cluster</li>
              </ul>
              <p className="mt-2">Apply with: <code className="bg-slate-800 px-1.5 py-0.5 rounded-sm font-mono">oc apply -f application.yaml</code></p>
            </div>
          </Card>
        )}
      </div>
    );
  }

  return (
    <Card>
      <div className="divide-y divide-slate-800">
        {applications.map((app) => {
          const sync = app.status?.sync;
          const health = app.status?.health;
          const opState = app.status?.operationState;
          const source = app.spec?.source || app.spec?.sources?.[0];
          const resourceCount = app.status?.resources?.length || 0;
          const HealthIcon = HEALTH_ICONS[health?.status || 'Unknown']?.icon || HelpCircle;
          const healthColor = HEALTH_ICONS[health?.status || 'Unknown']?.color || 'text-slate-400';
          const shortSha = sync?.revision?.slice(0, 7);
          const repoName = source?.repoURL?.replace(/^https?:\/\//, '').replace(/\.git$/, '').split('/').slice(-2).join('/') || '';
          const isSyncing = syncing === app.metadata.name;
          const automated = app.spec?.syncPolicy?.automated;
          const isExpanded = expandedApp === app.metadata.name;

          // Phase 1A: Sync failure details
          const syncFailed = opState?.phase === 'Failed' || opState?.phase === 'Error';
          const syncMessage = opState?.message;

          // Phase 1B: Sync progress + duration
          const syncInProgress = opState?.phase === 'Running';
          const syncDuration = opState?.startedAt
            ? Math.round((Date.now() - new Date(opState.startedAt).getTime()) / 1000)
            : null;

          // Phase 1C: External URLs
          const externalURLs = app.status?.summary?.externalURLs || [];

          // Phase 1E: Deployed images
          const images = app.status?.summary?.images || [];

          // Pruning count
          const pruneCount = (app.status?.resources || []).filter(r => r.requiresPruning).length;

          return (
            <div key={app.metadata.uid || app.metadata.name}>
              <button
                type="button"
                className={cn('flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer w-full text-left', syncFailed && 'border-l-2 border-red-500')}
                onClick={() => setExpandedApp(isExpanded ? null : app.metadata.name)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <HealthIcon className={cn('w-5 h-5 shrink-0', healthColor)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => { e.stopPropagation(); go(`/r/argoproj.io~v1alpha1~applications/${app.metadata.namespace}/${app.metadata.name}`, app.metadata.name); }}
                        className="text-sm font-medium text-slate-200 hover:text-blue-400 transition-colors"
                      >
                        {app.metadata.name}
                      </button>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', SYNC_COLORS[sync?.status || 'Unknown'])}>
                        {sync?.status || 'Unknown'}
                      </span>
                      {automated && (
                        <span className="text-xs px-1.5 py-0.5 rounded-sm bg-violet-900/50 text-violet-300">Auto</span>
                      )}
                      {syncInProgress && (
                        <span className="text-xs px-1.5 py-0.5 rounded-sm bg-blue-900/50 text-blue-300 flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Syncing{syncDuration ? ` ${syncDuration}s` : ''}
                        </span>
                      )}
                      {syncFailed && (
                        <span className="text-xs px-1.5 py-0.5 rounded-sm bg-red-900/50 text-red-300 flex items-center gap-1">
                          <AlertOctagon className="w-2.5 h-2.5" /> Sync Failed
                        </span>
                      )}
                      {pruneCount > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-sm bg-amber-900/50 text-amber-300" title={`${pruneCount} resource${pruneCount > 1 ? 's' : ''} pending deletion`}>
                          {pruneCount} prune
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {repoName && <span className="text-xs text-slate-500 font-mono">{repoName}</span>}
                      {source?.path && <span className="text-xs text-slate-600">/{source.path}</span>}
                      {shortSha && <span className="text-xs text-slate-600 font-mono">{shortSha}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {externalURLs.length > 0 && (
                    <a
                      href={externalURLs[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5"
                      title="Open application"
                    >
                      <Globe className="w-3 h-3" />
                    </a>
                  )}
                  <span className="text-xs text-slate-500">{resourceCount} resources</span>
                  <span className="text-xs text-slate-600">{app.spec?.destination?.namespace || '—'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSync(app.metadata.name, app.metadata.namespace || '');
                    }}
                    disabled={isSyncing}
                    className="px-2 py-1 text-xs text-slate-400 rounded-sm hover:bg-blue-900/50 hover:text-blue-300 transition-colors disabled:opacity-50"
                    title="Trigger sync"
                  >
                    {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  <ArrowRight className={cn('w-3 h-3 text-slate-600 transition-transform', isExpanded && 'rotate-90')} />
                </div>
              </button>

              {/* Expanded detail panel */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-800/50 bg-slate-800/10">
                  {/* Sync error message (A) */}
                  {syncFailed && syncMessage && (
                    <div className="flex items-start gap-2 p-3 rounded-sm bg-red-950/20 border border-red-900/30 mt-3">
                      <AlertOctagon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-medium text-red-300">Sync Error</div>
                        <p className="text-xs text-red-400/80 mt-0.5 whitespace-pre-wrap">{syncMessage}</p>
                      </div>
                    </div>
                  )}

                  {/* Sync timing (B) */}
                  {opState?.startedAt && (
                    <div className="flex items-center gap-4 text-xs text-slate-500 mt-3">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Started: {new Date(opState.startedAt).toLocaleString()}
                      </span>
                      {opState.finishedAt && (
                        <span>
                          Duration: {Math.round((new Date(opState.finishedAt).getTime() - new Date(opState.startedAt).getTime()) / 1000)}s
                        </span>
                      )}
                      <span>Phase: {opState.phase}</span>
                    </div>
                  )}

                  {/* External URLs (C) */}
                  {externalURLs.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-slate-500 mb-1">Endpoints</div>
                      <div className="flex flex-wrap gap-2">
                        {externalURLs.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2 py-1 bg-slate-800 rounded-sm">
                            <Globe className="w-3 h-3" /> {url.replace(/^https?:\/\//, '').split('/')[0]}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deployed images (E) */}
                  {images.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-slate-500 mb-1">Images ({images.length})</div>
                      <div className="space-y-1">
                        {images.slice(0, 8).map((img, i) => {
                          const parts = img.split('/');
                          const short = parts.length > 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : img;
                          return (
                            <div key={i} className="flex items-center gap-1.5">
                              <Box className="w-3 h-3 text-slate-600" />
                              <span className="text-xs font-mono text-slate-400 truncate" title={img}>{short}</span>
                            </div>
                          );
                        })}
                        {images.length > 8 && <span className="text-xs text-slate-600">+{images.length - 8} more</span>}
                      </div>
                    </div>
                  )}

                  {/* Conditions */}
                  {(app.status?.conditions || []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-slate-500 mb-1">Conditions</div>
                      {(app.status?.conditions || []).map((cond, i) => (
                        <div key={i} className="text-xs text-amber-400/70 flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3" />
                          <span className="font-medium">{cond.type}:</span>
                          <span className="text-slate-400">{cond.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Condition Timeline */}
                  {(() => {
                    const conditionsWithTime = (app.status?.conditions || [])
                      .filter((c) => c.lastTransitionTime)
                      .sort((a, b) => new Date(b.lastTransitionTime!).getTime() - new Date(a.lastTransitionTime!).getTime());
                    if (conditionsWithTime.length === 0) return null;
                    return (
                      <div className="mt-2">
                        <div className="text-xs text-slate-500 mb-1">Condition Timeline</div>
                        <div className="relative ml-2 border-l border-slate-700 pl-3 space-y-2">
                          {conditionsWithTime.map((cond, i) => (
                            <div key={i} className="relative">
                              <div className="absolute left-[-15px] top-1 w-2 h-2 rounded-full bg-amber-500/70 border border-slate-800" />
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs font-medium text-amber-400/80">{cond.type}</span>
                                <span className="text-xs text-slate-600">{timeAgo(cond.lastTransitionTime!)}</span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5 truncate" title={cond.message}>{cond.message}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
