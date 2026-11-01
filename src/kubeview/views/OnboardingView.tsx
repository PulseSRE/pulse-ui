import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from '../components/primitives/SectionHeader';
import { InstallationReadinessPanel } from '../components/onboarding/InstallationReadinessPanel';
import { ReadinessWizard } from '../components/onboarding/ReadinessWizard';
import { ReadinessChecklist } from '../components/onboarding/ReadinessChecklist';
import type { OnboardingMode, ReadinessReport, CategoryView, GateStatus, ReadinessCategory, CategorySummary, GateResult, ReadinessGate, Waiver } from '../components/onboarding/types';
import { buildCategoryViews, computeScore } from '../components/onboarding/types';
import { ALL_GATES, evaluateAllGates } from '../engine/readiness/gates';
import type { GateContext } from '../engine/readiness/types';
import { useClusterStore } from '../store/clusterStore';
import { agentFetch } from '../engine/safeQuery';
import { k8sFetch, k8sGet } from '../engine/query';
import { useOnboardingStore, type WaiverEntry } from '../store/onboardingStore';
import { LOCAL_CLUSTER_ID } from '../engine/clusterConnection';

const STORAGE_KEY = 'openshiftpulse:onboarding-completed';

function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markOnboardingComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    /* noop */
  }
}

const ALL_CATEGORIES: ReadinessCategory[] = [
  'prerequisites', 'security', 'reliability', 'observability', 'operations', 'gitops',
];

/**
 * A waived gate stays waived until it actually passes. Waivers are kept per
 * browser (the agent has no waiver endpoint), with the reason and who waived
 * it, so they survive a reload and say why the gate is not counted against
 * the score.
 */
export function applyWaivers(
  results: Record<string, GateResult>,
  waivers: Record<string, WaiverEntry>,
): Record<string, GateResult> {
  const out = { ...results };
  for (const [gateId, w] of Object.entries(waivers)) {
    const r = out[gateId];
    if (!r || r.status === 'passed' || r.status === 'checking') continue;
    out[gateId] = {
      ...r,
      status: 'waived',
      detail: `Waived${w.approvedBy ? ` by ${w.approvedBy}` : ''}: ${w.reason}`,
    };
  }
  return out;
}

/**
 * Category summaries and the score, from gate results. The one place this is
 * counted: the first evaluation counted a waived gate as passed and re-verify
 * counted it as not started, so the score dropped after any re-verify.
 */
export function summariseReadiness(
  results: Record<string, GateResult>,
  gates: ReadinessGate[],
): { categories: Record<ReadinessCategory, CategorySummary>; score: number } {
  const categories = {} as Record<ReadinessCategory, CategorySummary>;
  for (const catId of ALL_CATEGORIES) {
    const catGates = gates.filter((g) => g.category === catId);
    let passed = 0, failed = 0, needs_attention = 0, not_started = 0;
    for (const g of catGates) {
      switch (results[g.id]?.status ?? 'not_started') {
        case 'passed': case 'waived': passed++; break;
        case 'failed': failed++; break;
        case 'needs_attention': needs_attention++; break;
        default: not_started++; break;
      }
    }
    const total = catGates.length;
    categories[catId] = { passed, failed, needs_attention, not_started, total, score: total > 0 ? Math.round((passed / total) * 100) : 0 };
  }
  return { categories, score: computeScore(categories) };
}

function toReportWaivers(waivers: Record<string, WaiverEntry>): Record<string, Waiver> {
  return Object.fromEntries(
    Object.entries(waivers).map(([gateId, w]) => [
      gateId,
      { gateId, reason: w.reason, approvedBy: w.approvedBy ?? '', createdAt: w.waivedAt, expiresAt: null },
    ]),
  );
}

