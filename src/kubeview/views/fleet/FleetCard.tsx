/**
 * FleetCard — individual cluster card in the fleet dashboard.
 * Shows health score, key metrics, status, and drift indicator.
 */

import React from 'react';
import {
  AlertTriangle, Wifi, WifiOff,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClusterConnection } from '../../engine/clusterConnection';
import { computeHealthScore, healthGradeColor, type HealthScoreInput } from '../../engine/healthScore';
import { Card } from '../../components/primitives/Card';

interface FleetCardProps {
  cluster: ClusterConnection;
  healthInput?: HealthScoreInput;
  onClick: () => void;
}

const ENV_COLORS: Record<string, string> = {
  prod: 'bg-red-900/50 text-red-300 border-red-800/50',
  production: 'bg-red-900/50 text-red-300 border-red-800/50',
  staging: 'bg-amber-900/50 text-amber-300 border-amber-800/50',
  dev: 'bg-blue-900/50 text-blue-300 border-blue-800/50',
  development: 'bg-blue-900/50 text-blue-300 border-blue-800/50',
  dr: 'bg-violet-900/50 text-violet-300 border-violet-800/50',
  edge: 'bg-cyan-900/50 text-cyan-300 border-cyan-800/50',
};

export function FleetCard({ cluster, healthInput, onClick }: FleetCardProps) {
  const health = healthInput
    ? computeHealthScore(healthInput)
    : { score: cluster.status === 'connected' ? 100 : 0, grade: cluster.status === 'connected' ? 'healthy' as const : 'critical' as const, color: cluster.status === 'connected' ? 'text-emerald-400' : 'text-red-400', factors: [] };

  const isReachable = cluster.status === 'connected';
  const envClass = ENV_COLORS[cluster.environment?.toLowerCase() || ''] || 'bg-slate-800 text-slate-400 border-slate-700';

  return (
    <button
      onClick={onClick}
      className="w-full text-left group"
    >
      <Card className={cn(
        'p-4 transition-all hover:border-slate-600',
        health.grade === 'critical' && 'border-red-800/50',
        health.grade === 'degraded' && 'border-orange-800/50',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', healthGradeColor(health.grade))} />
            <span className="text-sm font-semibold text-slate-100 truncate">{cluster.name}</span>
            {cluster.environment && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded-sm border shrink-0', envClass)}>
                {cluster.environment}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isReachable ? (
              <Wifi className="w-3 h-3 text-emerald-500" />
            ) : (
              <WifiOff className="w-3 h-3 text-red-400" />
            )}
            <ArrowRight className="w-3 h-3 text-slate-700 group-hover:text-blue-400 transition-colors" />
          </div>
        </div>

        {/* Health Score */}
        <div className="flex items-end gap-3 mb-3">
          <div className={cn('text-3xl font-bold tabular-nums', health.color)}>
            {isReachable ? health.score : '—'}
          </div>
          <div className="text-xs text-slate-500 pb-1">
            {isReachable ? (
              health.grade === 'healthy' ? 'All systems go' :
              health.factors.length > 0 ? health.factors[0].detail : health.grade
            ) : (
              cluster.status === 'auth-expired' ? 'Auth expired' : 'Unreachable'
            )}
          </div>
        </div>

        {/* Metrics row */}
        {isReachable && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Nodes</div>
              <div className="font-mono text-slate-300">
                {healthInput ? `${healthInput.nodeReadyCount}/${healthInput.nodeCount}` : cluster.metadata?.nodeCount || '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Version</div>
              <div className="font-mono text-slate-300 truncate">
                {cluster.metadata?.version?.replace('v', '') || '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Alerts</div>
              <div className={cn('font-mono', healthInput && (healthInput.alertCriticalCount > 0) ? 'text-red-400' : 'text-slate-300')}>
                {healthInput ? healthInput.alertCriticalCount + healthInput.alertWarningCount : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Health factors (if degraded) */}
        {health.factors.length > 0 && health.grade !== 'healthy' && (
          <div className="mt-3 pt-3 border-t border-slate-800 space-y-1">
            {health.factors.slice(0, 2).map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-slate-400">{f.label}: {f.detail}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </button>
  );
}
