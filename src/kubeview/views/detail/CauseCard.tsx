/**
 * "Pulse found the cause": the open monitor finding for this resource (or the
 * workload that owns it, or — on a workload page — one of its pods), with the
 * investigation's cause, evidence, the alternatives it ruled out, confidence
 * and when. No finding: a Diagnose button that asks the agent through the
 * inbox and shows the report in the same card. Diagnose tells the agent what
 * kind of problem it is (the open finding's category, else what the page's
 * pods show) so it runs the matching plan template; unsure, it says nothing.
 *
 * Findings come from the monitor's WebSocket and describe the agent's own
 * cluster only; when that connection is down the card says so instead of
 * "nothing found".
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMonitorStore } from '../../store/monitorStore';
import { useFleetStore } from '../../store/fleetStore';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import type { Finding, InvestigationReport as MonitorReport, EvidenceItem } from '../../engine/monitorClient';
import type { InvestigationReport as InboxReport } from '../../engine/inboxApi';
import { useDiagnose, type DiagnoseTarget } from './useDiagnose';
import { categoryFromFinding, type PlanCategory } from '../../engine/diagnoseCategory';
import { resolveKind } from '../../engine/kindRegistry';
import { formatRelative, formatClock } from '../../engine/format';
import { PULSE_AI_LOCAL_ONLY } from '../../components/feedback/LocalClusterOnlyNotice';

const SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };

export interface CauseMatch {
  kind: string;
  name: string;
  namespace: string;
  /** The workload that owns the resource (pod page). */
  owner?: { kind: string; name: string };
  /** Pods of the workload (workload page). */
  podNames?: string[];
}

/** The open, undismissed monitor finding about this resource, worst and newest first. */
export function findingFor(findings: Finding[], dismissed: string[], m: CauseMatch): Finding | null {
  const pods = new Set(m.podNames ?? []);
  const hit = findings.filter((f) => !dismissed.includes(f.id) && f.category !== 'degraded' && f.resources.some((r) => {
    // Namespaced kinds must be in this namespace (a missing namespace is not a match).
    const namespaced = resolveKind(r.kind).namespaced ?? true;
    if (namespaced && r.namespace !== m.namespace) return false;
    if (r.kind === m.kind && r.name === m.name) return true;
    if (m.owner && r.kind === m.owner.kind && r.name === m.owner.name) return true;
    if (m.owner && r.ownerKind === m.owner.kind && r.ownerName === m.owner.name) return true;
    if (r.ownerKind === m.kind && r.ownerName === m.name) return true;
    return r.kind === 'Pod' && pods.has(r.name);
  }));
  hit.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || b.timestamp - a.timestamp);
  return hit[0] ?? null;
}

function hhmm(ms: number | undefined): string {
  return ms ? formatClock(ms) : '—';
}

function evidenceLines(detail: EvidenceItem[] | undefined, plain: string[] | undefined): Array<{ text: string; source?: string; unverified?: boolean }> {
  if (detail && detail.length) {
    return detail.filter((e) => e.stance !== 'contradicts').map((e) => ({ text: e.observation, source: e.source, unverified: !!e.unverified_source }));
  }
  return (plain ?? []).map((t) => ({ text: t }));
}

interface ReportView {
  /** The suspected cause; empty when the investigation named none. */
  cause: string;
  /** The investigation's summary, shown as context. */
  summary: string;
  evidence: Array<{ text: string; source?: string; unverified?: boolean }>;
  alternatives: string[];
  confidence?: number;
}

function fromMonitor(r: MonitorReport): ReportView {
  return { cause: (r.suspectedCause || '').trim(), summary: r.summary || '', evidence: evidenceLines(r.evidenceDetail, r.evidence), alternatives: r.alternativesConsidered ?? [], confidence: r.confidence };
}

function fromInbox(r: InboxReport): ReportView {
  return {
    cause: (r.suspected_cause || r.suspectedCause || '').trim(),
    summary: r.summary || '',
    evidence: evidenceLines(r.evidence_detail, r.evidence),
    alternatives: r.alternatives_considered ?? r.alternativesConsidered ?? [],
    confidence: r.confidence,
  };
}

