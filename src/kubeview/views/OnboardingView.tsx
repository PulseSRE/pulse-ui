import React from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from '../components/primitives/SectionHeader';
import { ReadinessWizard } from '../components/onboarding/ReadinessWizard';
import { ReadinessChecklist } from '../components/onboarding/ReadinessChecklist';
import type { OnboardingMode, ReadinessReport, CategoryView, GateStatus, ReadinessCategory, CategorySummary } from '../components/onboarding/types';
import { buildCategoryViews, computeScore } from '../components/onboarding/types';
import { ALL_GATES, evaluateAllGates } from '../engine/readiness/gates';
import type { GateContext } from '../engine/readiness/types';
import { useClusterStore } from '../store/clusterStore';

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

/** Dual-mode view: wizard for first-run, checklist for returning users. */
export default function OnboardingView() {
  const [mode, setMode] = React.useState<OnboardingMode>(
    hasCompletedOnboarding() ? 'checklist' : 'wizard',
  );
  const [report, setReport] = React.useState<ReadinessReport | null>(null);
  const [evalError, setEvalError] = React.useState<Error | null>(null);
  const isHyperShift = useClusterStore((s) => s.isHyperShift);

  const makeGateContext = React.useCallback((): GateContext => ({
    fetchJson: async <T = unknown,>(path: string): Promise<T> => {
      const res = await fetch(`/api/kubernetes${path}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    fetchAgent: async <T = unknown,>(path: string): Promise<T> => {
      const res = await fetch(`/api/agent${path}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<T>;
    },
    isHyperShift,
  }), [isHyperShift]);

  // Evaluate all readiness gates against the live cluster
  React.useEffect(() => {
    let cancelled = false;
    const ctx = makeGateContext();

    evaluateAllGates(ctx).then((results) => {
      if (cancelled) return;

      // Build category summaries from real results
      const allCategories: ReadinessCategory[] = [
        'prerequisites', 'security', 'reliability', 'observability', 'operations', 'gitops',
      ];
      const categories = {} as Record<ReadinessCategory, CategorySummary>;
      for (const catId of allCategories) {
        const catGates = ALL_GATES.filter((g) => g.category === catId);
        let passed = 0;
        let failed = 0;
        let needs_attention = 0;
        let not_started = 0;
        for (const g of catGates) {
          const status = results[g.id]?.status ?? 'not_started';
          switch (status) {
            case 'passed': case 'waived': passed++; break;
            case 'failed': failed++; break;
            case 'needs_attention': needs_attention++; break;
            default: not_started++; break;
          }
        }
        const total = catGates.length;
        categories[catId] = { passed, failed, needs_attention, not_started, total, score: total > 0 ? Math.round((passed / total) * 100) : 0 };
      }

      const score = computeScore(categories);
      setReport({
        score,
        productionReady: score >= 80,
        results,
        waivers: {},
        categories,
        generatedAt: Date.now(),
      });
    }).catch((err) => {
      // H9: handle evaluation promise rejection
      if (cancelled) return;
      console.error('Evaluation failed:', err);
      setEvalError(err instanceof Error ? err : new Error(String(err)));
    });

    return () => { cancelled = true; };
  }, []);

  const categoryViews: CategoryView[] = React.useMemo(() => {
    if (!report) return [];
    return buildCategoryViews(report.results, report.categories, ALL_GATES);
  }, [report]);

  const handleWaive = React.useCallback((gateId: string, reason: string) => {
    setReport((prev) => {
      if (!prev) return prev;
      const results = { ...prev.results };
      if (results[gateId]) {
        results[gateId] = { ...results[gateId], status: 'waived' as GateStatus };
      }
      // Recompute category summaries
      const categories = { ...prev.categories };
      for (const [catId, summary] of Object.entries(categories)) {
        const catGates = ALL_GATES.filter((g) => g.category === catId);
        let passed = 0;
        let failed = 0;
        let needs_attention = 0;
        let not_started = 0;
        for (const g of catGates) {
          const status = results[g.id]?.status ?? 'not_started';
          switch (status) {
            case 'passed': case 'waived': passed++; break;
            case 'failed': failed++; break;
            case 'needs_attention': needs_attention++; break;
            default: not_started++; break;
          }
        }
        categories[catId as keyof typeof categories] = {
          ...summary,
          passed,
          failed,
          needs_attention,
          not_started,
          score: catGates.length > 0 ? Math.round((passed / catGates.length) * 100) : 0,
        };
      }
      return { ...prev, results, categories, score: computeScore(categories) };
    });
  }, []);

  const handleReVerify = React.useCallback((gateId: string) => {
    // Set status to checking
    setReport((prev) => {
      if (!prev) return prev;
      const results = { ...prev.results };
      if (results[gateId]) {
        results[gateId] = { ...results[gateId], status: 'checking' as GateStatus };
      }
      return { ...prev, results };
    });

    // Actually re-evaluate the gate
    const gate = ALL_GATES.find((g) => g.id === gateId);
    if (!gate) return;

    gate.evaluate(makeGateContext()).then((result) => {
      setReport((prev) => {
        if (!prev) return prev;
        const results = { ...prev.results, [gateId]: result };

        // Recompute category summaries
        const allCategories: ReadinessCategory[] = [
          'prerequisites', 'security', 'reliability', 'observability', 'operations', 'gitops',
        ];
        const categories = {} as Record<ReadinessCategory, CategorySummary>;
        for (const catId of allCategories) {
          const catGates = ALL_GATES.filter((g) => g.category === catId);
          let passed = 0, failed = 0, needs_attention = 0, not_started = 0;
          for (const g of catGates) {
            const r = results[g.id];
            if (!r) { not_started++; continue; }
            if (r.status === 'passed') passed++;
            else if (r.status === 'failed') failed++;
            else if (r.status === 'needs_attention') needs_attention++;
            else not_started++;
          }
          const summary = prev.categories[catId as keyof typeof prev.categories] || {};
          categories[catId as keyof typeof categories] = {
            ...summary,
            passed,
            failed,
            needs_attention,
            not_started,
            score: catGates.length > 0 ? Math.round((passed / catGates.length) * 100) : 0,
          };
        }
        return { ...prev, results, categories, score: computeScore(categories) };
      });
    }).catch(() => {
      setReport((prev) => {
        if (!prev) return prev;
        const results = { ...prev.results };
        results[gateId] = { ...results[gateId], status: 'failed' as GateStatus, detail: 'Evaluation failed — check cluster connectivity' };
        return { ...prev, results };
      });
    });
  }, []);

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

        {evalError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="text-sm text-red-400">Evaluation failed: {evalError.message}</span>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
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
