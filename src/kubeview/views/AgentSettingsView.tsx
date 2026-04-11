import { useState, Suspense, lazy, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bot, Shield, MessageSquare, Activity, Play, Eye, Brain,
  Zap, AlertTriangle, CheckCircle2, XCircle, Settings, LayoutDashboard,
  FlaskConical, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScannerPanel } from '../components/monitor/ScannerPanel';
import { Card } from '../components/primitives/Card';
import { useMonitorStore } from '../store/monitorStore';
import { useTrustStore, TRUST_LABELS, TRUST_DESCRIPTIONS, type TrustLevel, type CommunicationStyle } from '../store/trustStore';
import { useAgentStore } from '../store/agentStore';
import { useUIStore } from '../store/uiStore';
import { fetchAgentEvalStatus } from '../engine/evalStatus';
import { ConfirmDialog } from '../components/feedback/ConfirmDialog';

const MemoryView = lazy(() => import('./MemoryView'));
const ViewsManagement = lazy(() => import('./ViewsManagement'));

const TRUST_LEVELS = [
  { level: 0 as TrustLevel, label: 'Monitor Only', description: 'Observe and report findings. No automated actions.', icon: Eye },
  { level: 1 as TrustLevel, label: 'Suggest', description: 'Suggest fixes with dry-run previews. Requires manual approval.', icon: MessageSquare },
  { level: 2 as TrustLevel, label: 'Ask First', description: 'Propose fixes and wait for confirmation before applying.', icon: Shield },
  { level: 3 as TrustLevel, label: 'Auto-fix Safe', description: 'Automatically fix low-risk issues. Confirm dangerous changes.', icon: Zap },
  { level: 4 as TrustLevel, label: 'Full Auto', description: 'Automatically fix all issues within enabled categories.', icon: Activity },
] as const;

const AUTO_FIX_CATEGORIES = [
  { id: 'crashloop', label: 'CrashLoopBackOff', description: 'Delete crashlooping pods (controller recreates)' },
  { id: 'workloads', label: 'Degraded Deployments', description: 'Rolling restart for degraded deployments' },
  { id: 'image_pull', label: 'ImagePullBackOff', description: 'Restart deployment to clear image pull errors' },
] as const;

const COMM_OPTIONS: { value: CommunicationStyle; label: string; description: string }[] = [
  { value: 'brief', label: 'Brief', description: 'Short, actionable answers' },
  { value: 'detailed', label: 'Detailed', description: 'Full explanations with context' },
  { value: 'technical', label: 'Technical', description: 'Deep technical detail, CLI examples' },
];

type AgentTab = 'settings' | 'scanners' | 'memory' | 'views' | 'evals';

export default function AgentSettingsView() {
  const { data: evalStatus } = useQuery({
    queryKey: ['agent', 'eval-status'],
    queryFn: () => fetchAgentEvalStatus().catch(() => null),
    refetchInterval: 60_000,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as AgentTab) || 'settings';
  const [activeTab, setActiveTabState] = useState<AgentTab>(initialTab);
  const setActiveTab = (tab: AgentTab) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'settings') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const agentTabs: Array<{ id: AgentTab; label: string; icon: React.ReactNode; activeIcon: React.ReactNode }> = [
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5 text-violet-400" />, activeIcon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'scanners', label: 'Scanners', icon: <Shield className="w-3.5 h-3.5 text-blue-400" />, activeIcon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5 text-pink-400" />, activeIcon: <Brain className="w-3.5 h-3.5" /> },
    { id: 'views', label: 'Views', icon: <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />, activeIcon: <LayoutDashboard className="w-3.5 h-3.5" /> },
    { id: 'evals', label: 'Evals', icon: <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />, activeIcon: <FlaskConical className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Bot className="w-6 h-6 text-violet-400" />
              Agent
            </h1>
            <p className="text-sm text-slate-400 mt-1">Settings, memory, and views management</p>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1"
          role="tablist"
          aria-label="Agent tabs"
        >
          {agentTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {activeTab === t.id ? t.activeIcon : t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'settings' && <SettingsTabContent />}
        {activeTab === 'scanners' && <ScannerPanel />}
        {activeTab === 'memory' && (
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>}>
            <MemoryView embedded />
          </Suspense>
        )}
        {activeTab === 'views' && (
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>}>
            <ViewsManagement embedded />
          </Suspense>
        )}
        {activeTab === 'evals' && <EvalsTab evalStatus={evalStatus} />}
      </div>
    </div>
  );
}