function Report({ view }: { view: ReportView }) {
  return (
    <>
      {view.cause ? (
        <p className="text-[15px] leading-relaxed text-slate-100">{view.cause}</p>
      ) : (
        <p className="text-[15px] leading-relaxed text-slate-300" data-testid="no-cause">The investigation did not identify a cause.</p>
      )}
      {view.summary && view.summary !== view.cause && <p className="text-[13px] text-slate-400">{view.summary}</p>}
      {view.evidence.length > 0 && (
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-snug text-slate-300" aria-label="Evidence">
          {view.evidence.map((e, i) => (
            <li key={i}>
              {e.text}
              {e.source && <span className="text-faint"> — from {e.source}</span>}
              {e.unverified && <span className="text-amber-300"> (source not verified)</span>}
            </li>
          ))}
        </ul>
      )}
      {view.alternatives.length > 0 && (
        <details className="text-[13px] text-slate-400">
          <summary className="cursor-pointer">Also considered (ruled out)</summary>
          <div className="pt-1.5 leading-relaxed">{view.alternatives.join(' · ')}</div>
        </details>
      )}
    </>
  );
}

function Confidence({ value }: { value?: number }) {
  if (value === undefined || value === null) return <span className="ml-auto text-xs text-faint">Confidence not reported</span>;
  return <span className="ml-auto rounded-full bg-blue-950 px-2.5 py-0.5 text-xs text-blue-200">Confidence {value.toFixed(2)}</span>;
}

