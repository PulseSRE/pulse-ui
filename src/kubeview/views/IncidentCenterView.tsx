import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Siren, Zap, Search, Wrench, Clock, Settings, Play, Activity, Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../components/primitives/Card';
import { fetchAgentEvalStatus } from '../engine/evalStatus';
import { useMonitorStore } from '../store/monitorStore';
import { useUIStore } from '../store/uiStore';
import { useTrustStore, type TrustLevel } from '../store/trustStore';
import { NowTab } from './incidents/NowTab';
import { InvestigateTab } from './incidents/InvestigateTab';
import { ActionsTab } from './incidents/ActionsTab';
import { HistoryTab } from './incidents/HistoryTab';

type IncidentTab = 'now' | 'investigate' | 'actions' | 'history' | 'config';

const TABS = [
  { id: 'now' as IncidentTab, label: 'Now', icon: Zap },
  { id: 'investigate' as IncidentTab, label: 'Investigate', icon: Search },
  { id: 'actions' as IncidentTab, label: 'Actions', icon: Wrench },
  { id: 'history' as IncidentTab, label: 'History', icon: Clock },
  { id: 'config' as IncidentTab, label: 'Config', icon: Settings },
] as const;

const TRUST_LEVELS = [
  { level: 0 as TrustLevel, label: 'Monitor Only', description: 'Observe and report findings. No automated actions.' },
  { level: 1 as TrustLevel, label: 'Suggest', description: 'Suggest fixes with dry-run previews. Requires manual approval.' },
  { level: 2 as TrustLevel, label: 'Ask First', description: 'Propose fixes and wait for confirmation before applying.' },
  { level: 3 as TrustLevel, label: 'Auto-fix Safe', description: 'Automatically fix low-risk issues. Confirm dangerous changes.' },
  { level: 4 as TrustLevel, label: 'Full Auto', description: 'Automatically fix all issues within enabled categories.' },
] as const;

const AUTO_FIX_CATEGORIES = [
  { id: 'crashloop', label: 'CrashLoopBackOff', description: 'Delete crashlooping pods (controller recreates)' },
  { id: 'workloads', label: 'Degraded Deployments', description: 'Rolling restart for degraded deployments' },
  { id: 'image_pull', label: 'ImagePullBackOff', description: 'Restart deployment to clear image pull errors' },
] as const;

