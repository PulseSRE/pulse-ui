/**
 * FleetAlertsView -- all firing alerts across all clusters in one table.
 * Shows correlation badges when the same alert fires on multiple clusters.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Loader2, Bell, XCircle, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAllConnections } from '../../engine/clusterConnection';
import { getClusterBase } from '../../engine/clusterConnection';
import { useFleetStore } from '../../store/fleetStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { formatDuration } from '../../engine/dateUtils';
import { CardHeader, CardBody } from '../../components/primitives/Card';
import type { FleetAlert } from '../../engine/types/incident';
import { FleetSubNav } from './FleetSubNav';
import { LoadError } from '../../components/primitives/LoadError';
import { errorReason } from '../../engine/readResult';

export default function FleetAlertsView() {
  const go = useNavigateTab();
  const setActiveCluster = useFleetStore((s) => s.setActiveCluster);

  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<FleetAlert[]>([]);
  const [failedClusters, setFailedClusters] = useState<Array<{ id: string; name: string; reason: string }>>([]);
  const [readCount, setReadCount] = useState(0);
  const [noClusters, setNoClusters] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchAlerts = useCallback(async () => {
    const clusters = getAllConnections().filter(c => c.status === 'connected');
    setNoClusters(clusters.length === 0);
    if (clusters.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const results = await Promise.allSettled(
        clusters.map(async (cluster) => {
          const base = getClusterBase(cluster.id);
          const res = await fetch(`${base}/api/v1/namespaces/openshift-monitoring/services/prometheus-k8s:web/proxy/api/v1/rules`);
          // A 403/404/503 is "could not read", not "no alerts".
          if (!res.ok) throw new Error(errorReason(res));
          const json = await res.json();
          const groups = json.data?.groups || [];

          const clusterAlerts: FleetAlert[] = [];
          for (const group of groups) {
            for (const rule of group.rules || []) {
              if (rule.type !== 'alerting') continue;
              for (const alert of rule.alerts || []) {
                if (alert.state !== 'firing' && alert.state !== 'pending') continue;
                clusterAlerts.push({
                  clusterId: cluster.id,
                  clusterName: cluster.name,
                  alertName: rule.name,
                  severity: alert.labels?.severity || rule.labels?.severity || 'none',
                  namespace: alert.labels?.namespace || '',
                  state: alert.state,
                  activeAt: alert.activeAt || '',
                  labels: alert.labels || {},
                  annotations: { ...rule.annotations, ...alert.annotations },
                });
              }
            }
          }
          return clusterAlerts;
        })
      );

      const allAlerts: FleetAlert[] = [];
      const failed: Array<{ id: string; name: string; reason: string }> = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          allAlerts.push(...r.value);
        } else {
          const reason = errorReason(r.reason);
          failed.push({ id: clusters[i].id, name: clusters[i].name, reason });
        }
      });
      setAlerts(allAlerts);
      setFailedClusters(failed);
      setReadCount(results.length - failed.length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // Correlation: count how many clusters have same alertname firing
  const correlationMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of alerts) {
      if (!map.has(a.alertName)) map.set(a.alertName, new Set());
      map.get(a.alertName)!.add(a.clusterId);
    }
    return map;
  }, [alerts]);

  // Unique cluster IDs for filter
  const clusterIds = useMemo(() =>
    Array.from(new Set(alerts.map(a => a.clusterId))),
    [alerts]
  );
  const clusterNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of alerts) map.set(a.clusterId, a.clusterName);
    return map;
  }, [alerts]);

  // Filter
  const filteredAlerts = useMemo(() => {
    let result = alerts;
    if (severityFilter !== 'all') {
      result = result.filter(a => a.severity === severityFilter);
    }
    if (clusterFilter !== 'all') {
      result = result.filter(a => a.clusterId === clusterFilter);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(a =>
        a.alertName.toLowerCase().includes(term) ||
        a.namespace.toLowerCase().includes(term) ||
        a.clusterName.toLowerCase().includes(term)
      );
    }
    return result;
  }, [alerts, severityFilter, clusterFilter, searchTerm]);

  // Sort: critical first, then warning, then alphabetical
  const sortedAlerts = useMemo(() => {
    const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2, none: 3 };
    return [...filteredAlerts].sort((a, b) => {
      const sa = sevOrder[a.severity] ?? 4;
      const sb = sevOrder[b.severity] ?? 4;
      if (sa !== sb) return sa - sb;
      return a.alertName.localeCompare(b.alertName);
    });
  }, [filteredAlerts]);

  const handleAlertClick = (alert: FleetAlert) => {
    setActiveCluster(alert.clusterId);
    go('/alerts', `${alert.clusterName} -- Alerts`);
  };

  const sevBadge = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-900/50 text-red-300',
      warning: 'bg-amber-900/50 text-amber-300',
      info: 'bg-blue-900/50 text-blue-300',
      none: 'bg-slate-800 text-slate-400',
    };
    return (
      <span className={cn('text-xs px-1.5 py-0.5 rounded-sm capitalize', colors[severity] || colors.none)}>
        {severity}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      </div>
    );
  }

  const failedBanner = failedClusters.length > 0 && (
    <LoadError
      title={`Alerts could not be read from ${failedClusters.length} of ${failedClusters.length + readCount} cluster${failedClusters.length + readCount !== 1 ? 's' : ''}`}
      error={failedClusters.map((c) => `${c.name}: ${c.reason}`).join(' · ')}
      onRetry={fetchAlerts}
    />
  );

  if (alerts.length === 0 && !loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center space-y-3 max-w-xl">
          {failedBanner}
          {noClusters ? (
            <>
              <XCircle className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-slate-400 text-sm">No reachable clusters</p>
              <p className="text-slate-600 text-xs">No connected cluster could be asked for alerts. Check cluster connectivity on the Fleet page.</p>
            </>
          ) : readCount > 0 && (
            <>
              <Bell className="w-10 h-10 text-slate-700 mx-auto" />
              <p className="text-slate-400 text-sm">
                No firing alerts on {failedClusters.length > 0 ? `the ${readCount} cluster${readCount !== 1 ? 's' : ''} that could be read` : 'any cluster in the fleet'}
              </p>
              {failedClusters.length === 0 && <p className="text-slate-600 text-xs">All clusters are quiet.</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {failedBanner && <div className="px-6 pt-4">{failedBanner}</div>}
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <FleetSubNav className="mb-3" />
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Bell className="w-5 h-5 text-red-400" />
              Fleet Alerts
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {alerts.length} firing alert{alerts.length !== 1 ? 's' : ''} across {clusterIds.length} cluster{clusterIds.length !== 1 ? 's' : ''}
              {criticalCount > 0 && <span className="text-red-400 ml-1">({criticalCount} critical)</span>}
              {warningCount > 0 && <span className="text-amber-400 ml-1">({warningCount} warning)</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Severity filter */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-sm px-2 py-1.5 text-slate-200"
              aria-label="Filter by severity"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            {/* Cluster filter */}
            <select
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-sm px-2 py-1.5 text-slate-200"
              aria-label="Filter by cluster"
            >
              <option value="all">All clusters</option>
              {clusterIds.map(id => (
                <option key={id} value={id}>{clusterNames.get(id) || id}</option>
              ))}
            </select>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search alerts..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-500 w-48"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="bg-slate-900 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Cluster</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Alert Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Severity</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Namespace</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sortedAlerts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  No alerts match the current filters
                </td>
              </tr>
            )}
            {sortedAlerts.map((alert, i) => {
              const correlationCount = correlationMap.get(alert.alertName)?.size || 0;
              return (
                <tr
                  key={`${alert.clusterId}-${alert.alertName}-${alert.namespace}-${i}`}
                  onClick={() => handleAlertClick(alert)}
                  className="hover:bg-slate-800/70 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm text-slate-200">{alert.clusterName}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-200">{alert.alertName}</span>
                      {correlationCount > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-sm bg-violet-900/50 text-violet-300 border border-violet-800/50">
                          Firing on {correlationCount} clusters
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{sevBadge(alert.severity)}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{alert.namespace || '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{alert.activeAt ? formatDuration(alert.activeAt) : '-'}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded-sm',
                      alert.state === 'firing' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'
                    )}>
                      {alert.state}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