/** Seconds left until `until` (epoch ms), re-rendering each second; 0 when passed or unset. */
function useCountdown(until: number | undefined): number {
  const [, setTick] = React.useState(0);
  const secs = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  React.useEffect(() => {
    if (!until) return undefined;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  return secs;
}

function formatWait(secs: number): string {
  if (secs < 120) return `${secs}s`;
  const m = Math.ceil(secs / 60);
  return m < 120 ? `${m} min` : `${Math.ceil(m / 60)} h`;
}

export function CauseCard({ match, noun, inferredCategory }: {
  match: CauseMatch;
  noun: string;
  /** What the page's own objects show (`engine/diagnoseCategory`); an open finding's category wins. */
  inferredCategory?: PlanCategory;
}) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const connected = useMonitorStore((s) => s.connected);
  const connectionError = useMonitorStore((s) => s.connectionError);
  const findings = useMonitorStore((s) => s.findings);
  const dismissed = useMonitorStore((s) => s.dismissedFindingIds);
  const investigations = useMonitorStore((s) => s.investigations);
  const remote = clusterId !== LOCAL_CLUSTER_ID;
  const podKey = (match.podNames ?? []).join(',');
  const finding = React.useMemo(
    () => (remote ? null : findingFor(findings, dismissed, match)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remote, findings, dismissed, match.kind, match.name, match.namespace, match.owner?.kind, match.owner?.name, podKey],
  );
  const target: DiagnoseTarget = {
    kind: match.kind, name: match.name, namespace: match.namespace,
    category: categoryFromFinding(finding) ?? inferredCategory,
  };
  const { state, run } = useDiagnose(target, { remote });
  const investigation = React.useMemo(
    () => (finding ? investigations.filter((i) => i.findingId === finding.id).sort((a, b) => b.timestamp - a.timestamp)[0] : undefined),
    [finding, investigations],
  );

  const found = !!investigation && investigation.status === 'completed' && !!(investigation.suspectedCause || investigation.summary);
  const monitorView = found ? fromMonitor(investigation!) : null;
  const inboxView = state.phase === 'done' ? fromInbox(state.report) : null;
  const shown = monitorView ?? inboxView;
  // "found the cause" only when a cause was named; a report without one says so.
  const title = shown ? (shown.cause ? 'Pulse found the cause' : 'No cause identified') : finding ? 'Pulse found a problem' : 'Cause';
  const retryWait = useCountdown(state.phase === 'refused' ? state.retryAt : undefined);

  const diagnoseButton = (label = 'Diagnose', again = false) => (
    <button
      type="button"
      onClick={() => void run(again)}
      disabled={remote || state.phase === 'starting' || state.phase === 'waiting' || (state.phase === 'refused' && retryWait > 0)}
      title={remote ? PULSE_AI_LOCAL_ONLY : undefined}
      className="min-h-[40px] self-start rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
    >
      {label}
    </button>
  );

  return (
    <section aria-labelledby="cause-h" className={cn('flex flex-col gap-3.5 rounded-xl border bg-slate-900 p-5', shown?.cause ? 'border-blue-800' : 'border-slate-800')}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Stethoscope className="h-[18px] w-[18px] text-blue-300" aria-hidden />
        <h2 id="cause-h" className="text-base font-semibold text-slate-100">{title}</h2>
        {finding && (
          <span className="text-xs text-slate-400">
            Monitor finding · open since {hhmm(finding.startedAt ?? finding.timestamp)}
            {investigation ? ` · investigated ${hhmm(investigation.timestamp)}` : ' · not investigated yet'}
          </span>
        )}
        {finding && <Confidence value={investigation?.confidence ?? finding.confidence} />}
        {!finding && state.phase === 'done' && <Confidence value={state.report.confidence} />}
      </div>

      {remote && (
        <>
          <p className="text-sm text-slate-400" data-testid="cause-remote">{PULSE_AI_LOCAL_ONLY}</p>
          {diagnoseButton()}
        </>
      )}

      {!remote && finding && monitorView && <Report view={monitorView} />}
      {!remote && finding && !found && (
        <>
          <p className="text-[15px] leading-relaxed text-slate-100">{finding.title}</p>
          {finding.summary && <p className="text-[13px] text-slate-300">{finding.summary}</p>}
          {investigation?.status === 'failed' && <p className="text-xs text-amber-300">The investigation failed{investigation.error ? `: ${investigation.error}` : ''}.</p>}
          {state.phase === 'idle' && diagnoseButton(investigation?.status === 'failed' ? 'Diagnose again' : 'Diagnose')}
        </>
      )}

      {!remote && !finding && state.phase === 'idle' && (
        connected ? (
          <>
            <p className="text-sm text-slate-400">No open monitor finding for this {noun}.</p>
            {diagnoseButton()}
          </>
        ) : connectionError ? (
          <p className="text-sm text-slate-400" data-testid="monitor-unreachable">
            The Pulse agent&apos;s monitor is unreachable ({connectionError}), so findings for this {noun} cannot be shown.
          </p>
        ) : (
          <p className="text-sm text-slate-400">Connecting to the Pulse monitor…</p>
        )
      )}

      {state.phase === 'starting' && <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Asking the agent to investigate…</p>}
      {state.phase === 'waiting' && (
        <p className="flex items-center gap-2 text-sm text-slate-300" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span data-testid="diagnose-run">
            {state.run === 'running' ? 'Investigating' : 'Queued for investigation'}
            {state.reused ? ' (the open inbox item for this resource)' : ''}… The report appears here when it is ready.
          </span>
        </p>
      )}
      {state.phase === 'done' && (
        <>
          {state.reused && (
            <p className="text-xs text-slate-400" data-testid="diagnose-reused">
              From the open inbox item for this resource · investigated {state.at ? formatRelative(state.at) : 'at an unrecorded time'}
            </p>
          )}
          {!state.reused && state.at && <p className="text-xs text-slate-400">Investigated {formatRelative(state.at)}</p>}
          <Report view={inboxView!} />
          {diagnoseButton('Diagnose again', true)}
        </>
      )}
      {state.phase === 'empty' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300" data-testid="diagnose-empty">The investigation finished without a report.</p>
          {diagnoseButton('Diagnose again', true)}
        </div>
      )}
      {state.phase === 'refused' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-amber-300">The agent did not start an investigation: {state.reason}</p>
          {diagnoseButton(retryWait > 0 ? `Try again in ${formatWait(retryWait)}` : 'Try again', state.again)}
        </div>
      )}
      {state.phase === 'failed' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-300">Diagnose failed: {state.reason}</p>
          {diagnoseButton('Try again')}
        </div>
      )}
      {state.phase === 'timeout' && (
        <p className="text-sm text-slate-300" data-testid="diagnose-timeout">
          No report after {Math.round(state.windowMs / 60_000)} minutes; the investigation may still finish. The item stays open in the{' '}
          <Link to="/inbox" className="text-blue-400 hover:underline">Inbox</Link> (Diagnose {match.kind} {match.namespace}/{match.name}).
        </p>
      )}
      {state.phase === 'unreachable' && (
        <p className="text-sm text-slate-400" data-testid="diagnose-unreachable">The Pulse agent is unreachable ({state.reason}); nothing was investigated.</p>
      )}
    </section>
  );
}
