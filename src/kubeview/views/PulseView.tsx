import React, { lazy, Suspense } from 'react';
import { HeartPulse, ArrowRight, Bell, GitPullRequest, Shield } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { useMonitorStore } from '../store/monitorStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { useIncidentFeed } from '../hooks/useIncidentFeed';
import { isFeatureEnabled } from '../engine/featureFlags';
import { fetchBriefing, type BriefingResponse } from '../engine/fixHistory';
import { ReportTab } from './pulse/ReportTab';
import { FleetReportTab } from './pulse/FleetReportTab';
import { AIOnboarding } from '../components/agent/AIOnboarding';
import { OvernightActivityFeed } from './pulse/OvernightActivityFeed';
import { InsightsRail } from './pulse/InsightsRail';
import { Sparkles, CheckCircle, XCircle, Search, AlertTriangle } from 'lucide-react';

const TopologyMap = lazy(() => import('../components/topology/TopologyMap'));

export default function PulseView() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const fleetMode = useFleetStore((s) => s.fleetMode);
  const enhanced = isFeatureEnabled('enhancedPulse');

  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;
  const { data: nodes = [], isLoading: nodesLoading } = useK8sListWatch({ apiPath: '/api/v1/nodes' });
  const { data: pods = [], isLoading: podsLoading } = useK8sListWatch({ apiPath: '/api/v1/pods', namespace: nsFilter });
  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch({ apiPath: '/apis/apps/v1/deployments', namespace: nsFilter });
  const { data: pvcs = [], isLoading: pvcsLoading } = useK8sListWatch({ apiPath: '/api/v1/persistentvolumeclaims', namespace: nsFilter });
  const { data: operators = [], isLoading: opsLoading } = useK8sListWatch({ apiPath: '/apis/config.openshift.io/v1/clusteroperators' });
  const { data: events = [] } = useK8sListWatch({ apiPath: '/api/v1/events', namespace: nsFilter });

  const isLoading = nodesLoading || podsLoading || deploysLoading || pvcsLoading || opsLoading;
  const pendingReviews = useMonitorStore((s) => s.pendingActions.length);
  const { counts: incidentCounts } = useIncidentFeed({ limit: 0 });

  const { data: briefing } = useQuery<BriefingResponse>({
    queryKey: ['briefing'],
    queryFn: () => fetchBriefing(12),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: enhanced,
  });

  const typedNodes = nodes as K8sResource[];
  const readyNodes = typedNodes.filter(n => {
    const conds = ((n as any).status?.conditions || []) as Array<{ type: string; status: string }>;
    return conds.some(c => c.type === 'Ready' && c.status === 'True');
  }).length;

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-5">

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
              label={`${readyNodes}/${typedNodes.length} nodes`}
              color={readyNodes === typedNodes.length ? 'emerald' : 'amber'}
              onClick={() => go('/compute', 'Compute')}
            />
            {incidentCounts.total > 0 && (
              <StatPill
                icon={<Bell className="w-3 h-3" />}
                label={`${incidentCounts.total} incident${incidentCounts.total !== 1 ? 's' : ''}`}
                color={incidentCounts.critical > 0 ? 'red' : 'amber'}
                onClick={() => go('/incidents', 'Incidents')}
              />
            )}
            {pendingReviews > 0 && (
              <StatPill
                icon={<GitPullRequest className="w-3 h-3" />}
                label={`${pendingReviews} review${pendingReviews !== 1 ? 's' : ''}`}
                color="violet"
                onClick={() => go('/reviews', 'Reviews')}
              />
            )}
          </div>
        </div>

        {/* ── AI Briefing (compact inline) ── */}
        {enhanced && briefing && (
          <div className="rounded-lg border border-violet-500/20 bg-slate-900 px-4 py-3 relative overflow-hidden">
            <div className="pointer-events-none absolute -inset-px rounded-lg bg-violet-500/5" />
            <div className="relative flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-300">{briefing.summary}</p>
                {(briefing.actions.completed > 0 || briefing.investigations > 0) && (
                  <div className="flex gap-3 mt-2 text-xs">
                    {briefing.actions.completed > 0 && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle className="w-3 h-3" /> {briefing.actions.completed} fixed
                      </span>
                    )}
                    {briefing.actions.failed > 0 && (
                      <span className="flex items-center gap-1 text-red-400">
                        <XCircle className="w-3 h-3" /> {briefing.actions.failed} failed
                      </span>
                    )}
                    {briefing.investigations > 0 && (
                      <span className="flex items-center gap-1 text-blue-400">
                        <Search className="w-3 h-3" /> {briefing.investigations} investigated
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-600 shrink-0">last {briefing.hours}h</span>
            </div>
          </div>
        )}

        {/* ── Two-column: main + rail ── */}
        <div className="flex gap-5">
          <div className="flex-1 min-w-0 space-y-5">
            <AIOnboarding compact className="mb-1" />

            <Suspense fallback={
              <div className="h-[420px] bg-slate-900 rounded-lg border border-slate-800 animate-pulse" />
            }>
              <TopologyMap
                nodes={nodes as K8sResource[]}
                pods={pods as K8sResource[]}
                operators={operators as K8sResource[]}
                events={events as K8sResource[]}
                go={go}
              />
            </Suspense>

            {enhanced && <OvernightActivityFeed />}

            {fleetMode === 'multi' ? (
              <FleetReportTab />
            ) : isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-6 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded w-1/3 mb-3" />
                    <div className="h-3 bg-slate-800 rounded w-2/3" />
                  </div>
                ))}
              </div>
            ) : (
              <ReportTab
                nodes={nodes as K8sResource[]}
                allPods={pods as K8sResource[]}
                deployments={deployments as K8sResource[]}
                pvcs={pvcs as K8sResource[]}
                operators={operators as K8sResource[]}
                go={go}
              />
            )}
          </div>

          {/* ── Right rail: always visible ── */}
          <InsightsRail className="w-60 shrink-0 hidden lg:block" onNavigate={go} />
        </div>
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