function SettingsTabContent() {
  const navigate = useNavigate();
  const connected = useAgentStore((s) => s.connected);
  const monitorEnabled = useMonitorStore((s) => s.monitorEnabled);
  const setMonitorEnabled = useMonitorStore((s) => s.setMonitorEnabled);
  const monitorConnected = useMonitorStore((s) => s.connected);
  const triggerScan = useMonitorStore((s) => s.triggerScan);
  const trustLevel = useTrustStore((s) => s.trustLevel);
  const setTrustLevel = useTrustStore((s) => s.setTrustLevel);
  const autoFixCategories = useTrustStore((s) => s.autoFixCategories);
  const setAutoFixCategories = useTrustStore((s) => s.setAutoFixCategories);
  const toggleAutoFixCategory = (id: string) => {
    const next = new Set(autoFixCategories);
    if (next.has(id)) next.delete(id); else next.add(id);
    setAutoFixCategories(Array.from(next));
  };
  const communicationStyle = useTrustStore((s) => s.communicationStyle);
  const setCommunicationStyle = useTrustStore((s) => s.setCommunicationStyle);
  const [scanning, setScanning] = useState(false);
  const [pendingTrustLevel, setPendingTrustLevel] = useState<TrustLevel | null>(null);

  const handleTrustChange = (level: TrustLevel) => {
    if (level >= 3 && trustLevel < 3) {
      setPendingTrustLevel(level);
    } else {
      setTrustLevel(level);
    }
  };

  const { data: capabilities } = useQuery({
    queryKey: ['monitor', 'capabilities'],
    queryFn: async () => {
      const res = await fetch('/api/agent/monitor/capabilities');
      if (!res.ok) return { max_trust_level: 4 };
      return res.json();
    },
    staleTime: 60_000,
  });
  const maxTrustLevel = (capabilities?.max_trust_level ?? 4) as TrustLevel;
  const visibleTrustLevels = TRUST_LEVELS.filter((tl) => tl.level <= maxTrustLevel);

  const { data: versionInfo } = useQuery({
    queryKey: ['agent', 'version'],
    queryFn: async () => {
      const res = await fetch('/api/agent/version');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 300_000,
  });

  const { data: evalStatus } = useQuery({
    queryKey: ['agent', 'eval-status'],
    queryFn: () => fetchAgentEvalStatus().catch(() => null),
    refetchInterval: 60_000,
  });

  const lastScanTime = useMonitorStore((s) => s.lastScanTime);
  const scanTimeRef = useRef(lastScanTime);

  const handleScanNow = () => {
    scanTimeRef.current = lastScanTime;
    setScanning(true);
    triggerScan();
    // Auto-reset after 15s if no scan result arrives
    setTimeout(() => setScanning(false), 15_000);
  };

  // Reset scanning when a new scan result arrives
  useEffect(() => {
    if (scanning && lastScanTime !== scanTimeRef.current) {
      setScanning(false);
      const findings = useMonitorStore.getState().findings;
      useUIStore.getState().addToast({
        type: findings.length > 0 ? 'warning' : 'success',
        title: 'Scan complete',
        detail: findings.length > 0
          ? `Found ${findings.length} issue${findings.length !== 1 ? 's' : ''}.`
          : 'No issues found — cluster looks healthy.',
        duration: 5000,
      });
    }
  }, [lastScanTime, scanning]);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Connection status + version */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/30 border border-emerald-800 rounded-lg text-xs text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              Disconnected
            </span>
          )}
        </div>
        {(versionInfo || evalStatus !== undefined) && (
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {versionInfo && <span>Agent v{versionInfo.agent}</span>}
            {versionInfo && <span>Protocol {versionInfo.protocol}</span>}
            {versionInfo && <span>{versionInfo.tools} tools</span>}
            <span className={cn(
              evalStatus?.quality_gate_passed ? 'text-emerald-400' : evalStatus ? 'text-amber-400' : 'text-slate-500',
            )} title="Eval score from static fixtures. Use 'pulse-eval replay' for live agent testing.">
              Eval: {evalStatus ? (evalStatus.quality_gate_passed ? 'PASS' : 'FAIL') : 'n/a'}
            </span>
          </div>
        )}
      </div>

      {/* Monitoring */}
      <Card>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-violet-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Continuous Monitoring</h3>
                <p className="text-xs text-slate-400 mt-0.5">Automatically scan the cluster for issues and anomalies</p>
              </div>
            </div>
            <button
              onClick={() => setMonitorEnabled(!monitorEnabled)}
              role="switch"
              aria-checked={monitorEnabled}
              className={cn('relative w-11 h-6 rounded-full transition-colors', monitorEnabled ? 'bg-violet-600' : 'bg-slate-700')}
            >
              <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform', monitorEnabled && 'translate-x-5')} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScanNow}
              disabled={!monitorConnected || scanning}
              className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-1.5 transition-colors"
            >
              {scanning ? <><Activity className="w-3.5 h-3.5 animate-spin" />Scanning cluster...</> : !monitorConnected ? <><Play className="w-3.5 h-3.5" />Monitor disconnected</> : <><Play className="w-3.5 h-3.5" />Scan Now</>}
            </button>
            <button
              onClick={() => navigate('/incidents')}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded-md transition-colors"
            >
              View Incidents
            </button>
          </div>
        </div>
      </Card>

      {/* Trust Level */}
      <Card>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Trust Level</h3>
              <p className="text-xs text-slate-400 mt-0.5">Controls what actions the agent can take autonomously</p>
            </div>
          </div>

          <div className="text-xs text-slate-500 bg-slate-900/50 border border-slate-800 rounded-md px-3 py-2">
            Trust controls are enforced server-side. Maximum trust for this environment: Level {maxTrustLevel}.
          </div>

          <div className="grid gap-2">
            {visibleTrustLevels.map((tl) => {
              const Icon = tl.icon;
              return (
                <button
                  key={tl.level}
                  onClick={() => handleTrustChange(tl.level)}
                  className={cn(
                    'px-4 py-3 rounded-lg border text-left transition-colors',
                    trustLevel === tl.level ? 'bg-violet-900/30 border-violet-700' : 'bg-slate-900 border-slate-800 hover:border-slate-700',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center', trustLevel === tl.level ? 'border-violet-500' : 'border-slate-600')}>
                      {trustLevel === tl.level && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                    </div>
                    <Icon className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-sm font-medium text-slate-200">Level {tl.level}: {tl.label}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 ml-6">{tl.description}</p>
                </button>
              );
            })}
          </div>

          {trustLevel >= 3 && (
            <div className="flex items-start gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-800/50 rounded-md text-xs text-yellow-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Auto-fixes are executed automatically and recorded in Fix History. Some actions cannot be rolled back.
            </div>
          )}
        </div>
      </Card>

      {/* Auto-fix Categories */}
      <Card className={trustLevel < 2 ? 'opacity-50' : undefined}>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Auto-fix Categories</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {trustLevel < 2
                  ? 'Unlock at Trust Level 2 (Ask First) to configure auto-fix categories'
                  : 'Select which issue types the agent can fix automatically'}
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            {AUTO_FIX_CATEGORIES.map((cat) => (
              <label
                key={cat.id}
                className={cn(
                  'flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors',
                  trustLevel < 2 ? 'cursor-not-allowed bg-slate-900 border-slate-800' :
                  autoFixCategories.includes(cat.id) ? 'cursor-pointer bg-violet-900/20 border-violet-800' : 'cursor-pointer bg-slate-900 border-slate-800 hover:border-slate-700',
                )}
              >
                <input type="checkbox" checked={autoFixCategories.includes(cat.id)} onChange={() => toggleAutoFixCategory(cat.id)} disabled={trustLevel < 2} className="mt-0.5 rounded border-slate-600 disabled:opacity-50" />
                <div>
                  <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                  <p className="text-xs text-slate-400 mt-0.5">{cat.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </Card>

      {/* Communication Style */}
      <Card>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-violet-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Communication Style</h3>
              <p className="text-xs text-slate-400 mt-0.5">How the agent formats its responses</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {COMM_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCommunicationStyle(opt.value)}
                className={cn(
                  'px-3 py-2.5 rounded-lg border text-center transition-colors',
                  communicationStyle === opt.value ? 'bg-violet-900/30 border-violet-700' : 'bg-slate-900 border-slate-800 hover:border-slate-700',
                )}
              >
                <div className="text-sm font-medium text-slate-200">{opt.label}</div>
                <div className="text-xs text-slate-400 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <p className="text-xs text-slate-600 text-center">
        Preferences are saved locally and sent to the agent on each connection.
      </p>

      <ConfirmDialog
        open={pendingTrustLevel !== null}
        onClose={() => setPendingTrustLevel(null)}
        onConfirm={() => {
          if (pendingTrustLevel !== null) {
            setTrustLevel(pendingTrustLevel);
            setPendingTrustLevel(null);
          }
        }}
        title="Enable Auto-Fix?"
        description={`Level ${pendingTrustLevel} allows the agent to automatically modify cluster resources (delete pods, restart deployments). Some actions cannot be rolled back. Are you sure?`}
        confirmLabel="Enable"
        variant="danger"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evals Tab                                                           */
/* ------------------------------------------------------------------ */

function EvalsTab({ evalStatus }: { evalStatus: import('../engine/evalStatus').AgentEvalStatus | null | undefined }) {
  const { data: releaseTrend } = useQuery({
    queryKey: ['eval', 'trend', 'release'],
    queryFn: async () => {
      const { fetchEvalTrend } = await import('../engine/evalStatus');
      return fetchEvalTrend('release');
    },
    staleTime: 60_000,
  });

  if (!evalStatus) {
    return <div className="text-center py-12 text-sm text-slate-500">Loading eval status...</div>;
  }

  const suites = [
    { key: 'release', label: 'Release Gate', data: evalStatus.release },
    { key: 'safety', label: 'Safety', data: evalStatus.safety },
    { key: 'integration', label: 'Integration', data: evalStatus.integration },
    { key: 'view_designer', label: 'View Designer', data: evalStatus.view_designer },
  ];

  const sreAudit = evalStatus.prompt_audit?.sre;
  const maxChars = sreAudit ? Math.max(...sreAudit.sections.map(s => s.chars), 1) : 1;

  return (
    <div className="space-y-6">
      {/* Quality gate banner */}
      <div className={cn(
        'rounded-lg border p-4 flex items-center gap-3',
        evalStatus.quality_gate_passed
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-red-950/30 border-red-800/50',
      )}>
        {evalStatus.quality_gate_passed
          ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          : <AlertTriangle className="w-5 h-5 text-red-400" />}
        <div>
          <div className="text-sm font-medium text-slate-100">
            Quality Gate: {evalStatus.quality_gate_passed ? 'PASSING' : 'FAILING'}
          </div>
          <div className="text-xs text-slate-400">
            Release gate scores static fixtures. Use <code className="text-slate-300">pulse-eval replay --judge</code> for live agent testing.
          </div>
        </div>
      </div>

      {/* Suite scores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {suites.map(({ key, label, data }) => (
          <div key={key} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              {data?.gate_passed
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                : <XCircle className="w-3.5 h-3.5 text-red-400" />}
              <span className="text-[11px] text-slate-400">{label}</span>
            </div>
            <div className="text-lg font-semibold text-slate-100">
              {data ? `${(data.average_overall * 100).toFixed(0)}%` : 'n/a'}
            </div>
            {data && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                {data.scenario_count} scenarios{data.passed_count != null ? `, ${data.passed_count} passed` : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dimension breakdown for release suite */}
      {evalStatus.release?.dimension_averages && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Release Gate Dimensions</h3>
          <div className="space-y-1.5">
            {Object.entries(evalStatus.release.dimension_averages).map(([dim, score]) => (
              <div key={dim} className="flex items-center gap-2 text-xs">
                <span className="w-36 text-slate-400">{dim.replace(/_/g, ' ')}</span>
                <div className="flex-1 h-3 bg-slate-800 rounded-sm overflow-hidden">
                  <div
                    className={cn('h-full rounded-sm', score >= 0.8 ? 'bg-emerald-600/60' : score >= 0.6 ? 'bg-amber-600/60' : 'bg-red-600/60')}
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-slate-400">{(score * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt token audit */}
      {sreAudit && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-1">Prompt Token Audit (SRE mode)</h3>
          <p className="text-[10px] text-slate-500 mb-3">~{sreAudit.estimated_tokens.toLocaleString()} tokens total</p>
          <div className="space-y-1">
            {sreAudit.sections.filter(s => s.chars > 0).map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                <span className="w-36 truncate font-mono text-slate-400">{s.name}</span>
                <div className="flex-1 h-3 bg-slate-800 rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-cyan-600/50 rounded-sm"
                    style={{ width: `${(s.chars / maxChars) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-slate-500">{s.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outcomes */}
      {evalStatus.outcomes && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-2">Outcome Tracking</h3>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>Current: {evalStatus.outcomes.current_actions} actions</span>
            <span>Baseline: {evalStatus.outcomes.baseline_actions} actions</span>
            <span className={evalStatus.outcomes.gate_passed ? 'text-emerald-400' : 'text-red-400'}>
              Gate: {evalStatus.outcomes.gate_passed ? 'PASS' : 'FAIL'}
            </span>
          </div>
        </div>
      )}

      {/* Score Trend */}
      {releaseTrend && releaseTrend.runs > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Release Score Trend</h3>
          <div className="flex items-center gap-4 mb-3">
            <div className="text-lg font-semibold text-slate-100">
              {releaseTrend.latest_score != null ? `${(releaseTrend.latest_score * 100).toFixed(0)}%` : 'n/a'}
            </div>
            {releaseTrend.delta != null && (
              <span className={cn(
                'text-xs font-medium',
                releaseTrend.delta > 0.01 ? 'text-emerald-400' : releaseTrend.delta < -0.01 ? 'text-red-400' : 'text-slate-500',
              )}>
                {releaseTrend.delta > 0 ? '+' : ''}{(releaseTrend.delta * 100).toFixed(1)}% vs previous
              </span>
            )}
            <span className="text-[10px] text-slate-600 ml-auto">{releaseTrend.runs} runs recorded</span>
          </div>
          {/* Sparkline */}
          {releaseTrend.sparkline && releaseTrend.sparkline.length > 1 && (
            <div className="flex items-end gap-px h-8">
              {(() => {
                const vals = releaseTrend.sparkline!;
                const min = Math.min(...vals) - 0.05;
                const max = Math.max(...vals) + 0.05;
                const range = max - min || 1;
                return vals.map((v, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 rounded-sm min-w-[3px]',
                      i === vals.length - 1 ? 'bg-blue-500' : 'bg-slate-700',
                    )}
                    style={{ height: `${((v - min) / range) * 100}%` }}
                    title={`${(v * 100).toFixed(1)}%`}
                  />
                ));
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
