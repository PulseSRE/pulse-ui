/**
 * What on a dashboard needs attention right now.
 *
 * A summary written when a dashboard is created goes stale: the dashboard is
 * live and the text is not, so "cache is crash looping" would still be there
 * a week after the fix. Instead each widget reports its own state as it
 * renders (a metric card past its threshold, a status item in error), and the
 * strip at the top of the view lists what is currently wrong, or says that
 * nothing is.
 *
 * Only live widgets report: query-backed metric cards re-evaluate their
 * thresholds on every refresh. Snapshot widgets (a status list of the alerts
 * firing when the dashboard was built) would bring the staleness back, so they
 * do not. For the same reason the strip never claims everything is healthy: a
 * widget without thresholds says nothing either way. With nothing to report it
 * renders nothing.
 *
 * Widgets rendered outside a dashboard (chat, previews) have no provider, and
 * reporting is a no-op there.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AttentionLevel = 'warning' | 'critical';

export interface AttentionSignal {
  label: string;
  level: AttentionLevel;
  detail?: string;
}

type Report = (key: string, signal: AttentionSignal | null) => void;

const ReportContext = createContext<Report | null>(null);
const SignalsContext = createContext<Map<string, AttentionSignal>>(new Map());

export function AttentionProvider({ children }: { children: ReactNode }) {
  const [signals, setSignals] = useState<Map<string, AttentionSignal>>(() => new Map());

  const report = useCallback<Report>((key, signal) => {
    setSignals((prev) => {
      const current = prev.get(key);
      if (!signal) {
        if (!current) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      if (current && current.label === signal.label && current.level === signal.level && current.detail === signal.detail) {
        return prev;
      }
      const next = new Map(prev);
      next.set(key, signal);
      return next;
    });
  }, []);

  return (
    <ReportContext.Provider value={report}>
      <SignalsContext.Provider value={signals}>{children}</SignalsContext.Provider>
    </ReportContext.Provider>
  );
}

/** Report this widget's state; `level: null` means it is fine (or has no data yet). */
export function useReportAttention(key: string, label: string, level: AttentionLevel | null, detail?: string) {
  const report = useContext(ReportContext);
  useEffect(() => {
    if (!report) return;
    report(key, level ? { label, level, detail } : null);
    return () => report(key, null);
  }, [report, key, label, level, detail]);
}

const MAX_SHOWN = 6;

export function AttentionStrip({ className }: { className?: string }) {
  const signals = useContext(SignalsContext);
  if (signals.size === 0) return null;

  const items = [...signals.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));
  const critical = items.some((i) => i.level === 'critical');
  const shown = items.slice(0, MAX_SHOWN);
  return (
    <div
      role="status"
      aria-label={`${items.length} item${items.length === 1 ? '' : 's'} need attention`}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-1.5 text-xs',
        critical ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5',
        className,
      )}
    >
      <span className={cn('font-semibold', critical ? 'text-red-300' : 'text-amber-300')}>Needs attention</span>
      {shown.map((item, i) => (
        <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1 text-slate-200">
          {item.level === 'critical' ? (
            <XCircle className="h-3.5 w-3.5 text-red-400" aria-label="critical" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-label="warning" />
          )}
          {item.label}
          {item.detail && <span className="text-slate-400">{item.detail}</span>}
        </span>
      ))}
      {items.length > MAX_SHOWN && <span className="text-slate-400">+{items.length - MAX_SHOWN} more</span>}
    </div>
  );
}
