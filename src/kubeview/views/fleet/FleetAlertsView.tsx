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

export default function FleetAlertsView() {
  const go = useNavigateTab();
  const setActiveCluster = useFleetStore((s) => s.setActiveCluster);

  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<FleetAlert[]>([]);
  const [fetchError, setFetchError] = useState(false);
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
          if (!res.ok) return [];
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
      let anySucceeded = false;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          anySucceeded = true;
          allAlerts.push(...r.value);
        }
      }
      setAlerts(allAlerts);
      setFetchError(!anySucceeded && results.length > 0);
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

  if (alerts.length === 0 && !loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-center space-y-2">
          {fetchError ? (
            <>
              <XCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-red-300 text-sm">Unable to reach alerting backend</p>
              <p className="text-slate-500 text-xs">Check that Prometheus/Alertmanager is configured and accessible on your clusters.</p>
              <button
                onClick={fetchAlerts}
                className="mt-2 px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <Bell className="w-10 h-10 text-slate-700 mx-auto" />
              <p className="text-slate-400 text-sm">No firing alerts across the fleet</p>
              <p className="text-slate-600 text-xs">All clusters are quiet. Check back later or verify cluster connectivity.</p>
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
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
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