export default function IncidentCenterView() {
  const [activeTab, setActiveTab] = useState<IncidentTab>('now');
  const connected = useMonitorStore((s) => s.connected);
  const pendingCount = useMonitorStore((s) => s.pendingActions.length);
  const monitorEnabled = useMonitorStore((s) => s.monitorEnabled);
  const setMonitorEnabled = useMonitorStore((s) => s.setMonitorEnabled);
  const triggerScan = useMonitorStore((s) => s.triggerScan);
  const lastScanTime = useMonitorStore((s) => s.lastScanTime);
  const storeAutoFixCategories = useMonitorStore((s) => s.autoFixCategories);
  const setStoreAutoFixCategories = useMonitorStore((s) => s.setAutoFixCategories);
  const findings = useMonitorStore((s) => s.findings);
  const trustLevel = useTrustStore((s) => s.trustLevel);
  const setTrustLevel = useTrustStore((s) => s.setTrustLevel);
  const trustAutoFixCategories = useTrustStore((s) => s.autoFixCategories);
  const setTrustAutoFixCategories = useTrustStore((s) => s.setAutoFixCategories);

  const autoFixCategories = useMemo(
    () => new Set([...storeAutoFixCategories, ...trustAutoFixCategories]),
    [storeAutoFixCategories, trustAutoFixCategories],
  );

  const toggleAutoFixCategory = (id: string) => {
    const next = new Set(autoFixCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const arr = Array.from(next);
    setStoreAutoFixCategories(arr);
    setTrustAutoFixCategories(arr);
  };

  const { data: agentInfo } = useQuery<{ protocol: string; agent: string; tools: number }>({
    queryKey: ['agent', 'version'],
    queryFn: async () => {
      const res = await fetch('/api/agent/version');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: evalStatus, isLoading: evalLoading } = useQuery({
    queryKey: ['agent', 'eval-status'],
    queryFn: () => fetchAgentEvalStatus().catch(() => null),
    refetchInterval: 60000,
  });

  const { data: monitorCapabilities } = useQuery<{
    max_trust_level: number;
    supported_auto_fix_categories: string[];
  }>({
    queryKey: ['agent', 'monitor-capabilities'],
    queryFn: async () => {
      const res = await fetch('/api/agent/monitor/capabilities');
      if (!res.ok) return { max_trust_level: 3, supported_auto_fix_categories: ['crashloop', 'workloads'] };
      return res.json();
    },
    staleTime: 300000,
    refetchInterval: 300000,
  });

  const maxTrustLevel = Math.max(0, Math.min(monitorCapabilities?.max_trust_level ?? 3, 4)) as TrustLevel;
  const visibleTrustLevels = useMemo(
    () => TRUST_LEVELS.filter((level) => level.level <= maxTrustLevel),
    [maxTrustLevel],
  );
  const supportedCategories = useMemo(
    () => new Set(monitorCapabilities?.supported_auto_fix_categories ?? ['crashloop', 'workloads']),
    [monitorCapabilities?.supported_auto_fix_categories],
  );
  const visibleCategories = useMemo(
    () => AUTO_FIX_CATEGORIES.filter((category) => supportedCategories.has(category.id)),
    [supportedCategories],
  );

  const [scanning, setScanning] = useState(false);
  const prevLastScan = useRef(lastScanTime);

  useEffect(() => {
    if (lastScanTime !== prevLastScan.current && scanning) {
      setScanning(false);
      useUIStore.getState().addToast({
        type: findings.length > 0 ? 'warning' : 'success',
        title: 'Scan complete',
        detail: findings.length > 0
          ? `Found ${findings.length} issue${findings.length !== 1 ? 's' : ''}.`
          : 'No issues found — cluster looks healthy.',
        duration: 5000,
      });
    }
    prevLastScan.current = lastScanTime;
  }, [lastScanTime, scanning, findings.length]);

  const handleScanNow = () => {
    setScanning(true);
    triggerScan();
    setTimeout(() => setScanning(false), 30_000);
  };

  useEffect(() => {
    if (trustLevel > maxTrustLevel) {
      setTrustLevel(maxTrustLevel);
    }
  }, [trustLevel, maxTrustLevel, setTrustLevel]);

  useEffect(() => {
    const filtered = Array.from(autoFixCategories).filter((category) => supportedCategories.has(category));
    if (filtered.length !== autoFixCategories.size) {
      setStoreAutoFixCategories(filtered);
      setTrustAutoFixCategories(filtered);
    }
  }, [autoFixCategories, setStoreAutoFixCategories, setTrustAutoFixCategories, supportedCategories]);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Siren className="w-6 h-6 text-violet-500" />
              Incident Center
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Real-time incidents, correlation analysis, and automated remediation
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400"
              title="Eval score from static fixtures. Use 'pulse-eval replay' for live agent testing."
            >
              <span className="text-slate-300">Eval Score</span>
              <span className="text-slate-600">·</span>
              <span className={cn(
                evalLoading
                  ? 'text-slate-300'
                  : evalStatus?.quality_gate_passed
                    ? 'text-green-300'
                    : evalStatus
                      ? 'text-amber-300'
                      : 'text-slate-300',
              )}
              >
                {evalLoading ? 'Checking' : evalStatus ? (evalStatus.quality_gate_passed ? 'PASS' : 'FAIL') : 'Unavailable'}
              </span>
            </div>
            {agentInfo && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400">
                <Cpu className="w-3.5 h-3.5 text-violet-400" />
                <span>Agent v{agentInfo.agent}</span>
                <span className="text-slate-600">·</span>
                <span>Protocol {agentInfo.protocol}</span>
                <span className="text-slate-600">·</span>
                <span>{agentInfo.tools} tools</span>
              </div>
            )}
            <div
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg border',
                connected
                  ? 'bg-green-900/30 border-green-800'
                  : 'bg-slate-900 border-slate-700',
              )}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  connected ? 'bg-green-400 animate-pulse' : 'bg-slate-500',
                )}
              />
              <span className={cn('text-sm font-medium', connected ? 'text-green-300' : 'text-slate-400')}>
                {connected ? 'Live' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 bg-slate-900 rounded-lg p-1"
          role="tablist"
          aria-label="Incident Center tabs"
          onKeyDown={(e) => {
            const ids = TABS.map((t) => t.id);
            const idx = ids.indexOf(activeTab);
            if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(ids[(idx + 1) % ids.length]); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab(ids[(idx - 1 + ids.length) % ids.length]); }
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`incident-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-xs rounded-md transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                activeTab === tab.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'actions' && pendingCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-600 text-white rounded-full leading-none">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'now' && <div id="incident-panel-now" role="tabpanel"><NowTab /></div>}
        {activeTab === 'investigate' && <div id="incident-panel-investigate" role="tabpanel"><InvestigateTab /></div>}
        {activeTab === 'actions' && <div id="incident-panel-actions" role="tabpanel"><ActionsTab /></div>}
        {activeTab === 'history' && <div id="incident-panel-history" role="tabpanel"><HistoryTab /></div>}
        {activeTab === 'config' && (
          <div id="incident-panel-config" role="tabpanel" className="space-y-6">
            <Card>
              <div className="px-4 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Monitoring</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Enable continuous cluster monitoring and automated remediation</p>
                </div>
                <button
                  onClick={() => setMonitorEnabled(!monitorEnabled)}
                  role="switch"
                  aria-checked={monitorEnabled}
                  aria-label="Toggle monitoring"
                  className={cn('relative w-11 h-6 rounded-full transition-colors', monitorEnabled ? 'bg-violet-600' : 'bg-slate-700')}
                >
                  <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform', monitorEnabled && 'translate-x-5')} />
                </button>
              </div>
            </Card>

            <div className="px-4 py-3 bg-slate-900/50 border border-slate-800 rounded-lg text-xs text-slate-400">
              Trust controls are enforced server-side. Maximum trust available for this environment is Level {maxTrustLevel}.
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Trust Level</h3>
              <div className="grid gap-2">
                {visibleTrustLevels.map((tl) => (
                  <button
                    key={tl.level}
                    onClick={() => setTrustLevel(tl.level)}
                    className={cn(
                      'px-4 py-3 rounded-lg border text-left transition-colors',
                      trustLevel === tl.level ? 'bg-violet-900/30 border-violet-700' : 'bg-slate-900 border-slate-800 hover:border-slate-700',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center', trustLevel === tl.level ? 'border-violet-500' : 'border-slate-600')}>
                        {trustLevel === tl.level && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                      </div>
                      <span className="text-sm font-medium text-slate-200">Level {tl.level}: {tl.label}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 ml-6">{tl.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {trustLevel >= 3 && (
              <div className="px-4 py-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg text-xs text-yellow-300">
                Auto-fixes are executed automatically and recorded in Fix History. Auto-fix actions (pod deletion, rolling restart) cannot be rolled back.
              </div>
            )}

            {trustLevel >= 2 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Auto-fix Categories</h3>
                <div className="grid gap-2">
                  {visibleCategories.map((cat) => (
                    <label
                      key={cat.id}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors',
                        autoFixCategories.has(cat.id) ? 'bg-violet-900/20 border-violet-800' : 'bg-slate-900 border-slate-800 hover:border-slate-700',
                      )}
                    >
                      <input type="checkbox" checked={autoFixCategories.has(cat.id)} onChange={() => toggleAutoFixCategory(cat.id)} className="mt-0.5 rounded border-slate-600" />
                      <div>
                        <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                        <p className="text-xs text-slate-400 mt-0.5">{cat.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleScanNow}
              disabled={!connected || scanning}
              className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              {scanning ? (<><Activity className="w-4 h-4 animate-pulse" />Scanning...</>) : (<><Play className="w-4 h-4" />Scan Now</>)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
