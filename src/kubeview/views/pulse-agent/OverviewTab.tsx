import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchFixHistorySummary,
  fetchScannerCoverage,
  fetchAgentHealth,
  fetchCapabilities,
  fetchAgentVersion,
  fetchAgentActivity,
  type ActivityEvent,
  type FixHistorySummary,
} from '../../engine/analyticsApi';
import { fetchFixHistory, actionCategoryLabel, type ActionRecord } from '../../engine/fixHistory';
import { fixActivityLink } from '../../engine/fixOutcomes';
import { TrustPolicy } from '../mission-control/TrustPolicy';
import { classifyAgentLink } from '../../engine/agentLinks';
import { ScannerDrawer } from '../mission-control/ScannerDrawer';
import { LoadError } from '../../components/primitives/LoadError';
import { TONE_CLASSES, statusTone } from '../../engine/statusColors';

export function OverviewTab() {
  // `?drawer=scanners` opens the scanner drawer (Analytics links here rather
  // than keeping its own copy).
  const [searchParams, setSearchParams] = useSearchParams();
  const [scannerDrawerOpen, setScannerDrawerOpenState] = useState(searchParams.get('drawer') === 'scanners');
  const setScannerDrawerOpen = (open: boolean) => {
    setScannerDrawerOpenState(open);
    if (!open && searchParams.get('drawer')) {
      const next = new URLSearchParams(searchParams);
      next.delete('drawer');
      setSearchParams(next, { replace: true });
    }
  };

  const healthQ = useQuery({ queryKey: ['agent', 'health'], queryFn: fetchAgentHealth, refetchInterval: 30_000 });
  const fixQ = useQuery({ queryKey: ['agent', 'fix-history-summary'], queryFn: () => fetchFixHistorySummary(), staleTime: 60_000 });
  const coverageQ = useQuery({ queryKey: ['agent', 'scanner-coverage'], queryFn: () => fetchScannerCoverage(), staleTime: 60_000 });
  const capQ = useQuery({ queryKey: ['agent', 'capabilities'], queryFn: fetchCapabilities, staleTime: 60_000 });
  const versionQ = useQuery({ queryKey: ['agent', 'version'], queryFn: fetchAgentVersion, staleTime: 5 * 60_000 });
  const activityQ = useQuery({ queryKey: ['agent', 'activity'], queryFn: () => fetchAgentActivity(7), staleTime: 60_000 });

  const scannerCount = coverageQ.data?.active_scanners ?? 0;
  // These are fix actions, not issues: an issue Pulse only reported is not here.
  const totalFixes = (fixQ.data?.completed ?? 0) + (fixQ.data?.failed ?? 0) + (fixQ.data?.rolled_back ?? 0);
  const cbState = healthQ.data?.circuit_breaker?.state?.toLowerCase();
  const isDegraded = cbState === 'open';
  // The activity feed and fix history are separate endpoints. When the feed
  // comes back empty but fix history has actions this week, the feed is wrong
  // about "nothing happened": show the fix history's newest actions instead.
  const activityEmpty = activityQ.isSuccess && (activityQ.data?.events ?? []).length === 0;
  const recentFixesQ = useQuery({
    queryKey: ['agent', 'fix-history-recent'],
    queryFn: () => fetchFixHistory({ page: 1, filters: { since: Date.now() - WEEK_MS } }),
    enabled: activityEmpty && totalFixes > 0,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      {/* 1. Status Sentence */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4">
        <StatusSentence
          isDegraded={isDegraded}
          loading={fixQ.isLoading || coverageQ.isLoading}
          unreadable={[fixQ.isError && 'fix history', coverageQ.isError && 'scanner coverage'].filter((x): x is string => Boolean(x))}
          onRetry={() => { void fixQ.refetch(); void coverageQ.refetch(); }}
          scannerCount={scannerCount}
          totalFixes={totalFixes}
          fixedCount={fixQ.data?.completed ?? 0}
          verifiedHeld={fixQ.data ? verifiedHeldOf(fixQ.data) : null}
          failedCount={fixQ.data?.failed ?? 0}
          rolledBackCount={fixQ.data?.rolled_back ?? 0}
          onScannerClick={() => setScannerDrawerOpen(true)}
        />
      </div>

      {/* 2. Recent Activity */}
      <ActivitySection
        events={activityQ.data?.events ?? []}
        isLoading={activityQ.isLoading}
        error={activityQ.isError ? activityQ.error : null}
        onRetry={() => { void activityQ.refetch(); }}
        fixHistory={{
          // Unknown (still loading or unreadable) is not zero: never claim "no intervention" then.
          total: fixQ.isSuccess ? totalFixes : null,
          recent: recentFixesQ.data?.actions,
          recentLoading: recentFixesQ.isLoading,
          recentError: recentFixesQ.isError,
        }}
      />

      {/* 3. Trust Controls */}
      <TrustPolicy
        maxTrustLevel={capQ.data?.max_trust_level ?? 0}
        effectiveTrustLevel={capQ.data?.effective_trust_level}
        scannerCount={coverageQ.data?.active_scanners ?? null}
        fixSummary={fixQ.data ?? null}
        supportedAutoFixCategories={capQ.data?.supported_auto_fix_categories}
        autofixPaused={healthQ.data?.autofix_paused}
        onPauseChanged={() => healthQ.refetch()}
        pauseStateError={healthQ.isError && healthQ.data === undefined ? (healthQ.error ?? new Error('Agent health could not be read')) : undefined}
      />

      {/* 4. Agent Info Footer */}
      {versionQ.data && (
        <div className="text-xs text-faint flex items-center gap-1.5 justify-center py-2">
          <Bot className="w-3 h-3" />
          <span>v{versionQ.data.agent}</span>
          <span>&middot;</span>
          <span>Protocol v{versionQ.data.protocol}</span>
          <span>&middot;</span>
          <Link to="/agent?tab=tools" className="text-faint hover:text-slate-300">{versionQ.data.tools} tools</Link>
          <span>&middot;</span>
          <Link to="/agent?tab=skills" className="text-faint hover:text-slate-300">{versionQ.data.skills} skills</Link>
        </div>
      )}

      {scannerDrawerOpen && <ScannerDrawer coverage={coverageQ.data ?? null} supportedAutoFixCategories={capQ.data?.supported_auto_fix_categories} onClose={() => setScannerDrawerOpen(false)} />}
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fixes verification saw hold, or null for an agent before pulse-agent#258.
 * From #258 (`applied_rate` present) the summary's success figures count
 * verified-held fixes (`verification.resolved`) and `completed` is "applied"
 * (the write was accepted, held or not). Older agents fall back to
 * applied / failed only.
 */
export function verifiedHeldOf(summary: FixHistorySummary): number | null {
  if (summary.applied_rate === undefined) return null;
  const resolved = summary.verification?.resolved;
  return typeof resolved === 'number' ? resolved : null;
}

/** Inbox › Activity filtered to fixes with this status (shared with Mission Control). */
export { fixActivityLink };

function StatusSentence({
  isDegraded, loading, unreadable, onRetry, scannerCount, totalFixes, fixedCount, verifiedHeld, failedCount, rolledBackCount, onScannerClick,
}: {
  isDegraded: boolean; loading: boolean; unreadable: string[]; onRetry: () => void;
  scannerCount: number; totalFixes: number;
  /** Applied fixes (`completed`): the write went through, held or not. */
  fixedCount: number;
  /** Applied fixes verification saw hold; null when the agent does not report it. */
  verifiedHeld: number | null;
  failedCount: number; rolledBackCount: number; onScannerClick: () => void;
}) {
  if (isDegraded) {
    return (
      <p className="text-sm text-red-300">
        Pulse is <span className="font-medium text-red-400">degraded</span> &mdash; circuit breaker is open. Check agent logs.
      </p>
    );
  }

  if (unreadable.length > 0) {
    return (
      <LoadError title={`Pulse status is unknown — ${unreadable.join(' and ')} could not be loaded`} onRetry={onRetry} />
    );
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Checking Pulse status…</p>;
  }

  if (totalFixes > 0) {
    // Each outcome by its real name: a failed fix is "failed", not "needs
    // attention" (which reads as open findings), and links to those fixes.
    const parts: React.ReactNode[] = [];
    // "Applied" is what `completed` means: the write was accepted. Whether the
    // fix held is verification's answer, shown beside it when the agent gives it.
    if (fixedCount > 0) {
      parts.push(
        <React.Fragment key="ok">
          <Link to={fixActivityLink('completed')} className="text-emerald-400 hover:underline" data-testid="fixes-applied">{fixedCount} applied</Link>
          {verifiedHeld !== null && <span data-testid="fixes-verified"> ({verifiedHeld} verified as held)</span>}
        </React.Fragment>,
      );
    }
    if (failedCount > 0) parts.push(<Link key="failed" to={fixActivityLink('failed')} className="text-red-400 hover:underline" data-testid="fixes-failed">{failedCount} failed</Link>);
    if (rolledBackCount > 0) parts.push(<Link key="rb" to={fixActivityLink('rolled_back')} className="text-amber-400 hover:underline">{rolledBackCount} rolled back</Link>);
    return (
      <p className="text-sm text-slate-300">
        Pulse took{' '}
        <Link to={fixActivityLink()} className="text-blue-400 hover:underline">{totalFixes} fix action{totalFixes !== 1 ? 's' : ''}</Link>
        {' '}this week{parts.length ? ': ' : '.'}
        {parts.map((part, i) => <React.Fragment key={i}>{i > 0 ? ', ' : ''}{part}</React.Fragment>)}
        {parts.length ? '.' : ''}
      </p>
    );
  }

  return (
    <p className="text-sm text-slate-300">
      Pulse is monitoring your cluster.{' '}
      <button onClick={onScannerClick} className="text-blue-400 hover:underline">{scannerCount} scanner{scannerCount !== 1 ? 's' : ''}</button>
      {' '}active; no fixes this week. <Link to="/inbox" className="text-blue-400 hover:underline">Open findings are in the Inbox.</Link>
    </p>
  );
}

const EVENT_COLORS: Record<string, string> = {
  auto_fix: 'text-emerald-400',
  // Verification outcomes (pulse-agent#259).
  fix_verified: 'text-emerald-400',
  fix_not_held: 'text-red-400',
  fix_improved: 'text-blue-400',
  fix_unverifiable: 'text-slate-400',
  fix_failed: 'text-red-400',
  rollback: 'text-amber-400',
  self_healed: 'text-blue-400',
  postmortem: 'text-teal-400',
  investigation: 'text-slate-400',
};

/** How many recent agent events the Overview summarises; the full list is Inbox › Activity. */
const ACTIVITY_PREVIEW = 3;

interface FixHistoryFallback {
  /** Fix actions this week per fix history, or null when not known. */
  total: number | null;
  recent?: ActionRecord[];
  recentLoading: boolean;
  recentError: boolean;
}

/** A rolled-back fix is a warning, not a failure; the rest follow the shared status palette. */
const fixStatusText = (status: ActionRecord['status']) =>
  TONE_CLASSES[status === 'rolled_back' ? 'warning' : statusTone(status)].text;

/** The activity feed is empty but fix history is not: say so and show the fixes. */
function FixHistoryFallbackList({ fixHistory }: { fixHistory: FixHistoryFallback & { total: number } }) {
  const { total, recent, recentLoading } = fixHistory;
  return (
    <div className="space-y-2" data-testid="activity-fix-fallback">
      <p className="text-sm text-slate-400">
        The activity feed is empty, but fix history records {total} fix action{total === 1 ? '' : 's'} this week.
        {recent && recent.length > 0 ? ' The newest:' : ''}
      </p>
      {recentLoading && <p className="text-xs text-faint">Loading the newest fixes…</p>}
      {recent && recent.length > 0 && (
        <ul className="space-y-1.5">
          {recent.slice(0, ACTIVITY_PREVIEW).map((a) => (
            <li key={a.id}>
              <Link to={fixActivityLink(a.status === 'failed' || a.status === 'rolled_back' || a.status === 'completed' ? a.status : undefined)}
                className={cn('text-sm hover:underline flex items-center gap-2', fixStatusText(a.status))}>
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                {a.tool || actionCategoryLabel(a.category)}
                {a.resources?.[0] ? ` on ${a.resources[0].kind} ${a.resources[0].namespace ? `${a.resources[0].namespace}/` : ''}${a.resources[0].name}` : ''}
                {' '}&mdash; {a.status.replace('_', ' ')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivitySection({ events, isLoading, error, onRetry, fixHistory }: {
  events: ActivityEvent[]; isLoading: boolean; error: unknown; onRetry: () => void;
  fixHistory: FixHistoryFallback;
}) {
  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h2>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-slate-800 rounded-sm w-3/4" />
          <div className="h-4 bg-slate-800 rounded-sm w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h2>
      {error ? (
        // A failed read is not "the agent hasn't needed to intervene".
        <LoadError title="Recent activity could not be loaded" error={error} onRetry={onRetry} />
      ) : events.length === 0 ? (
        fixHistory.total !== null && fixHistory.total > 0 ? (
          <FixHistoryFallbackList fixHistory={{ ...fixHistory, total: fixHistory.total }} />
        ) : fixHistory.total === 0 ? (
          <p className="text-sm text-faint">No activity yet. The agent is monitoring but hasn&apos;t needed to intervene.</p>
        ) : (
          // Fix history is unknown: an empty feed alone does not show the agent did nothing.
          <p className="text-sm text-faint">The activity feed is empty.</p>
        )
      ) : (
        <ul className="space-y-1.5">
          {events.slice(0, ACTIVITY_PREVIEW).map((evt, i) => {
            const target = classifyAgentLink(evt.link);
            const color = EVENT_COLORS[evt.type] ?? 'text-slate-300';
            return (
              <li key={i}>
                {target.kind === 'internal' ? (
                  <Link to={target.to} className={cn('text-sm hover:underline flex items-center gap-2', color)}>
                    <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                    {evt.description}
                  </Link>
                ) : (
                  <span className={cn('text-sm flex items-center gap-2', color)}>
                    <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                    {evt.description}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/inbox?tab=activity" className="mt-3 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
        {events.length > ACTIVITY_PREVIEW ? `All ${events.length} agent actions` : 'All agent activity'} in the Inbox <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
