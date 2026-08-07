/**
 * ArgoSyncBadge — shows sync status for ArgoCD-managed resources.
 * Renders nothing if the resource is not managed by ArgoCD or ArgoCD is unavailable.
 */

import React from 'react';
import { GitBranch, CheckCircle, AlertTriangle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useArgoSyncInfo } from '../hooks/useArgoCD';
import { useArgoCDStore } from '../store/argoCDStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import type { ArgoSyncStatus } from '../engine/types';

interface ArgoSyncBadgeProps {
  kind: string;
  namespace?: string;
  name: string;
  showLabel?: boolean; // Show "Synced"/"OutOfSync" text (default: false for inline, true for detail)
}

const SYNC_CONFIG: Record<ArgoSyncStatus, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  Synced: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-900/50 border-emerald-800/50', label: 'Synced' },
  OutOfSync: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-900/50 border-amber-800/50', label: 'OutOfSync' },
  Unknown: { icon: HelpCircle, color: 'text-slate-400', bg: 'bg-slate-800 border-slate-700', label: 'Unknown' },
};

export function ArgoSyncBadge({ kind, namespace, name, showLabel = false }: ArgoSyncBadgeProps) {
  const available = useArgoCDStore((s) => s.available);
  const syncInfo = useArgoSyncInfo(kind, namespace, name);
  const go = useNavigateTab();

  if (!available || !syncInfo) return null;

  const config = SYNC_CONFIG[syncInfo.syncStatus];
  const Icon = config.icon;
  const shortSha = syncInfo.revision?.slice(0, 7);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (syncInfo.appNamespace) {
      go(
        `/r/argoproj.io~v1alpha1~applications/${syncInfo.appNamespace}/${syncInfo.appName}`,
        syncInfo.appName
      );
    }
  };

  if (showLabel) {
    return (
      <button
        onClick={handleClick}
        className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-sm text-xs border transition-colors hover:brightness-110', config.bg)}
        title={`ArgoCD: ${config.label} · App: ${syncInfo.appName}${shortSha ? ` · ${shortSha}` : ''}`}
      >
        <GitBranch className="w-3 h-3 text-slate-500" />
        <Icon className={cn('w-3 h-3', config.color)} />
        <span className={config.color}>{config.label}</span>
        {shortSha && <span className="text-slate-500 font-mono">{shortSha}</span>}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={cn('inline-flex items-center gap-0.5 p-0.5 rounded-sm transition-colors hover:bg-slate-800')}
      title={`ArgoCD: ${config.label} · App: ${syncInfo.appName}${shortSha ? ` · ${shortSha}` : ''}`}
    >
      <GitBranch className="w-3 h-3 text-slate-600" />
      <Icon className={cn('w-2.5 h-2.5', config.color)} />
    </button>
  );
}
