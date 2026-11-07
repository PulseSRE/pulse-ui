import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, CloudUpload, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '../components/primitives/PageHeader';
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
import {
  fetchClusterWaivers,
  saveClusterWaiver,
  deleteClusterWaiver,
  isActiveWaiver,
  type WaiverListResult,
  type WaiverStorage,
} from '../engine/readiness/waivers';

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
 * A waived gate stays waived until it actually passes (or the waiver expires).
 * Waivers are kept by the agent for the cluster it runs on, with the reason
 * and the admin who waived it, so everyone sees the same ones. An agent from
 * before `/readiness/waivers` answers 404, and only then are waivers kept in
 * this browser, as they used to be.
 */
/** Browser-stored waivers are filed per cluster: `<clusterId>/<gateId>`. */
export function waiverKey(clusterId: string, gateId: string): string {
  return `${clusterId}/${gateId}`;
}

/** This cluster's waivers, keyed by gate id. */
export function waiversFor(clusterId: string, all: Record<string, WaiverEntry>): Record<string, WaiverEntry> {
  const prefix = `${clusterId}/`;
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith(prefix)).map(([k, w]) => [k.slice(prefix.length), w]),
  );
}

export function applyWaivers(
  results: Record<string, GateResult>,
  waivers: Record<string, Pick<Waiver, 'reason' | 'approvedBy'> & Partial<Pick<Waiver, 'expiresAt'>>>,
  now = Date.now(),
): Record<string, GateResult> {
  const out = { ...results };
  for (const [gateId, w] of Object.entries(waivers)) {
    const r = out[gateId];
    if (!r || r.status === 'passed' || r.status === 'checking') continue;
    if (!isActiveWaiver({ expiresAt: w.expiresAt ?? null }, now)) continue;
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

/** Browser-stored waivers in the shape the agent's waivers have. */
export function toReportWaivers(waivers: Record<string, WaiverEntry>): Record<string, Waiver> {
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

  // Readiness describes the cluster Pulse is deployed on, so its waivers are that cluster's.
  const queryClient = useQueryClient();
  const waiverQuery = useQuery<WaiverListResult>({
    queryKey: ['readiness-waivers', LOCAL_CLUSTER_ID],
    queryFn: fetchClusterWaivers,
    staleTime: 30_000,
    retry: false,
  });
  const waiverStorage: WaiverStorage | undefined = waiverQuery.data?.storage;

  const allBrowserWaivers = useOnboardingStore((s) => s.waivers);
  const browserWaivers = React.useMemo(() => waiversFor(LOCAL_CLUSTER_ID, allBrowserWaivers), [allBrowserWaivers]);
  const addWaiver = useOnboardingStore((s) => s.addWaiver);
  const removeWaiver = useOnboardingStore((s) => s.removeWaiver);

  /** The waivers that count: the cluster's, or this browser's on an agent without the endpoint. */
  const waivers: Record<string, Waiver> = React.useMemo(() => {
    const data = waiverQuery.data;
    if (!data) return {};
    return data.storage === 'cluster' ? data.waivers : toReportWaivers(browserWaivers);
  }, [waiverQuery.data, browserWaivers]);

  // Once the cluster has a waiver for a gate, the browser copy is redundant —
  // and harmful to keep: after that waiver is lifted or expires, the stale
  // copy would be offered for "saving" again, and one click would re-waive a
  // gate someone deliberately un-waived. So drop it as soon as the list says so.
  React.useEffect(() => {
    const data = waiverQuery.data;
    if (data?.storage !== 'cluster') return;
    for (const gateId of Object.keys(browserWaivers)) {
      if (data.waivers[gateId]) removeWaiver(waiverKey(LOCAL_CLUSTER_ID, gateId));
    }
  }, [waiverQuery.data, browserWaivers, removeWaiver]);

  /** Browser-only waivers for gates the cluster has no waiver for: offered for saving, not counted. */
  const browserOnly = React.useMemo(() => {
    const data = waiverQuery.data;
    if (data?.storage !== 'cluster') return [];
    return Object.entries(browserWaivers).filter(([gateId]) => !data.waivers[gateId]);
  }, [waiverQuery.data, browserWaivers]);

  // Who is waiving in the browser fallback: the signed-in user of the cluster
  // Pulse runs on. No made-up author — if the lookup fails the waiver is
  // recorded without one. (The agent records its own authenticated user.)
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
  // It waits for the waiver list (or its failure) so the score is not shown
  // without waivers and then jump once they arrive.
  const waiversSettled = !waiverQuery.isPending;
  React.useEffect(() => {
    if (!rawResults || !waiversSettled) return;
    const results = applyWaivers(rawResults, waivers);
    const { categories, score } = summariseReadiness(results, ALL_GATES);
    setReport({
      score,
      productionReady: score >= 80,
      results,
      waivers,
      categories,
      generatedAt: Date.now(),
    });
  }, [rawResults, waivers, waiversSettled]);

  const categoryViews: CategoryView[] = React.useMemo(() => {
    if (!report) return [];
    return buildCategoryViews(report.results, report.categories, ALL_GATES);
  }, [report]);

  const setClusterWaiver = React.useCallback((gateId: string, waiver: Waiver | null) => {
    queryClient.setQueryData<WaiverListResult>(['readiness-waivers', LOCAL_CLUSTER_ID], (prev) => {
      if (!prev || prev.storage !== 'cluster') return prev;
      const next = { ...prev.waivers };
      if (waiver) next[gateId] = waiver;
      else delete next[gateId];
      return { storage: 'cluster', waivers: next };
    });
  }, [queryClient]);

  /** Throws on failure, so the dialog keeps the reason and shows why. */
  const handleWaive = React.useCallback(async (gateId: string, reason: string, expiresAt: number | null = null) => {
    if (waiverStorage === 'cluster') {
      const saved = await saveClusterWaiver(gateId, reason.trim(), expiresAt);
      setClusterWaiver(gateId, saved);
      return;
    }
    if (waiverStorage === 'browser') {
      addWaiver(waiverKey(LOCAL_CLUSTER_ID, gateId), reason.trim(), currentUser);
      return;
    }
    throw new Error(
      waiverQuery.error
        ? `Waivers could not be loaded from the agent, so this waiver cannot be saved: ${waiverQuery.error.message}`
        : 'Still checking where waivers are kept. Try again in a moment.',
    );
  }, [waiverStorage, setClusterWaiver, addWaiver, currentUser, waiverQuery.error]);

  /** Throws on failure, so the card keeps the waiver and shows why. */
  const handleUnwaive = React.useCallback(async (gateId: string) => {
    if (waiverStorage === 'cluster') {
      await deleteClusterWaiver(gateId);
      setClusterWaiver(gateId, null);
      return;
    }
    if (waiverStorage === 'browser') {
      removeWaiver(waiverKey(LOCAL_CLUSTER_ID, gateId));
      return;
    }
    throw new Error('Waivers could not be loaded from the agent, so this waiver cannot be removed.');
  }, [waiverStorage, setClusterWaiver, removeWaiver]);

  // One-time move of browser-only waivers to the cluster, offered rather than run.
  const [migration, setMigration] = React.useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const handleMigrate = React.useCallback(async () => {
    setMigration({ running: true, error: null });
    const failures: string[] = [];
    let saved = 0;
    for (const [gateId, w] of browserOnly) {
      // The agent records whoever saves it now; keep the original author and date in the reason.
      const origin = `waived in a browser${w.approvedBy ? ` by ${w.approvedBy}` : ''}${w.waivedAt ? ` on ${new Date(w.waivedAt).toISOString().slice(0, 10)}` : ''}`;
      try {
        const waiver = await saveClusterWaiver(gateId, `${w.reason} (${origin})`);
        setClusterWaiver(gateId, waiver);
        removeWaiver(waiverKey(LOCAL_CLUSTER_ID, gateId));
        saved++;
      } catch (err) {
        failures.push(`${gateId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setMigration({
      running: false,
      error: failures.length
        ? `Saved ${saved} of ${saved + failures.length}; the rest are still in this browser. ${failures.join(' ')}`
        : null,
    });
  }, [browserOnly, setClusterWaiver, removeWaiver]);

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
      <div className="max-w-content mx-auto space-y-6">
        <PageHeader
          icon={<ClipboardCheck className="w-6 h-6 text-blue-400" />}
          title="Cluster Readiness"
          subtitle="Evaluate production readiness across 6 categories"
          actions={
            <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-800 p-0.5">
              <button
                onClick={switchToWizard}
                className={cn(
                  'px-3 py-1 text-xs rounded-md transition-colors',
                  mode === 'wizard'
                    ? 'bg-blue-600 text-white'
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
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200',
                )}
              >
                Checklist
              </button>
            </div>
          }
        />

        <InstallationReadinessPanel />

        {waiverQuery.isError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              {waiverQuery.error.message} Waived gates are counted as not passed until waivers load.
            </div>
            <button
              onClick={() => waiverQuery.refetch()}
              className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-sm"
            >
              Retry
            </button>
          </div>
        )}

        {waiverStorage === 'browser' && (
          <div data-testid="waiver-browser-banner" className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
            This agent does not provide shared waivers. Waivers are kept in this browser
            only; other people and other browsers do not see them.
          </div>
        )}

        {browserOnly.length > 0 && (
          <div data-testid="waiver-migration" className="flex flex-col gap-2 rounded-lg border border-blue-900/60 bg-blue-950/20 px-4 py-3 text-sm text-blue-200">
            <div className="flex items-start gap-2">
              <CloudUpload className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                {browserOnly.length === 1 ? 'One waiver is' : `${browserOnly.length} waivers are`} saved only in this
                browser ({browserOnly.map(([id]) => id).join(', ')}). They are not counted until they are saved to
                the cluster, where everyone can see them. Saving requires Pulse administrator access (if configured).
              </div>
              <button
                onClick={handleMigrate}
                disabled={migration.running}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-sm whitespace-nowrap"
              >
                {migration.running
                  ? 'Saving…'
                  : `Save ${browserOnly.length === 1 ? 'this browser-only waiver' : `these ${browserOnly.length} browser-only waivers`} to the cluster`}
              </button>
            </div>
            {migration.error && <div role="alert" className="text-xs text-red-300">{migration.error}</div>}
          </div>
        )}

        {evalError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="text-sm text-red-400">Evaluation failed: {evalError.message}</span>
            <button
              onClick={() => { setReport(null); setRawResults(null); setAttempt((n) => n + 1); }}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-sm transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !report ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            <span className="ml-3 text-sm text-slate-400">Evaluating cluster readiness...</span>
          </div>
        ) : mode === 'wizard' ? (
          <ReadinessWizard
            score={report.score}
            categories={categoryViews}
            onWaive={handleWaive}
            waivers={report.waivers}
            waiverStorage={waiverStorage}
            waiverLoadError={waiverQuery.error?.message}
            onUnwaive={handleUnwaive}
            onReVerify={handleReVerify}
            onSwitchToChecklist={switchToChecklist}
          />
        ) : (
          <ReadinessChecklist
            score={report.score}
            categories={categoryViews}
            onWaive={handleWaive}
            waivers={report.waivers}
            waiverStorage={waiverStorage}
            waiverLoadError={waiverQuery.error?.message}
            onUnwaive={handleUnwaive}
            onReVerify={handleReVerify}
            onSwitchToWizard={switchToWizard}
          />
        )}
      </div>
    </div>
  );
}
