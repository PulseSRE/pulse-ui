import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import {
  HeartPulse, Shield, Activity,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '../components/primitives/Tooltip';

const TRUST_LEVELS = [
  [0, 'Observe', 'agent watches only'],
  [1, 'Confirm', 'you approve each action'],
  [2, 'Batch', 'agent proposes fixes for review'],
  [3, 'Bounded', 'auto-fixes within guardrails'],
  [4, 'Autonomous', 'agent acts independently'],
] as const;
import type { K8sResource } from '../engine/renderers';
import type { Node, Pod, Event } from '../engine/types';
import type { ClusterOperator } from '../engine/types/openshift';
import type { Deployment } from '../engine/types/apps';
import type { PersistentVolumeClaim } from '../engine/types/core';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { useShallow } from 'zustand/react/shallow';
import { useMonitorStore } from '../store/monitorStore';
import { useTrustStore } from '../store/trustStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useIncidentFeed } from '../hooks/useIncidentFeed';
import { OpenEpisodeBanner } from './pulse/OpenEpisodeBanner';
import { ReportTab } from './pulse/ReportTab';
import { FleetReportTab } from './pulse/FleetReportTab';
import { formatRelativeTime } from '../engine/formatters';

const ClusterResourceMap = lazy(() => import('../components/topology/TopologyMap'));

type PostureLevel = 'green' | 'yellow' | 'red';

function ClusterPostureBar({
  findings,
  incidentCounts,
  lastScanTime,
  monitorConnected,
  onInvestigate,
}: {
  findings: Array<{ severity: string; title: string }>;
  incidentCounts: { critical: number; warning: number; info: number; total: number };
  lastScanTime: number | null;
  monitorConnected: boolean;
  onInvestigate: () => void;
}) {
  const criticalCount = incidentCounts.critical;
  const warningCount = incidentCounts.warning;
  const autoFixedCount = findings.filter((f) => (f as any).autoFixable).length;

  let level: PostureLevel = 'green';
  if (criticalCount > 0) level = 'red';
  else if (warningCount > 0 || findings.length > 0) level = 'yellow';

  const topFinding = findings.length > 0 ? findings[0] : null;

  const scanLabel = lastScanTime
    ? `Last scan: ${formatRelativeTime(lastScanTime)}`
    : 'No scan yet';

  const borderColor: Record<PostureLevel, string> = {
    green: 'border-l-emerald-500',
    yellow: 'border-l-amber-500',
    red: 'border-l-red-500',
  };

  const bgColor: Record<PostureLevel, string> = {
    green: 'bg-emerald-500/5',
    yellow: 'bg-amber-500/5',
    red: 'bg-red-500/5',
  };

  const iconColor: Record<PostureLevel, string> = {
    green: 'text-emerald-400',
    yellow: 'text-amber-400',
    red: 'text-red-400',
  };

  const Icon = level === 'green' ? Shield : AlertTriangle;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border-l-4 px-4 py-2 text-sm',
        borderColor[level],
        bgColor[level],
        'border border-slate-800',
      )}
    >
      <Icon className={cn('w-4 h-4 shrink-0', iconColor[level])} />
      <span className="text-slate-200 truncate">
        {level === 'green' && (
          <>
            All clear — 0 critical, 0 warnings
            <span className="text-slate-500"> | {scanLabel} | Agent: {monitorConnected ? 'healthy' : 'disconnected'}</span>
          </>
        )}
        {level === 'yellow' && (
          <>
            <span className="text-amber-400">{warningCount + findings.length} warning{warningCount + findings.length !== 1 ? 's' : ''}</span>
            {topFinding && (
              <span className="text-slate-400"> — {topFinding.title}</span>
            )}
            <span className="text-slate-500"> | {scanLabel}</span>
          </>
        )}
        {level === 'red' && (
          <>
            <span className="text-red-400">{criticalCount} critical</span>
            {topFinding && (
              <span className="text-slate-400"> — {topFinding.title}</span>
            )}
            <span className="text-slate-500"> →{' '}</span>
            <button onClick={onInvestigate} className="text-red-400 underline underline-offset-2 hover:text-red-300">
              Investigate
            </button>
            {autoFixedCount > 0 && (
              <span className="text-slate-500"> | {autoFixedCount} auto-fixed overnight</span>
            )}
          </>
        )}
      </span>
    </div>
  );
}