/** Dual-mode view: wizard for first-run, checklist for returning users. */
export default function OnboardingView() {
  const [mode, setMode] = React.useState<OnboardingMode>(
    hasCompletedOnboarding() ? 'checklist' : 'wizard',
  );
  const [report, setReport] = React.useState<ReadinessReport | null>(null);
  const [evalError, setEvalError] = React.useState<Error | null>(null);
  const isHyperShift = useClusterStore((s) => s.isHyperShift);

  const makeGateContext = React.useCallback((): GateContext => ({
    // Readiness describes the cluster Pulse is deployed on (its agent, its
    // Alertmanager), so the Kubernetes reads name that cluster explicitly.
    fetchJson: async <T = unknown,>(path: string): Promise<T> => {
      const res = await k8sFetch(LOCAL_CLUSTER_ID, path);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    fetchAgent: async <T = unknown,>(path: string): Promise<T> => {
      const res = await agentFetch(`/api/agent${path}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    isHyperShift,
  }), [isHyperShift]);

  const waivers = useOnboardingStore((s) => s.waivers);
  const addWaiver = useOnboardingStore((s) => s.addWaiver);
  // Who is waiving: the signed-in user of the cluster Pulse runs on. No
  // made-up author — if the lookup fails the waiver is recorded without one.
  const { data: currentUser = '' } = useQuery({
    queryKey: ['currentUser', LOCAL_CLUSTER_ID],
    queryFn: async () => {
      try {
        const data = await k8sGet<{ metadata?: { name?: string } }>('/apis/user.openshift.io/v1/users/~', LOCAL_CLUSTER_ID);
        return data.metadata?.name || '';
      } catch {
        return '';
      }
    },
    staleTime: 300_000,
  });

  /** Raw gate results, before waivers. Kept so a waiver can be applied or lifted without re-running gates. */
  const [rawResults, setRawResults] = React.useState<Record<string, GateResult> | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  // Evaluate all readiness gates against the live cluster
  React.useEffect(() => {
    let cancelled = false;
    setEvalError(null);
    evaluateAllGates(makeGateContext()).then((results) => {
      if (!cancelled) setRawResults(results);
    }).catch((err) => {
      if (cancelled) return;
      console.error('Evaluation failed:', err);
      setEvalError(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { cancelled = true; };
  }, [attempt, makeGateContext]);

  // The report is derived: raw results, then waivers, then one summary.
  React.useEffect(() => {
    if (!rawResults) return;
    const results = applyWaivers(rawResults, waivers);
    const { categories, score } = summariseReadiness(results, ALL_GATES);
    setReport({
      score,
      productionReady: score >= 80,
      results,
      waivers: toReportWaivers(waivers),
      categories,
      generatedAt: Date.now(),
    });
  }, [rawResults, waivers]);

  const categoryViews: CategoryView[] = React.useMemo(() => {
    if (!report) return [];
    return buildCategoryViews(report.results, report.categories, ALL_GATES);
  }, [report]);

  const handleWaive = React.useCallback((gateId: string, reason: string) => {
    addWaiver(gateId, reason.trim(), currentUser);
  }, [addWaiver, currentUser]);

  const handleReVerify = React.useCallback((gateId: string) => {
    const gate = ALL_GATES.find((g) => g.id === gateId);
    if (!gate) return;
    setRawResults((prev) => prev && prev[gateId]
      ? { ...prev, [gateId]: { ...prev[gateId], status: 'checking' as GateStatus } }
      : prev);

    gate.evaluate(makeGateContext()).then((result) => {
      setRawResults((prev) => ({ ...(prev ?? {}), [gateId]: result }));
    }).catch(() => {
      setRawResults((prev) => ({
        ...(prev ?? {}),
        [gateId]: {
          ...(prev?.[gateId] ?? { gateId, fixGuidance: '', evaluatedAt: Date.now() }),
          status: 'failed' as GateStatus,
          detail: 'Evaluation failed — check cluster connectivity',
        },
      }));
    });
  }, [makeGateContext]);

  const switchToChecklist = React.useCallback(() => {
    markOnboardingComplete();
    setMode('checklist');
  }, []);

  const switchToWizard = React.useCallback(() => {
    setMode('wizard');
  }, []);

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <SectionHeader
          icon={<ClipboardCheck className="w-6 h-6 text-violet-400" />}
          title="Cluster Readiness"
          subtitle="Evaluate production readiness across 6 categories"
          actions={
            <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-800 p-0.5">
              <button
                onClick={switchToWizard}
                className={cn(
                  'px-3 py-1 text-xs rounded-md transition-colors',
                  mode === 'wizard'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200',
                )}
              >
                Wizard
              </button>
              <button
                onClick={switchToChecklist}
                className={cn(
                  'px-3 py-1 text-xs rounded-md transition-colors',
                  mode === 'checklist'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200',
                )}
              >
                Checklist
              </button>
            </div>
          }
        />

        <InstallationReadinessPanel />

        {evalError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="text-sm text-red-400">Evaluation failed: {evalError.message}</span>
            <button
              onClick={() => { setReport(null); setRawResults(null); setAttempt((n) => n + 1); }}
              className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-sm transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !report ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            <span className="ml-3 text-sm text-slate-400">Evaluating cluster readiness...</span>
          </div>
        ) : mode === 'wizard' ? (
          <ReadinessWizard
            score={report.score}
            categories={categoryViews}
            onWaive={handleWaive}
            onReVerify={handleReVerify}
            onSwitchToChecklist={switchToChecklist}
          />
        ) : (
          <ReadinessChecklist
            score={report.score}
            categories={categoryViews}
            onWaive={handleWaive}
            onReVerify={handleReVerify}
            onSwitchToWizard={switchToWizard}
          />
        )}
      </div>
    </div>
  );
}
