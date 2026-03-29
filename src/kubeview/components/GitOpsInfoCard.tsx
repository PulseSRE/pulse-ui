/**
 * GitOpsInfoCard — shows Git commit, repo, path, and sync info for ArgoCD-managed resources.
 * Only renders for resources managed by ArgoCD.
 */

import React from 'react';
import { GitBranch, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useArgoSyncInfo } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { Card } from './primitives/Card';
import { buildCommitUrl } from '../engine/gitUtils';

interface GitOpsInfoCardProps {
  kind: string;
  namespace?: string;
  name: string;
}

export function GitOpsInfoCard({ kind, namespace, name }: GitOpsInfoCardProps) {
  const available = useArgoCDStore((s) => s.available);
  const syncInfo = useArgoSyncInfo(kind, namespace, name);
  const go = useNavigateTab();

  if (!available || !syncInfo) return null;

  const shortSha = syncInfo.revision?.slice(0, 7);
  const repoName = syncInfo.repoURL?.replace(/^https?:\/\//, '').replace(/\.git$/, '') || '';
  const shortRepo = repoName.split('/').slice(-2).join('/');

  // Build commit URL for the Git provider
  const commitUrl = syncInfo.revision && syncInfo.repoURL
    ? buildCommitUrl(syncInfo.repoURL, syncInfo.revision)
    : null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-slate-100">GitOps</span>
        <span className={cn('text-xs px-1.5 py-0.5 rounded',
          syncInfo.syncStatus === 'Synced' ? 'bg-emerald-900/50 text-emerald-300' :
          syncInfo.syncStatus === 'OutOfSync' ? 'bg-amber-900/50 text-amber-300' :
          'bg-slate-800 text-slate-400'
        )}>
          {syncInfo.syncStatus}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        {/* Application */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Application</span>
          <button
            onClick={() => go(`/r/argoproj.io~v1alpha1~applications/${syncInfo.appNamespace}/${syncInfo.appName}`, syncInfo.appName)}
            className="text-blue-400 hover:text-blue-300 font-medium"
          >
            {syncInfo.appName}
          </button>
        </div>

        {/* Repository */}
        {syncInfo.repoURL && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Repository</span>
            <a
              href={syncInfo.repoURL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 font-mono text-xs"
            >
              {shortRepo} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Path */}
        {syncInfo.path && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Path</span>
            <span className="text-slate-300 font-mono text-xs">{syncInfo.path}</span>
          </div>
        )}

        {/* Commit */}
        {shortSha && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Commit</span>
            {commitUrl ? (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 font-mono text-xs flex items-center gap-1"
              >
                {shortSha} <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <span className="text-slate-300 font-mono text-xs">{shortSha}</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
