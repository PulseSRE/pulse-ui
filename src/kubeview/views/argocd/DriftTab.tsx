import React from 'react';
import {
  AlertTriangle, CheckCircle, RefreshCw, Loader2, ArrowRight, ChevronDown, ChevronRight, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArgoApplication, ArgoManagedResource, ArgoSyncStatus } from '../../engine/types';
import { Card } from '../../components/primitives/Card';
import { ResourceDiffPanel } from './ResourceDiffPanel';

interface DriftTabProps {
  applications: ArgoApplication[];
  onSync: (name: string, namespace: string) => void;
  syncing: string | null;
  go: (path: string, title: string) => void;
}

const SYNC_COLORS: Record<ArgoSyncStatus, string> = {
  Synced: 'text-emerald-400',
  OutOfSync: 'text-amber-400',
  Unknown: 'text-slate-400',
};

export function DriftTab({ applications, onSync, syncing, go }: DriftTabProps) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [expandedDiffs, setExpandedDiffs] = React.useState<Set<string>>(new Set());

  const toggleDiff = (key: string) => {
    setExpandedDiffs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const outOfSyncApps = React.useMemo(() =>
    applications.filter(a => a.status?.sync?.status === 'OutOfSync'),
  [applications]);

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  if (outOfSyncApps.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-emerald-300 text-sm font-medium">All applications are in sync</p>
          <p className="text-slate-500 text-xs mt-1">No drift detected between Git and cluster state</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {outOfSyncApps.map((app) => {
        const isExpanded = expanded.has(app.metadata.name);
        const resources = app.status?.resources || [];
        const outOfSyncResources = resources.filter(r => r.status === 'OutOfSync');
        const syncedResources = resources.filter(r => r.status === 'Synced');
        const isSyncing = syncing === app.metadata.name;

        return (
          <Card key={app.metadata.uid || app.metadata.name}>
            <button
              onClick={() => toggleExpand(app.metadata.name)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-300">{app.metadata.name}</span>
                <span className="text-xs text-slate-500">{outOfSyncResources.length} out of sync</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSync(app.metadata.name, app.metadata.namespace || '');
                  }}
                  disabled={isSyncing}
                  className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Sync
                </button>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-slate-800 divide-y divide-slate-800/50">
                {/* Out of sync resources first */}
                {outOfSyncResources.map((r, i) => {
                  const diffKey = `${app.metadata.name}-${r.kind}-${r.namespace}-${r.name}`;
                  return (
                    <React.Fragment key={`${r.kind}-${r.namespace}-${r.name}-${i}`}>
                      <ResourceRow
                        resource={r}
                        go={go}
                        showDiff={expandedDiffs.has(diffKey)}
                        onToggleDiff={() => toggleDiff(diffKey)}
                      />
                      {expandedDiffs.has(diffKey) && (
                        <ResourceDiffPanel
                          resource={r}
                          appName={app.metadata.name}
                          appNamespace={app.metadata.namespace || ''}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
                {/* Synced resources (dimmed) */}
                {syncedResources.length > 0 && (
                  <div className="px-4 py-2 text-xs text-slate-600">
                    {syncedResources.length} synced resource{syncedResources.length !== 1 ? 's' : ''} (hidden)
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ResourceRow({ resource, go, showDiff, onToggleDiff }: {
  resource: ArgoManagedResource;
  go: (path: string, title: string) => void;
  showDiff?: boolean;
  onToggleDiff?: () => void;
}) {
  const gvr = resource.group
    ? `${resource.group}~${resource.version}~${resource.kind.toLowerCase()}s`
    : `${resource.version}~${resource.kind.toLowerCase()}s`;

  return (
    <div
      className="flex items-center justify-between px-4 py-2 pl-12 hover:bg-slate-800/20 cursor-pointer transition-colors"
      onClick={() => go(`/r/${gvr}/${resource.namespace || '_'}/${resource.name}`, resource.name)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
          resource.status === 'OutOfSync' ? 'bg-amber-500' : 'bg-emerald-500'
        )} />
        <span className="text-xs text-slate-500">{resource.kind}</span>
        <span className="text-sm text-slate-300">{resource.name}</span>
        {resource.namespace && <span className="text-xs text-slate-600">{resource.namespace}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {resource.requiresPruning && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-300" title="Will be deleted on next sync with prune enabled">
            prune
          </span>
        )}
        <span className={cn('text-xs', SYNC_COLORS[resource.status])}>
          {resource.status}
        </span>
        {resource.health && (
          <span className={cn('text-xs',
            resource.health.status === 'Healthy' ? 'text-emerald-400' :
            resource.health.status === 'Degraded' ? 'text-red-400' :
            'text-slate-500'
          )}>
            {resource.health.status}
          </span>
        )}
        {onToggleDiff && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleDiff(); }}
            className={cn(
              'px-1.5 py-0.5 text-xs rounded flex items-center gap-1 transition-colors',
              showDiff
                ? 'bg-violet-900/50 text-violet-300'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
            )}
            title="View live state"
          >
            <Eye className="w-3 h-3" />
            View
          </button>
        )}
        <ArrowRight className="w-3 h-3 text-slate-600" />
      </div>
    </div>
  );
}