export default function PulseView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const fleetMode = useFleetStore((s) => s.fleetMode);

  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;
  const { data: nodes = [], isLoading: nodesLoading } = useK8sListWatch<Node>({ apiPath: '/api/v1/nodes' });
  const { data: pods = [], isLoading: podsLoading } = useK8sListWatch<Pod>({ apiPath: '/api/v1/pods', namespace: nsFilter });
  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch<Deployment>({ apiPath: '/apis/apps/v1/deployments', namespace: nsFilter });
  const { data: pvcs = [], isLoading: pvcsLoading } = useK8sListWatch<PersistentVolumeClaim>({ apiPath: '/api/v1/persistentvolumeclaims', namespace: nsFilter });
  const { data: operators = [], isLoading: opsLoading } = useK8sListWatch<ClusterOperator>({ apiPath: '/apis/config.openshift.io/v1/clusteroperators' });
  const { data: events = [] } = useK8sListWatch<Event>({ apiPath: '/api/v1/events', namespace: nsFilter });

  const isLoading = nodesLoading || podsLoading || deploysLoading || pvcsLoading || opsLoading;
  const { monitorConnected, activeSkill, monitorEnabled, setMonitorEnabled, triggerScan, findings, lastScanTime } =
    useMonitorStore(useShallow((s) => ({
      monitorConnected: s.connected,
      activeSkill: s.activeSkill,
      monitorEnabled: s.monitorEnabled,
      setMonitorEnabled: s.setMonitorEnabled,
      triggerScan: s.triggerScan,
      findings: s.findings,
      lastScanTime: s.lastScanTime,
    })));
  const trustLevel = useTrustStore((s) => s.trustLevel);
  const { counts: incidentCounts } = useIncidentFeed({ limit: 0 });

  const [scanning, setScanning] = useState(false);
  const scanTimeRef = useRef(lastScanTime);
  const handleScanNow = () => {
    scanTimeRef.current = lastScanTime;
    setScanning(true);
    triggerScan();
    setTimeout(() => setScanning(false), 15_000);
  };
  useEffect(() => {
    if (scanning && lastScanTime !== scanTimeRef.current) {
      setScanning(false);
      const f = useMonitorStore.getState().findings;
      useUIStore.getState().addToast({
        type: f.length > 0 ? 'warning' : 'success',
        tier: 'system',
        title: 'Scan complete',
        detail: f.length > 0
          ? `Found ${f.length} issue${f.length !== 1 ? 's' : ''}.`
          : 'No issues found — cluster looks healthy.',
        duration: 5000,
      });
    }
  }, [lastScanTime, scanning]);

  const readyNodeCount = nodes.filter(n => {
    const conds = n.status?.conditions || [];
    return conds.some(c => c.type === 'Ready' && c.status === 'True');
  }).length;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* An open episode outranks everything below it — those tiles are
            showing its symptoms. */}
        <OpenEpisodeBanner onOpen={() => go('/inbox', 'Inbox')} />

        {/* ── Cluster Posture Bar ── */}
        <ClusterPostureBar
          findings={findings}
          incidentCounts={incidentCounts}
          lastScanTime={lastScanTime}
          monitorConnected={monitorConnected}
          onInvestigate={() => go('/inbox', 'Inbox')}
        />

        {/* ── Header with inline stats ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HeartPulse className="w-6 h-6 text-blue-500" />
            <div>
              <h1 className="text-xl font-bold text-slate-100">Cluster Pulse</h1>
              <p className="text-xs text-slate-500">
                Health overview{selectedNamespace !== '*' && <span className="text-blue-400 ml-1">· {selectedNamespace}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatPill
              icon={<Shield className="w-3 h-3" />}
              label={`${readyNodeCount}/${nodes.length} nodes`}
              color={readyNodeCount === nodes.length ? 'emerald' : 'amber'}
              onClick={() => go('/compute', 'Compute')}
            />
            <Tooltip
              content={
                <div className="w-56">
                  <div className="text-xs font-semibold text-slate-200 mb-2">Trust Levels</div>
                  <div className="space-y-1.5 text-xs">
                    {TRUST_LEVELS.map(([level, label, hint]) => (
                      <div key={level} className={cn('flex items-start gap-2', level === trustLevel ? 'text-blue-400' : 'text-slate-400')}>
                        <span className="font-mono font-bold w-4 shrink-0">{level}</span>
                        <span>{label} — {hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
              }
              side="bottom"
              align="end"
              delayDuration={200}
            >
              <button
                onClick={() => go('/agent', 'Pulse Agent')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
              >
                <div className={cn('w-1.5 h-1.5 rounded-full', monitorConnected ? 'bg-emerald-400' : 'bg-slate-600')} />
                Agent &middot; Trust {trustLevel}
                {activeSkill && <span className="text-violet-400">&middot; {activeSkill}</span>}
              </button>
            </Tooltip>
            <button
              onClick={handleScanNow}
              disabled={!monitorConnected || scanning}
              className="px-2.5 py-1 rounded-sm bg-violet-500/10 text-xs text-violet-400 hover:bg-violet-500/20 disabled:opacity-40 flex items-center gap-1"
            >
              {scanning ? <><Activity className="w-3 h-3 animate-spin" />Scanning...</> : 'Scan Now'}
            </button>
            <button
              onClick={() => setMonitorEnabled(!monitorEnabled)}
              className={cn('px-2.5 py-1 rounded-sm text-xs', monitorEnabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500')}
            >
              {monitorEnabled ? 'Monitoring On' : 'Monitoring Off'}
            </button>
          </div>
        </div>

        <Suspense fallback={
          <div className="h-[420px] bg-slate-900 rounded-lg border border-slate-800 animate-pulse" />
        }>
          <ClusterResourceMap
            nodes={nodes}
            pods={pods}
            operators={operators}
            events={events}
            go={go}
          />
        </Suspense>

        {fleetMode === 'multi' ? (
          <FleetReportTab />
        ) : isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-6 animate-pulse">
                <div className="h-4 bg-slate-800 rounded-sm w-1/3 mb-3" />
                <div className="h-3 bg-slate-800 rounded-sm w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          <ReportTab
            nodes={nodes}
            allPods={pods}
            deployments={deployments}
            pvcs={pvcs}
            operators={operators}
            go={go}
          />
        )}
      </div>
    </div>
  );
}

function StatPill({ icon, label, color, onClick }: {
  icon: React.ReactNode; label: string; color: 'emerald' | 'amber' | 'red' | 'violet'; onClick: () => void;
}) {
  const colors = {
    emerald: 'text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10',
    amber: 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10',
    red: 'text-red-400 border-red-500/30 hover:bg-red-500/10',
    violet: 'text-violet-400 border-violet-500/30 hover:bg-violet-500/10',
  };
  return (
    <button
      onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors', colors[color])}
    >
      {icon}
      {label}
    </button>
  );
}
