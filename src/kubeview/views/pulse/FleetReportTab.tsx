/**
 * FleetReportTab — fleet health dashboard for multi-cluster mode.
 *
 * Displays cluster health table, fleet risk score, and ambient AI insight.
 * Reads directly from fleetStore — no props required.
 */

import React, { lazy, Suspense, useMemo, useState } from 'react';
import { Globe, RefreshCw, Loader2 } from 'lucide-react';

import { useFleetStore } from '../../store/fleetStore';
import { Card } from '../../components/primitives/Card';
import { cn } from '@/lib/utils';

const AmbientInsight = lazy(() =>
  import('../../components/agent/AmbientInsight').then((m) => ({
    default: m.AmbientInsight,
  }))
);

/* ---------------------------------------------------------------------------
 * Status helpers
 * --------------------------------------------------------------------------- */

type ClusterStatus = 'connected' | 'unreachable' | 'auth-expired' | 'unknown';

const STATUS_CONFIG: Record<ClusterStatus, { color: string; bg: string; label: string }> = {
  connected: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', label: 'Connected' },
  unreachable: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', label: 'Unreachable' },
  'auth-expired': { color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)', label: 'Auth Expired' },
  unknown: { color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', label: 'Unknown' },
};

function statusDot(status: ClusterStatus) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        data-testid={`status-dot-${status}`}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: cfg.color,
          display: 'inline-block',
        }}
      />
      <span
        style={{
          fontSize: 12,
          color: cfg.color,
          backgroundColor: cfg.bg,
          padding: '2px 8px',
          borderRadius: 4,
        }}
      >
        {cfg.label}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Risk score
 * --------------------------------------------------------------------------- */

function computeRiskScore(
  clusters: { status: string }[]
): { score: number; color: string; label: string } {
  if (clusters.length === 0) return { score: 100, color: '#22c55e', label: 'Healthy' };

  const unhealthy = clusters.filter(
    (c) => c.status === 'unreachable' || c.status === 'auth-expired'
  ).length;

  const score = Math.round(100 - (unhealthy / clusters.length) * 100);

  if (score > 80) return { score, color: '#22c55e', label: 'Healthy' };
  if (score >= 60) return { score, color: '#eab308', label: 'Degraded' };
  return { score, color: '#ef4444', label: 'Critical' };
}

/* ---------------------------------------------------------------------------
 * Table styles
 * --------------------------------------------------------------------------- */

const tableStyles = {
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '1px solid rgb(51 65 85)',
    color: '#94a3b8',
    fontWeight: 500,
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid rgb(30 41 59)',
    color: '#e2e8f0',
  },
  tr: {
    transition: 'background-color 0.15s',
  },
};

/* ---------------------------------------------------------------------------
 * FleetReportTab
 * --------------------------------------------------------------------------- */

export function FleetReportTab() {
  const { clusters, fleetMode, refreshAllHealth } = useFleetStore();

  const risk = useMemo(() => computeRiskScore(clusters), [clusters]);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAllHealth();
    } finally {
      setRefreshing(false);
    }
  };

  if (fleetMode === 'single') {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
        Fleet reporting is available in multi-cluster mode.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-slate-100">Fleet Health</h2>
          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
            {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm transition-colors',
            'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Refresh All
        </button>
      </div>

      {/* Risk Score */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">
              Fleet Risk Score
            </div>
            <div className="flex items-center gap-3">
              <span
                data-testid="risk-score"
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: risk.color,
                }}
              >
                {risk.score}
              </span>
              <span
                data-testid="risk-badge"
                style={{
                  fontSize: 12,
                  color: risk.color,
                  backgroundColor:
                    risk.score > 80
                      ? 'rgba(34, 197, 94, 0.15)'
                      : risk.score >= 60
                        ? 'rgba(234, 179, 8, 0.15)'
                        : 'rgba(239, 68, 68, 0.15)',
                  padding: '3px 10px',
                  borderRadius: 4,
                  fontWeight: 500,
                }}
              >
                {risk.label}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            {clusters.filter((c) => c.status === 'connected').length} / {clusters.length}{' '}
            clusters healthy
          </div>
        </div>
      </Card>

      {/* Cluster Table */}
      <Card className="p-0 overflow-hidden">
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.th}>Name</th>
              <th style={tableStyles.th}>Status</th>
              <th style={tableStyles.th}>Nodes</th>
              <th style={tableStyles.th}>Version</th>
              <th style={tableStyles.th}>Environment</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((cluster) => (
              <tr
                key={cluster.id}
                style={tableStyles.tr}
                className="hover:bg-slate-800/50"
              >
                <td style={tableStyles.td}>
                  <span className="font-medium">{cluster.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {cluster.connectionType}
                  </span>
                </td>
                <td style={tableStyles.td}>
                  {statusDot(cluster.status as ClusterStatus)}
                </td>
                <td style={tableStyles.td}>
                  {cluster.metadata?.nodeCount ?? '\u2014'}
                </td>
                <td style={tableStyles.td}>
                  <span className="text-slate-400">
                    {cluster.metadata?.version ?? '\u2014'}
                  </span>
                </td>
                <td style={tableStyles.td}>
                  <span className="text-slate-400">
                    {cluster.environment ?? '\u2014'}
                  </span>
                </td>
              </tr>
            ))}
            {clusters.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...tableStyles.td, textAlign: 'center', color: '#64748b' }}
                >
                  No clusters registered
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Ambient Insight */}
      <Suspense
        fallback={
          <Card className="p-4">
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading fleet analysis...
            </div>
          </Card>
        }
      >
        <AmbientInsight
          context={{ kind: 'Fleet', name: 'all-clusters', namespace: undefined }}
          prompt="Analyze fleet health across all connected clusters. Identify patterns, drift, and risks."
        />
      </Suspense>
    </div>
  );
}
