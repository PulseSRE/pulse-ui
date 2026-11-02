import React from 'react';
import {
  FileText,
  Trash2,
  Terminal,
  FileCode,
  ArrowLeft,
  GitBranch,
  Copy,
  Star,
  Bug,
  ChevronRight,
  Activity,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import { StatusBadge } from '../../components/primitives/StatusBadge';
import { ActionMenu } from '../../components/primitives/ActionMenu';
import { ArgoSyncBadge } from '../../components/ArgoSyncBadge';
import { useWorkloadActions } from '../../components/workloads/WorkloadActionMenu';
import { routeUrl } from '../../engine/workloadActions';
import { NodeHeaderActions } from './NodeHeaderActions';

interface DetailViewHeaderProps {
  resource: K8sResource;
  namespace?: string;
  name: string;
  gvrUrl: string;
  resourcePlural: string;
  starred: boolean;
  currentPath: string;
  actionLoading: string | null;
  isWorkload: boolean;
  canDelete: boolean;
  onNavigateBack: () => void;
  onGoToList: () => void;
  onGoToListFiltered: () => void;
  onCopyName: () => void;
  onToggleFavorite: () => void;
  onViewLogs: () => void;
  onOpenTerminal: () => void;
  onDebug: () => void;
  /** Why Debug is not offered (RBAC); the button is then disabled with this as its title. */
  debugDisabledReason?: string;
  onViewYaml: () => void;
  onViewMetrics: () => void;
  onViewDeps: () => void;
  /** Why Dependencies is unavailable (e.g. a remote cluster); the item is then disabled with this as its title. */
  depsUnavailable?: string;
  onViewNodeLogs?: () => void;
  onOpenProject?: () => void;
  onDeleteRequest: () => void;
}

export function DetailViewHeader({
  resource,
  namespace,
  name,
  gvrUrl,
  resourcePlural,
  starred,
  actionLoading,
  isWorkload,
  canDelete,
  onNavigateBack,
  onGoToList,
  onGoToListFiltered,
  onCopyName,
  onToggleFavorite,
  onViewLogs,
  onOpenTerminal,
  onDebug,
  debugDisabledReason,
  onViewYaml,
  onViewMetrics,
  onViewDeps,
  depsUnavailable,
  onViewNodeLogs,
  onOpenProject,
  onDeleteRequest,
}: DetailViewHeaderProps) {
  // Kind-specific actions (scale, restart, pause, trigger, re-run, restart pod…)
  // join the "more actions" menu; the header keeps Logs, Terminal and Delete.
  const workload = useWorkloadActions(resource, { context: 'detail', onDeleted: onGoToList });
  const url = resource.kind === 'Route' ? routeUrl(resource) : null;

  return (
    <div className="flex items-start justify-between">
      <div>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm mb-1" aria-label="Breadcrumb">
          <button
            onClick={onNavigateBack}
            className="p-1 rounded-sm hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            title="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onGoToList}
            className="text-blue-400 hover:text-blue-300 capitalize"
            data-testid="breadcrumb-kind"
          >
            {resourcePlural}
          </button>
          {namespace && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              <button
                onClick={onGoToListFiltered}
                className="text-blue-400 hover:text-blue-300"
                data-testid="breadcrumb-namespace"
              >
                {namespace}
              </button>
            </>
          )}
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
          <span className="text-slate-400" data-testid="breadcrumb-name">{name}</span>
        </nav>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-slate-100">{resource.metadata.name}</h1>
          <button
            onClick={onCopyName}
            className="p-1 rounded-sm text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            title="Copy name"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggleFavorite}
            className={cn('p-1 rounded-sm transition-colors', starred ? 'text-yellow-400 hover:text-yellow-300' : 'text-slate-500 hover:text-yellow-400 hover:bg-slate-800')}
            title={starred ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={cn('w-3.5 h-3.5', starred && 'fill-current')} />
          </button>
          {resource.metadata.namespace && (
            <span className="px-2 py-1 text-xs bg-purple-900/50 text-purple-300 rounded-sm border border-purple-700">
              {resource.metadata.namespace}
            </span>
          )}
          <StatusBadge resource={resource} />
          <ArgoSyncBadge kind={resource.kind} namespace={resource.metadata.namespace} name={resource.metadata.name} showLabel />
        </div>
        <p className="text-sm text-slate-400">
          {resource.kind} · {resource.apiVersion}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {/* Primary actions */}
        {(resource.kind === 'Pod' || isWorkload) && namespace && (
          <button onClick={onViewLogs} className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
            <FileText className="w-3.5 h-3.5" /> Logs
          </button>
        )}
        {(resource.kind === 'Pod' || resource.kind === 'Node') && (
          <>
            <button onClick={onOpenTerminal} className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
              <Terminal className="w-3.5 h-3.5" /> Terminal
            </button>
            {!resource.metadata.labels?.['openshiftpulse/debug'] && (
            <button onClick={onDebug} disabled={!!actionLoading || !!debugDisabledReason} title={debugDisabledReason} className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-amber-400 flex items-center gap-1.5 transition-colors disabled:opacity-50">
              <Bug className={cn('w-3.5 h-3.5', actionLoading === 'debug' && 'animate-pulse')} />
              {actionLoading === 'debug' ? 'Creating...' : 'Debug'}
            </button>
            )}
          </>
        )}
        {resource.kind === 'Node' && onViewNodeLogs && (
          <button onClick={onViewNodeLogs} className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
            <FileText className="w-3.5 h-3.5" /> Node logs
          </button>
        )}
        {resource.kind === 'Node' && <NodeHeaderActions node={resource} />}
        {(resource.kind === 'Namespace' || resource.kind === 'Project') && onOpenProject && (
          <button onClick={onOpenProject} className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-blue-400 flex items-center gap-1.5 transition-colors">
            <Activity className="w-3.5 h-3.5" /> Open project dashboard
          </button>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-blue-400 flex items-center gap-1.5 transition-colors"
            title={url}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open URL
          </a>
        )}
        <button onClick={onViewYaml} className="px-2.5 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-blue-400 flex items-center gap-1.5 transition-colors">
          <FileCode className="w-3.5 h-3.5" /> YAML
        </button>

        {/* More actions dropdown */}
        <ActionMenu
          items={[
            ...workload.items,
            ...(workload.items.length ? ['separator' as const] : []),
            { icon: <Activity className="w-3.5 h-3.5" />, label: 'Metrics', onClick: onViewMetrics },
            namespace ? {
              icon: <GitBranch className="w-3.5 h-3.5" />,
              label: depsUnavailable ? 'Dependencies (local cluster only)' : 'Dependencies',
              onClick: onViewDeps,
              disabled: !!depsUnavailable,
              title: depsUnavailable,
            } : null,
            'separator',
            { icon: <Trash2 className={cn('w-3.5 h-3.5', canDelete ? 'text-red-400' : 'text-slate-600')} />, label: canDelete ? 'Delete' : 'Delete (no permission)', onClick: onDeleteRequest, danger: canDelete, disabled: !canDelete, title: canDelete ? undefined : 'No delete permission' },
          ]}
        />
        {workload.dialog}
      </div>
    </div>
  );
}
