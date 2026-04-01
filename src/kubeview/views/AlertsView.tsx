import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, AlertTriangle, XCircle, CheckCircle, Clock, Search, VolumeX, ArrowRight, Plus, Trash2, X, ExternalLink, Filter, Activity, BookOpen, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { resourceDetailUrl } from '../engine/gvr';
import { kindToPlural } from '../engine/renderers/index';
import { Card, CardHeader, CardBody } from '../components/primitives/Card';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';
import { MetricCard } from '../components/metrics/Sparkline';
import { CHART_COLORS } from '../engine/colors';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { showErrorToast } from '../engine/errorToast';
import { copyToClipboard } from '../engine/clipboard';
import { EmptyState } from '../components/primitives/EmptyState';
import type { PrometheusAlert } from '../engine/types/incident';

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

interface SilenceMatcher {
  name: string;
  value: string;
  isRegex: boolean;
}

interface SilenceFormData {
  matchers: SilenceMatcher[];
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
}

export default function AlertsView() {
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const { data: currentUser = 'admin' } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const res = await fetch('/api/kubernetes/apis/user.openshift.io/v1/users/~');
      if (!res.ok) return 'admin';
      const data = await res.json();
      return data.metadata?.name || 'admin';
    },
    staleTime: 300000,
  });
  const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab;
  const [activeTab, setActiveTabState] = useState<Tab>(urlTab || 'firing');
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'firing') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  };
  const urlParams = new URLSearchParams(window.location.search);
  const [searchQuery, setSearchQuery] = useState(urlParams.get('q') || '');
  const [severityFilter, setSeverityFilterState] = useState<'all' | 'critical' | 'warning' | 'info'>((urlParams.get('severity') as 'all' | 'critical' | 'warning' | 'info') || 'all');
  const [groupBy, setGroupByState] = useState<'none' | 'namespace' | 'alertname'>((urlParams.get('groupBy') as 'none' | 'namespace' | 'alertname') || 'none');
  const updateUrlParam = (key: string, value: string, defaultValue: string) => {
    const url = new URL(window.location.href);
    if (value === defaultValue) url.searchParams.delete(key); else url.searchParams.set(key, value);
    window.history.replaceState(null, '', url.toString());
  };
  const setSeverityFilter = (v: typeof severityFilter) => { setSeverityFilterState(v); updateUrlParam('severity', v, 'all'); };
  const setGroupBy = (v: typeof groupBy) => { setGroupByState(v); updateUrlParam('groupBy', v, 'none'); };
  const [showSilenceForm, setShowSilenceForm] = useState(false);
  const [silenceForm, setSilenceForm] = useState<SilenceFormData>({
    matchers: [{ name: 'alertname', value: '', isRegex: false }],
    startsAt: '',
    endsAt: '',
    createdBy: '',
    comment: '',
  });
  const [confirmExpire, setConfirmExpire] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch alerts from Prometheus
  const { data: alertGroups = [], error: alertsError, refetch: refetchAlerts } = useQuery<AlertGroup[]>({
    queryKey: ['alerts', 'rules'],
    queryFn: async () => {
      const res = await fetch('/api/prometheus/api/v1/rules');
      if (!res.ok) throw new Error(`Prometheus returned ${res.status} ${res.statusText}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('Prometheus endpoint returned non-JSON response — is THANOS_URL configured?');
      const json = await res.json();
      return json.data?.groups || [];
    },
    refetchInterval: 30000,
    retry: 1,
  });

  // Fetch silences from Alertmanager
  const { data: silences = [], error: silencesError, refetch: refetchSilences } = useQuery<Silence[]>({
    queryKey: ['alerts', 'silences'],
    queryFn: async () => {
      const res = await fetch('/api/alertmanager/api/v2/silences');
      if (!res.ok) throw new Error(`Alertmanager returned ${res.status} ${res.statusText}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('Alertmanager endpoint returned non-JSON response — is ALERTMANAGER_URL configured?');
      return res.json();
    },
    refetchInterval: 60000,
    retry: 1,
  });

  const backendUnavailable = !!(alertsError || silencesError);

  // Active silences (needed before allAlerts for silenced check)
  const activeSilences = useMemo(() => {
    return silences.filter((s) => s.status.state === 'active');
  }, [silences]);

  // Extract all firing/pending alerts
  const allAlerts = useMemo(() => {
    const alerts: Array<{
      rule: string; group: string; alert: PrometheusAlert; severity: string;
      description: string; runbookUrl: string; firingDuration: string;
      isSilenced: boolean; namespace: string;
    }> = [];
    for (const group of alertGroups) {
      for (const rule of group.rules) {
        if (rule.type !== 'alerting') continue;
        for (const alert of rule.alerts || []) {
          if (alert.state === 'firing' || alert.state === 'pending') {
            // Compute firing duration
            let firingDuration = '';
            if (alert.activeAt) {
              const ms = Date.now() - new Date(alert.activeAt).getTime();
              if (ms > 86400000) firingDuration = `${Math.floor(ms / 86400000)}d ${Math.floor((ms % 86400000) / 3600000)}h`;
              else if (ms > 3600000) firingDuration = `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
              else firingDuration = `${Math.floor(ms / 60000)}m`;
            }

            // Check if silenced
            const isSilenced = activeSilences.some(silence =>
              silence.matchers.every(m => {
                const labelVal = alert.labels[m.name] || '';
                if (m.isRegex) { try { return new RegExp(m.value).test(labelVal); } catch { return false; } }
                return labelVal === m.value;
              })
            );

            alerts.push({
              rule: rule.name,
              group: group.name,
              alert,
              severity: alert.labels.severity || rule.labels?.severity || 'warning',
              description: alert.annotations?.description || alert.annotations?.message || rule.annotations?.description || '',
              runbookUrl: alert.annotations?.runbook_url || rule.annotations?.runbook_url || '',
              firingDuration,
              isSilenced,
              namespace: alert.labels.namespace || '',
            });
          }
        }
      }
    }
    // Filter by namespace if selected
    const filtered = selectedNamespace === '*' ? alerts
      : alerts.filter((a) => !a.namespace || a.namespace === selectedNamespace);

    return filtered.sort((a, b) => {
      const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
    });
  }, [alertGroups, selectedNamespace, activeSilences]);

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

  // Separate pending from firing
  const firingAlerts = useMemo(() => allAlerts.filter(a => a.alert.state === 'firing'), [allAlerts]);
  const pendingAlerts = useMemo(() => allAlerts.filter(a => a.alert.state === 'pending'), [allAlerts]);

  // Filter
  const filteredAlerts = useMemo(() => {
    let result = allAlerts;
    if (severityFilter !== 'all') result = result.filter(a => a.severity === severityFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => a.rule.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.namespace.toLowerCase().includes(q));
    }
    return result;
  }, [allAlerts, searchQuery, severityFilter]);

  // Group alerts
  const groupedAlerts = useMemo(() => {
    if (groupBy === 'none') return null;
    const groups = new Map<string, typeof filteredAlerts>();
    for (const alert of filteredAlerts) {
      const key = groupBy === 'namespace' ? (alert.namespace || '(cluster-scoped)') : alert.rule;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(alert);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredAlerts, groupBy]);

  // Top alertnames by frequency
  const topAlertNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of allAlerts) counts.set(a.rule, (counts.get(a.rule) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [allAlerts]);

  const filteredRules = useMemo(() => {
    if (!searchQuery) return allRules;
    const q = searchQuery.toLowerCase();
    return allRules.filter((r) => r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q));
  }, [allRules, searchQuery]);

  const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
  const warningCount = allAlerts.filter((a) => a.severity === 'warning').length;

  // Silence helpers
  const resetSilenceForm = () => {
    setSilenceForm({
      matchers: [{ name: 'alertname', value: '', isRegex: false }],
      startsAt: '',
      endsAt: '',
      createdBy: currentUser,
      comment: '',
    });
    setShowSilenceForm(false);
  };

  const setDuration = (hours: number) => {
    const now = new Date();
    const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
    setSilenceForm((prev) => ({
      ...prev,
      startsAt: now.toISOString(),
      endsAt: end.toISOString(),
    }));
  };

  const addMatcher = () => {
    setSilenceForm((prev) => ({
      ...prev,
      matchers: [...prev.matchers, { name: '', value: '', isRegex: false }],
    }));
  };

  const updateMatcher = (idx: number, field: keyof SilenceMatcher, value: string | boolean) => {
    setSilenceForm((prev) => {
      const updated = [...prev.matchers];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, matchers: updated };
    });
  };

  const removeMatcher = (idx: number) => {
    setSilenceForm((prev) => ({
      ...prev,
      matchers: prev.matchers.filter((_, i) => i !== idx),
    }));
  };

  const openSilenceFormForAlert = (labels: Record<string, string>) => {
    const matchers: SilenceMatcher[] = Object.entries(labels).map(([name, value]) => ({
      name,
      value,
      isRegex: false,
    }));
    setSilenceForm({
      matchers,
      startsAt: '',
      endsAt: '',
      createdBy: currentUser,
      comment: '',
    });
    setShowSilenceForm(true);
    setActiveTab('silences');
  };

  const createSilence = async () => {
    if (!silenceForm.comment.trim()) {
      addToast({ type: 'error', title: 'Comment required', detail: 'Please provide a reason for this silence' });
      return;
    }
    if (!silenceForm.startsAt || !silenceForm.endsAt) {
      addToast({ type: 'error', title: 'Duration required', detail: 'Please select a duration' });
      return;
    }
    if (silenceForm.matchers.length === 0 || silenceForm.matchers.some((m) => !m.name || !m.value)) {
      addToast({ type: 'error', title: 'Matchers required', detail: 'All matchers must have name and value' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/alertmanager/api/v2/silences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(silenceForm),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `HTTP ${res.status}`);
      }

      addToast({ type: 'success', title: 'Silence created', detail: silenceForm.comment });
      queryClient.invalidateQueries({ queryKey: ['alerts', 'silences'] });
      resetSilenceForm();
    } catch (err: any) {
      showErrorToast(err, 'Failed to create silence');
    } finally {
      setIsSubmitting(false);
    }
  };

  const expireSilence = async (id: string) => {
    try {
      const res = await fetch(`/api/alertmanager/api/v2/silence/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `HTTP ${res.status}`);
      }

      addToast({ type: 'success', title: 'Silence expired', detail: `Silence ${id} has been removed` });
      queryClient.invalidateQueries({ queryKey: ['alerts', 'silences'] });
    } catch (err: any) {
      showErrorToast(err, 'Failed to expire silence');
    }
    setConfirmExpire(null);
  };

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
          {backendUnavailable ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg">
              <XCircle className="w-5 h-5 text-red-400" />
              <span className="text-sm font-medium text-red-300">Backend unavailable</span>
            </div>
          ) : allAlerts.length === 0 ? (
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button onClick={() => { setActiveTab('firing'); setSeverityFilter('all'); }} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', firingAlerts.length > 0 ? 'border-red-800' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">Firing</div>
            <div className="text-xl font-bold text-slate-100">{firingAlerts.length}</div>
          </button>
          <button onClick={() => { setActiveTab('firing'); setSeverityFilter('all'); }} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', pendingAlerts.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">Pending</div>
            <div className="text-xl font-bold text-slate-100">{pendingAlerts.length}</div>
            <div className="text-xs text-slate-600 mt-0.5">About to fire</div>
          </button>
          <button onClick={() => setActiveTab('silences')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Silenced</div>
            <div className="text-xl font-bold text-slate-100">{allAlerts.filter(a => a.isSilenced).length}</div>
          </button>
          <button onClick={() => setActiveTab('rules')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Alert Rules</div>
            <div className="text-xl font-bold text-slate-100">{allRules.length}</div>
          </button>
          <button onClick={() => setActiveTab('silences')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Active Silences</div>
            <div className="text-xl font-bold text-slate-100">{activeSilences.length}</div>
          </button>
        </div>

        {/* Alert metrics */}
        {allAlerts.length > 0 && (
          <MetricGrid>
            <MetricCard title="Alert Rate" query="sum(ALERTS)" unit="" color={CHART_COLORS.red} />
            <MetricCard title="Critical Alerts" query="sum(ALERTS{severity='critical'})" unit="" color={CHART_COLORS.darkRed} />
            <MetricCard title="Warning Alerts" query="sum(ALERTS{severity='warning'})" unit="" color={CHART_COLORS.amber} />
            <MetricCard title="Alertmanager Notifications" query="sum(rate(alertmanager_notifications_total[5m])) * 300" unit="/5m" color={CHART_COLORS.violet} />
          </MetricGrid>
        )}

        {/* Top firing alerts */}
        {topAlertNames.length > 0 && allAlerts.length > 3 && (
          <Card className="p-4">
            <div className="text-xs text-slate-500 font-medium mb-2">Most frequent alerts</div>
            <div className="flex flex-wrap gap-2">
              {topAlertNames.map(([name, count]) => (
                <button key={name} onClick={() => setSearchQuery(name)} className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors">
                  <span className="font-medium">{name}</span>
                  <span className="text-slate-500">×{count}</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Tabs + Search + Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-slate-900 rounded-lg p-1" role="tablist" aria-label="Alert tabs">
            {([
              { id: 'firing' as Tab, label: `Firing (${allAlerts.length})` },
              { id: 'rules' as Tab, label: `Rules (${allRules.length})` },
              { id: 'silences' as Tab, label: `Silences (${activeSilences.length})` },
            ]).map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={cn('px-3 py-1.5 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search alerts..." className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {activeTab === 'firing' && (
            <>
              {/* Severity filter */}
              <div className="flex bg-slate-900 rounded-lg border border-slate-700 text-xs">
                {(['all', 'critical', 'warning', 'info'] as const).map((sev) => (
                  <button key={sev} onClick={() => setSeverityFilter(sev)} className={cn('px-2.5 py-1.5 capitalize transition-colors',
                    severityFilter === sev ? (sev === 'critical' ? 'bg-red-600 text-white rounded-lg' : sev === 'warning' ? 'bg-yellow-600 text-white rounded-lg' : 'bg-blue-600 text-white rounded-lg') : 'text-slate-400 hover:text-slate-200')}>
                    {sev}
                  </button>
                ))}
              </div>
              {/* Group by */}
              <div className="flex bg-slate-900 rounded-lg border border-slate-700 text-xs">
                {([{ id: 'none', label: 'Flat' }, { id: 'namespace', label: 'By Namespace' }, { id: 'alertname', label: 'By Alert' }] as const).map((g) => (
                  <button key={g.id} onClick={() => setGroupBy(g.id)} className={cn('px-2.5 py-1.5 transition-colors', groupBy === g.id ? 'bg-blue-600 text-white rounded-lg' : 'text-slate-400 hover:text-slate-200')}>
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Firing alerts */}
        {activeTab === 'firing' && (
          <div className="space-y-2">
            {backendUnavailable ? (
              <EmptyState
                icon={<XCircle className="w-8 h-8 text-red-400" />}
                title="Unable to reach alerting backend"
                description={
                  (alertsError?.message || silencesError?.message || '').includes('configured')
                    ? 'The Prometheus or Alertmanager proxy is not configured. Set THANOS_URL and ALERTMANAGER_URL environment variables and restart the dev server.'
                    : 'Check that Prometheus and Alertmanager are configured and accessible.'
                }
                action={{ label: 'Retry', onClick: () => { refetchAlerts(); refetchSilences(); } }}
              />
            ) : filteredAlerts.length === 0 ? (
              <EmptyState
                icon={<Bell className="w-8 h-8" />}
                title={severityFilter !== 'all' ? `No ${severityFilter} alerts` : 'No alerts firing'}
                description="Your cluster is healthy — no alerts are currently firing."
              />
            ) : groupedAlerts ? (
              // Grouped view
              groupedAlerts.map(([groupName, alerts]) => (
                <Card key={groupName}>
                  <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-200">{groupName}</span>
                    <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{alerts.length}</span>
                  </div>
                  <div className="divide-y divide-slate-800">
                    {alerts.map((item, idx) => <AlertRow key={idx} item={item} go={go} onSilence={openSilenceFormForAlert} />)}
                  </div>
                </Card>
              ))
            ) : (
              // Flat view
              filteredAlerts.map((item, idx) => (
                <Card key={idx}>
                  <AlertRow item={item} go={go} onSilence={openSilenceFormForAlert} />
                </Card>
              ))
            )}
          </div>
        )}

        {/* Rules */}
        {activeTab === 'rules' && (
          filteredRules.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="w-8 h-8" />}
              title="No alert rules found"
              description="Alert rules are configured in Prometheus. Make sure Alertmanager is connected and accessible."
            />
          ) : (
          <Card>
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
              {filteredRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/30 cursor-pointer"
                  onClick={() => copyToClipboard(rule.query, 'PromQL copied')}
                >
                  {rule.alertCount > 0 ? <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-200 font-medium">{rule.name}</span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded', rule.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300')}>{rule.severity}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5 truncate">{rule.query}</div>
                  </div>
                  {rule.alertCount > 0 && <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-300 rounded">{rule.alertCount} firing</span>}
                </div>
              ))}
            </div>
          </Card>
          )
        )}

        {/* Silences */}
        {activeTab === 'silences' && (
          <div className="space-y-3">
            {/* Create Silence Button */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  resetSilenceForm();
                  setShowSilenceForm(true);
                }}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create Silence
              </button>
            </div>

            {/* Silence Creation Form */}
            {showSilenceForm && (
              <Card>
                <div className="px-4 py-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200">New Silence</h3>
                    <button onClick={resetSilenceForm} className="text-slate-400 hover:text-slate-200" aria-label="Close">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Matchers */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">Matchers</label>
                    <div className="space-y-2">
                      {silenceForm.matchers.map((matcher, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Label name"
                            value={matcher.name}
                            onChange={(e) => updateMatcher(idx, 'name', e.target.value)}
                            className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            placeholder="Value"
                            value={matcher.value}
                            onChange={(e) => updateMatcher(idx, 'value', e.target.value)}
                            className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <label className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={matcher.isRegex}
                              onChange={(e) => updateMatcher(idx, 'isRegex', e.target.checked)}
                              className="rounded border-slate-700"
                            />
                            Regex
                          </label>
                          {silenceForm.matchers.length > 1 && (
                            <button
                              onClick={() => removeMatcher(idx)}
                              className="p-1 text-red-400 hover:text-red-300"
                              aria-label="Remove matcher"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={addMatcher}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        Add matcher
                      </button>
                    </div>
                  </div>

                  {/* Duration Presets */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">Duration</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: '1h', hours: 1 },
                        { label: '2h', hours: 2 },
                        { label: '4h', hours: 4 },
                        { label: '8h', hours: 8 },
                        { label: '24h', hours: 24 },
                        { label: '7d', hours: 168 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => setDuration(preset.hours)}
                          className={cn(
                            'px-3 py-1.5 text-xs rounded border',
                            silenceForm.endsAt && Math.abs(new Date(silenceForm.endsAt).getTime() - new Date(silenceForm.startsAt).getTime() - preset.hours * 60 * 60 * 1000) < 1000
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {silenceForm.startsAt && silenceForm.endsAt && (
                      <p className="text-xs text-slate-500 mt-2">
                        Ends: {new Date(silenceForm.endsAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {/* Comment */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">Comment (required)</label>
                    <textarea
                      value={silenceForm.comment}
                      onChange={(e) => setSilenceForm((prev) => ({ ...prev, comment: e.target.value }))}
                      placeholder="Explain why this alert is being silenced..."
                      rows={3}
                      className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Creator */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-2">Created by</label>
                    <input
                      type="text"
                      value={silenceForm.createdBy}
                      onChange={(e) => setSilenceForm((prev) => ({ ...prev, createdBy: e.target.value }))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={resetSilenceForm}
                      className="px-4 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={createSilence}
                      disabled={isSubmitting}
                      className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? 'Creating...' : 'Create Silence'}
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {/* Active Silences */}
            {activeSilences.length === 0 && !showSilenceForm ? (
              <EmptyState
                icon={<BellOff className="w-8 h-8" />}
                title="No active silences"
                description="Silences temporarily mute alerts. Create one to suppress a noisy alert during maintenance."
              />
            ) : (
              activeSilences.map((silence) => (
                <Card key={silence.id}>
                  <div className="px-4 py-3 flex items-start gap-3">
                    <VolumeX className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-slate-200">{silence.comment || 'No comment'}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">{silence.status.state}</span>
                      </div>
                      <div className="space-y-1 mb-2">
                        {silence.matchers.map((m, i) => (
                          <span key={i} className="text-xs font-mono text-slate-400 mr-2">
                            {m.name}{m.isRegex ? '=~' : '='}{m.value}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>By: {silence.createdBy}</span>
                        <span>Ends: {new Date(silence.endsAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmExpire(silence.id)}
                      className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Expire
                    </button>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Expire Confirmation Dialog */}
        <ConfirmDialog
          open={!!confirmExpire}
          onClose={() => setConfirmExpire(null)}
          title="Expire Silence"
          description="Are you sure you want to expire this silence? Alerts matching this silence will start firing again."
          confirmLabel="Expire"
          variant="danger"
          onConfirm={() => confirmExpire && expireSilence(confirmExpire)}
        />
      </div>
    </div>
  );
}

// ===== Alert Row Component =====

function AlertRow({ item, go, onSilence }: {
  item: { rule: string; group: string; alert: PrometheusAlert; severity: string; description: string; runbookUrl: string; firingDuration: string; isSilenced: boolean; namespace: string };
  go: (path: string, title: string) => void;
  onSilence: (labels: Record<string, string>) => void;
}) {
  const labels = item.alert.labels;
  const resourceName = labels.pod || labels.deployment || labels.node || labels.statefulset || labels.daemonset || labels.job || '';
  const resourceKind = labels.pod ? 'Pod' : labels.deployment ? 'Deployment' : labels.node ? 'Node' : labels.statefulset ? 'StatefulSet' : labels.daemonset ? 'DaemonSet' : labels.job ? 'Job' : '';
  const resourceNs = labels.namespace;
  const hasResource = resourceName && resourceKind;

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      {item.severity === 'critical' ? <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{item.rule}</span>
          <span className={cn('text-xs px-1.5 py-0.5 rounded', item.severity === 'critical' ? 'bg-red-900/50 text-red-300' : item.severity === 'warning' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-blue-900/50 text-blue-300')}>{item.severity}</span>
          <span className={cn('text-xs px-1.5 py-0.5 rounded', item.alert.state === 'firing' ? 'bg-red-900/50 text-red-300' : 'bg-blue-900/50 text-blue-300')}>{item.alert.state}</span>
          {item.isSilenced && <span className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded flex items-center gap-1"><VolumeX className="w-2.5 h-2.5" /> silenced</span>}
          {item.firingDuration && <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {item.firingDuration}</span>}
        </div>

        {hasResource && (
          <button onClick={() => {
            const apiVersion = resourceKind === 'Deployment' || resourceKind === 'StatefulSet' || resourceKind === 'DaemonSet' ? 'apps/v1' : resourceKind === 'Job' ? 'batch/v1' : 'v1';
            go(resourceDetailUrl({ apiVersion, kind: resourceKind, metadata: { name: resourceName, namespace: resourceNs } }), resourceName);
          }} className="flex items-center gap-2 mb-1 text-xs text-blue-400 hover:text-blue-300">
            {resourceKind}/{resourceName}
            {resourceNs && <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{resourceNs}</span>}
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        {!hasResource && item.namespace && (
          <button onClick={() => { useUIStore.getState().setSelectedNamespace(item.namespace); go('/r/v1~pods', 'Pods'); }} className="text-xs text-blue-400 hover:text-blue-300 mb-1 block">
            {item.namespace} →
          </button>
        )}

        {item.description && <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>}

        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span>{item.group}</span>
          {item.runbookUrl && (
            <a href={item.runbookUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
              <ExternalLink className="w-3 h-3" /> Runbook
            </a>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onSilence(item.alert.labels); }}
        className={cn('px-2.5 py-1.5 text-xs rounded flex items-center gap-1.5 flex-shrink-0 transition-colors',
          item.isSilenced ? 'bg-slate-700 text-slate-400' : 'bg-blue-600 hover:bg-blue-700 text-white')}
        title={item.isSilenced ? 'Already silenced' : 'Silence this alert'}
      >
        <VolumeX className="w-3.5 h-3.5" />
        {item.isSilenced ? 'Silenced' : 'Silence'}
      </button>
    </div>
  );
}
