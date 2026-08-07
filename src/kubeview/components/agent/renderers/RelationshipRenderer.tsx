/**
 * Relationship tree renderer: relationship_tree + TreeNode + DynamicComponentFallback.
 */

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { DynamicComponent } from '../DynamicComponent';
import type {
  ComponentSpec,
  RelationshipTreeSpec,
} from '../../../engine/agentComponents';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<string, string> = {
  Deployment: '🚀', StatefulSet: '📦', DaemonSet: '🔄', ReplicaSet: '📋',
  Pod: '🟢', Job: '⚡', CronJob: '⏰', Service: '🌐', ConfigMap: '📝',
  Secret: '🔒', Node: '🖥️', Namespace: '📁', Ingress: '🌍', Route: '🛣️',
  PersistentVolumeClaim: '💾', HorizontalPodAutoscaler: '📈',
};

const TREE_STATUS_COLORS: Record<string, string> = {
  healthy: 'border-emerald-500', warning: 'border-amber-500',
  error: 'border-red-500', pending: 'border-blue-500', unknown: 'border-slate-600',
};

const TREE_STATUS_BG: Record<string, string> = {
  healthy: 'bg-emerald-500/10', warning: 'bg-amber-500/10',
  error: 'bg-red-500/10', pending: 'bg-blue-500/10', unknown: 'bg-slate-800',
};

// ---------------------------------------------------------------------------
// TreeNode
// ---------------------------------------------------------------------------

export function TreeNode({ node, nodes, depth = 0, visited = new Set<string>() }: { node: RelationshipTreeSpec['nodes'][0]; nodes: Map<string, RelationshipTreeSpec['nodes'][0]>; depth?: number; visited?: Set<string> }) {
  // Guard against infinite recursion from cycles or excessive depth
  if (depth > 10 || visited.has(node.id)) return null;
  visited.add(node.id);
  const children = (node.children || []).map((id) => nodes.get(id)).filter(Boolean);
  const icon = KIND_ICONS[node.kind] || '📄';
  const statusBorder = TREE_STATUS_COLORS[node.status || 'unknown'] || TREE_STATUS_COLORS.unknown;
  const statusBg = TREE_STATUS_BG[node.status || 'unknown'] || TREE_STATUS_BG.unknown;
  const link = node.gvr && node.namespace
    ? `/r/${node.gvr}/${node.namespace}/${node.name}`
    : node.gvr ? `/r/${node.gvr}/_/${node.name}` : null;

  return (
    <div className={depth > 0 ? 'ml-6 relative' : ''}>
      {depth > 0 && (
        <>
          <div className="absolute left-[-16px] top-0 h-5 w-4 border-l-2 border-b-2 border-slate-700 rounded-bl" />
          {/* Vertical connector line for siblings */}
        </>
      )}
      <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border-l-2 mb-1', statusBorder, statusBg)}>
        <span className="text-sm">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {link ? (
              <a href={link} className="text-xs font-medium text-blue-400 hover:text-blue-300">{node.kind}/{node.name}</a>
            ) : (
              <span className="text-xs font-medium text-slate-200">{node.kind}/{node.name}</span>
            )}
            {node.status && node.status !== 'unknown' && (
              <span className={cn('text-[9px] px-1 rounded-sm', node.status === 'healthy' ? 'bg-emerald-900/50 text-emerald-400' : node.status === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-amber-900/50 text-amber-400')}>
                {node.status}
              </span>
            )}
          </div>
          {node.detail && <span className="text-[10px] text-slate-500">{node.detail}</span>}
        </div>
      </div>
      {children.length > 0 && (
        <div className="relative">
          {children.map((child) => child && (
            <TreeNode key={child.id} node={child} nodes={nodes} depth={depth + 1} visited={visited} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relationship Tree
// ---------------------------------------------------------------------------

export function AgentRelationshipTree({ spec, onAddToView }: { spec: RelationshipTreeSpec; onAddToView?: (spec: ComponentSpec) => void }) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, RelationshipTreeSpec['nodes'][0]>();
    for (const n of spec.nodes || []) m.set(n.id, n);
    return m;
  }, [spec.nodes]);

  const root = nodeMap.get(spec.rootId);

  return (
    <div className="my-2 border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
      <div className="px-3 py-1.5 border-b border-slate-700 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-slate-300">{spec.title || 'Resource Relationships'}</span>
          {spec.description && <span className="text-[10px] text-slate-500 ml-2">{spec.description}</span>}
        </div>
        {onAddToView && (
          <button onClick={() => onAddToView(spec)} className="p-0.5 text-slate-500 hover:text-emerald-400 rounded-sm transition-colors" title="Add to View">
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-3">
        {root ? (
          <TreeNode node={root} nodes={nodeMap} />
        ) : (
          <span className="text-xs text-slate-500">No root node found</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic Component Fallback
// ---------------------------------------------------------------------------

export function DynamicComponentFallback({ spec }: { spec: ComponentSpec }) {
  const raw = spec as unknown as Record<string, unknown>;
  const title = raw.title as string | undefined;
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-4">
      {title && <div className="text-xs font-medium text-slate-300 mb-2">{title}</div>}
      <DynamicComponent spec={raw} />
    </div>
  );
}
