import React from 'react';
import { GitCommit, CheckCircle, Clock, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArgoApplication, ArgoSyncHistoryEntry } from '../../engine/types';
import { Card } from '../../components/primitives/Card';
import { buildCommitUrl } from '../../engine/gitUtils';
import { formatRelative, formatTimestamp } from '../../engine/format';

interface SyncHistoryTabProps {
  applications: ArgoApplication[];
  go: (path: string, title: string) => void;
}

interface FlatHistoryEntry extends ArgoSyncHistoryEntry {
  appName: string;
  appNamespace: string;
  repoURL?: string;
}

export function SyncHistoryTab({ applications, go }: SyncHistoryTabProps) {
  const allHistory = React.useMemo(() => {
    const entries: FlatHistoryEntry[] = [];
    for (const app of applications) {
      const source = app.spec?.source || app.spec?.sources?.[0];
      for (const h of app.status?.history || []) {
        entries.push({
          ...h,
          appName: app.metadata.name,
          appNamespace: app.metadata.namespace || '',
          repoURL: source?.repoURL,
        });
      }
    }
    return entries.sort((a, b) =>
      new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
    );
  }, [applications]);

  if (allHistory.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-slate-400 text-sm">No sync history available</p>
      </div>
    );
  }

  return (
    <Card>
      <div className="divide-y divide-slate-800">
        {allHistory.slice(0, 50).map((entry, i) => {
          const shortSha = entry.revision?.slice(0, 7);
          const deployedAt = new Date(entry.deployedAt);
          const ago = formatRelative(entry.deployedAt);
          const commitUrl = entry.repoURL && entry.revision
            ? buildCommitUrl(entry.repoURL, entry.revision)
            : null;

          return (
            <div key={`${entry.appName}-${entry.id}-${i}`} className="flex items-center gap-3 px-4 py-3">
              <GitCommit className="w-4 h-4 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => go(`/r/argoproj.io~v1alpha1~applications/${entry.appNamespace}/${entry.appName}`, entry.appName)}
                    className="text-sm font-medium text-blue-400 hover:text-blue-300"
                  >
                    {entry.appName}
                  </button>
                  {shortSha && (
                    commitUrl ? (
                      <a href={commitUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-slate-400 hover:text-blue-300 flex items-center gap-0.5">
                        {shortSha} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="text-xs font-mono text-slate-500">{shortSha}</span>
                    )
                  )}
                </div>
                {entry.source?.path && (
                  <span className="text-xs text-slate-600">{entry.source.path}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                <Clock className="w-3 h-3" />
                <span title={formatTimestamp(deployedAt)}>{ago}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
