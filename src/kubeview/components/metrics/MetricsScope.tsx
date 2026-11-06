/**
 * MetricsScope — one honest banner for a group of metric widgets.
 *
 * When Prometheus is down, every card on a page fails for the same reason. A
 * red box and a Retry on each one repeats the same sentence four to six times
 * and puts buttons inside clickable cards. Inside a scope, each card shows a
 * quiet "—" and reports its failure here; the scope shows one DegradedBanner
 * ("Metrics could not be read — cards below are unknown") with the reason and
 * a Retry that re-reads every failed card.
 */

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import { DegradedBanner } from '../primitives/DegradedBanner';
import { describeReadError } from '../../engine/readError';

interface Failure {
  error: unknown;
  retry: () => void;
}

interface Scope {
  report: (id: string, failure: Failure | null) => void;
}

const ScopeContext = createContext<Scope | null>(null);

/** Whether this widget is inside a MetricsScope (which then shows the error). */
export function useInMetricsScope(): boolean {
  return useContext(ScopeContext) !== null;
}

/** Report a widget's read state to the nearest MetricsScope, if any. */
export function useReportMetricFailure(isError: boolean, error: unknown, refetch: () => unknown): void {
  const scope = useContext(ScopeContext);
  const id = useId();
  useEffect(() => {
    scope?.report(id, isError ? { error, retry: () => { void refetch(); } } : null);
  }, [scope, id, isError, error, refetch]);
  // Leaving the page (or the scope) takes the failure with it.
  useEffect(() => () => scope?.report(id, null), [scope, id]);
}

export function MetricsScope({ children, className }: { children: React.ReactNode; className?: string }) {
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const report = useCallback((id: string, failure: Failure | null) => {
    setFailures((prev) => {
      if (!failure) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id]?.error === failure.error) return prev;
      return { ...prev, [id]: failure };
    });
  }, []);
  const scope = useMemo(() => ({ report }), [report]);
  const list = Object.values(failures);

  return (
    <ScopeContext.Provider value={scope}>
      {list.length > 0 && (
        <DegradedBanner
          reason="observability_unavailable"
          title="Metrics could not be read — cards below are unknown"
          description={describeReadError(list[0].error).reason}
          onRetry={() => list.forEach((f) => f.retry())}
          className={className ?? 'mb-3 rounded'}
        />
      )}
      {children}
    </ScopeContext.Provider>
  );
}
