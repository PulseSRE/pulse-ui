/**
 * ResourceHistoryPanel — shows sync history for a specific ArgoCD-managed resource.
 * Displays the parent Application's status.history entries (commits that deployed this resource).
 */

import React from 'react';
import { GitCommit, Clock, ExternalLink, History } from 'lucide-react';
import { useArgoCDStore } from '../../store/argoCDStore';
import { useArgoSyncInfo } from '../../hooks/useArgoCD';
import { Card } from '../../components/primitives/Card';
import type { ArgoApplication, ArgoSyncHistoryEntry } from '../../engine/types';

interface ResourceHistoryPanelProps {
  kind: string;
  namespace?: string;
  name: string;
}

export function ResourceHistoryPanel({ kind, namespace, name }: ResourceHistoryPanelProps) {
  const syncInfo = useArgoSyncInfo(kind, namespace, name);
  const applications = useArgoCDStore((s) => s.applications);

  // Find the parent application
  const parentApp = React.useMemo(() => {
    if (!syncInfo) return undefined;
    return applications.find(
      (app) =>
        app.metadata.name === syncInfo.appName &&
        (app.metadata.namespace || '') === syncInfo.appNamespace
    );
  }, [syncInfo, applications]);

  if (!syncInfo || !parentApp) return null;

  const history = parentApp.status?.history || [];
  if (history.length === 0) return null;

  const source = parentApp.spec?.source || parentApp.spec?.sources?.[0];
  const repoURL = source?.repoURL;

  // Sort by deployedAt descending
  const sorted = [...history].sort(
    (a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
  );

  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <History className="w-4 h-4 text-violet-400" />
          Sync History
          <span className="text-xs text-slate-500 font-normal">
            via {syncInfo.appName}
          </span>
        </h2>
      </div>
      <div className="divide-y divide-slate-800">
        {sorted.slice(0, 20).map((entry, i) => {
          const shortSha = entry.revision?.slice(0, 7);
          const deployedAt = new Date(entry.deployedAt);
          const timeAgo = getTimeAgo(deployedAt);
          const commitUrl =
            repoURL && entry.revision
              ? buildCommitUrl(repoURL, entry.revision)
              : null;

          return (
            <div
              key={`${entry.id}-${i}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <GitCommit className="w-4 h-4 text-violet-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {shortSha &&
                    (commitUrl ? (
                      <a
                        href={commitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                      >
                        {shortSha} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="text-xs font-mono text-slate-400">
                        {shortSha}
                      </span>
                    ))}
                </div>
                {entry.source?.path && (
                  <span className="text-xs text-slate-600">
                    {entry.source.path}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                <Clock className="w-3 h-3" />
                <span title={deployedAt.toLocaleString()}>{timeAgo}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function getTimeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function buildCommitUrl(repoURL: string, revision: string): string | null {
  try {
    const clean = repoURL.replace(/\.git$/, '');
    if (clean.includes('github.com')) return `${clean}/commit/${revision}`;
    if (clean.includes('gitlab')) return `${clean}/-/commit/${revision}`;
    if (clean.includes('bitbucket.org'))
      return `${clean}/commits/${revision}`;
    return `${clean}/commit/${revision}`;
  } catch {
    return null;
  }
}
