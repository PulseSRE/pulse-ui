import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, AlertTriangle, XCircle, CheckCircle, Clock, Search, VolumeX, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { resourceDetailUrl } from '../engine/gvr';
import { kindToPlural } from '../engine/renderers/index';
import { Card, CardHeader, CardBody } from '../components/primitives/Card';

interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt?: string;
  value?: string;
}

interface AlertGroup {
  name: string;
  rules: Array<{
    name: string;
    query: string;
    state: string;
    health: string;
    alerts: PrometheusAlert[];
    labels: Record<string, string>;
    annotations: Record<string, string>;
    duration: number;
    type: string;
  }>;
}

interface Silence {
  id: string;
  status: { state: string };
  matchers: Array<{ name: string; value: string; isRegex: boolean }>;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
}

type Tab = 'firing' | 'rules' | 'silences';

export default function AlertsView() {
  const go = useNavigateTab();
  const addToast = useUIStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<Tab>('firing');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch alerts from Prometheus
  const { data: alertGroups = [] } = useQuery<AlertGroup[]>({
    queryKey: ['alerts', 'rules'],
    queryFn: async () => {
      const res = await fetch('/api/prometheus/api/v1/rules');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.groups || [];
    },
    refetchInterval: 30000,
  });

  // Fetch silences from Alertmanager
  const { data: silences = [] } = useQuery<Silence[]>({
    queryKey: ['alerts', 'silences'],
    queryFn: async () => {
      const res = await fetch('/api/alertmanager/api/v2/silences');
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Extract all firing/pending alerts
  const allAlerts = useMemo(() => {
    const alerts: Array<{ rule: string; group: string; alert: PrometheusAlert; severity: string; description: string }> = [];
    for (const group of alertGroups) {
      for (const rule of group.rules) {
        if (rule.type !== 'alerting') continue;
        for (const alert of rule.alerts || []) {
          if (alert.state === 'firing' || alert.state === 'pending') {
            alerts.push({
              rule: rule.name,
              group: group.name,
              alert,
              severity: alert.labels.severity || rule.labels?.severity || 'warning',
              description: alert.annotations?.description || alert.annotations?.message || rule.annotations?.description || '',
            });
          }
        }
      }
    }
    return alerts.sort((a, b) => {
      const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
    });
  }, [alertGroups]);

  // All alerting rules
  const allRules = useMemo(() => {
    const rules: Array<{ name: string; group: string; state: string; severity: string; query: string; alertCount: number }> = [];
    for (const group of alertGroups) {
      for (const rule of group.rules) {
        if (rule.type !== 'alerting') continue;
        rules.push({
          name: rule.name,
          group: group.name,
          state: rule.state,
          severity: rule.labels?.severity || 'warning',
          query: rule.query,
          alertCount: (rule.alerts || []).filter((a) => a.state === 'firing').length,
        });
      }
    }
    return rules;
  }, [alertGroups]);

  // Active silences
  const activeSilences = useMemo(() => {
    return silences.filter((s) => s.status.state === 'active');
  }, [silences]);

  // Filter
  const filteredAlerts = useMemo(() => {
    if (!searchQuery) return allAlerts;
    const q = searchQuery.toLowerCase();
    return allAlerts.filter((a) => a.rule.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.alert.labels.namespace?.toLowerCase().includes(q));
  }, [allAlerts, searchQuery]);

  const filteredRules = useMemo(() => {
    if (!searchQuery) return allRules;
    const q = searchQuery.toLowerCase();
    return allRules.filter((r) => r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q));
  }, [allRules, searchQuery]);

  const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
  const warningCount = allAlerts.filter((a) => a.severity === 'warning').length;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Bell className="w-6 h-6 text-red-500" />
              Alerts
            </h1>
            <p className="text-sm text-slate-400 mt-1">Prometheus alerts, rules, and silences</p>
          </div>
          {allAlerts.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-800 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-green-300">No alerts firing</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {criticalCount > 0 && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/30 border border-red-800 rounded-lg text-sm font-medium text-red-300">
                  <XCircle className="w-4 h-4" /> {criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-900/30 border border-yellow-800 rounded-lg text-sm font-medium text-yellow-300">
                  <AlertTriangle className="w-4 h-4" /> {warningCount} warning
                </span>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card onClick={() => setActiveTab('firing')}>
            <CardBody>
              <div className="text-xs text-slate-400 mb-1">Firing Alerts</div>
              <div className="text-xl font-bold text-slate-100">{allAlerts.filter(a => a.alert.state === 'firing').length}</div>
            </CardBody>
          </Card>
          <Card onClick={() => setActiveTab('rules')}>
            <CardBody>
              <div className="text-xs text-slate-400 mb-1">Alert Rules</div>
              <div className="text-xl font-bold text-slate-100">{allRules.length}</div>
            </CardBody>
          </Card>
          <Card onClick={() => setActiveTab('silences')}>
            <CardBody>
              <div className="text-xs text-slate-400 mb-1">Active Silences</div>
              <div className="text-xl font-bold text-slate-100">{activeSilences.length}</div>
            </CardBody>
          </Card>
        </div>

        {/* Tabs + Search */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
            {([
              { id: 'firing' as Tab, label: `Firing (${allAlerts.length})` },
              { id: 'rules' as Tab, label: `Rules (${allRules.length})` },
              { id: 'silences' as Tab, label: `Silences (${activeSilences.length})` },
            ]).map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('px-3 py-1.5 text-xs rounded-md transition-colors', activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search alerts..." className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Firing alerts */}
        {activeTab === 'firing' && (
          <div className="space-y-2">
            {filteredAlerts.length === 0 ? (
              <div className="text-center py-12"><CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" /><p className="text-slate-300">No alerts firing</p></div>
            ) : (
              filteredAlerts.map((item, idx) => {
                // Build link to affected resource
                const labels = item.alert.labels;
                const resourceName = labels.pod || labels.deployment || labels.node || labels.statefulset || labels.daemonset || labels.job || '';
                const resourceKind = labels.pod ? 'Pod' : labels.deployment ? 'Deployment' : labels.node ? 'Node' : labels.statefulset ? 'StatefulSet' : labels.daemonset ? 'DaemonSet' : labels.job ? 'Job' : '';
                const resourceNs = labels.namespace;
                const hasResource = resourceName && resourceKind;

                return (
                <Card key={idx} onClick={hasResource ? () => {
                  const apiVersion = resourceKind === 'Deployment' || resourceKind === 'StatefulSet' || resourceKind === 'DaemonSet' ? 'apps/v1' : resourceKind === 'Job' ? 'batch/v1' : 'v1';
                  go(resourceDetailUrl({ apiVersion, kind: resourceKind, metadata: { name: resourceName, namespace: resourceNs } }), resourceName);
                } : undefined}>
                  <div className="px-4 py-3 flex items-start gap-3">
                    {item.severity === 'critical' ? <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-slate-200">{item.rule}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', item.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>{item.severity}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', item.alert.state === 'firing' ? 'bg-red-900/50 text-red-300' : 'bg-blue-900/50 text-blue-300')}>{item.alert.state}</span>
                      </div>
                      {/* Affected resource link */}
                      {hasResource && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-blue-400">{resourceKind}/{resourceName}</span>
                          {resourceNs && <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{resourceNs}</span>}
                        </div>
                      )}
                      {!hasResource && labels.namespace && (
                        <button onClick={(e) => { e.stopPropagation(); useUIStore.getState().setSelectedNamespace(labels.namespace); go('/r/v1~pods', 'Pods'); }} className="text-xs text-blue-400 hover:text-blue-300 mb-1 block">
                          {labels.namespace} →
                        </button>
                      )}
                      {item.description && <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                        {item.alert.activeAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Since {new Date(item.alert.activeAt).toLocaleString()}</span>}
                        <span>{item.group}</span>
                        {hasResource && <span className="text-blue-400">Click to investigate →</span>}
                      </div>
                    </div>
                  </div>
                </Card>
                );
              })
            )}
          </div>
        )}

        {/* Rules */}
        {activeTab === 'rules' && (
          <Card>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {filteredRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/30 cursor-pointer"
                  onClick={() => {
                    try { navigator.clipboard.writeText(rule.query); } catch {}
                    addToast({ type: 'success', title: 'PromQL copied', detail: rule.query.slice(0, 80) });
                  }}
                >
                  {rule.alertCount > 0 ? <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-200 font-medium">{rule.name}</span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', rule.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>{rule.severity}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5 truncate">{rule.query}</div>
                  </div>
                  {rule.alertCount > 0 && <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{rule.alertCount} firing</span>}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Silences */}
        {activeTab === 'silences' && (
          <div className="space-y-2">
            {activeSilences.length === 0 ? (
              <div className="text-center py-12"><VolumeX className="w-10 h-10 text-slate-600 mx-auto mb-3" /><p className="text-slate-400">No active silences</p></div>
            ) : (
              activeSilences.map((silence) => (
                <Card key={silence.id}>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <VolumeX className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-200">{silence.comment || 'No comment'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">{silence.status.state}</span>
                    </div>
                    <div className="space-y-1 mb-2">
                      {silence.matchers.map((m, i) => (
                        <span key={i} className="text-xs font-mono text-slate-400 mr-2">
                          {m.name}{m.isRegex ? '=~' : '='}{m.value}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span>By: {silence.createdBy}</span>
                      <span>Ends: {new Date(silence.endsAt).toLocaleString()}</span>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
