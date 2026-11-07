/**
 * Home › What needs attention (mock: Attention.dc.html).
 *
 * One worst-first list of the monitor's open findings: cause, the change just
 * before it (GET /api/agent/changes, local cluster only), confidence, age,
 * owner and one primary action per row. System namespaces are collapsed;
 * scanners that failed are "Could not check"; noisy findings are hidden with
 * a count. When the monitor cannot be reached, or the active cluster is not
 * the one it watches, the browser computes the list and says so.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, HelpCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { useMonitorStore } from '../../store/monitorStore';
import { fetchInbox } from '../../engine/inboxApi';
import { fetchChanges, CHANGE_KINDS, type ChangeEntry } from '../../engine/changesApi';
import { AgentRequestError, isAgentFeatureUnavailable } from '../../engine/agentFeature';
import { askPulse } from '../../engine/askPulse';
import { formatRelative, formatClock } from '../../engine/format';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import {
  couldNotCheckFrom, rowsFromClient, rowsFromFindings,
  type AttentionModel, type AttentionRow, type LiveObjects,
} from './attention';
import { AskPulseButton } from '../../components/agent/AskPulseButton';
import { AI_ACCENT } from '../../components/agent/aiTokens';

/** Rows whose preceding change is looked up; the rest say "Not checked". */
const CHANGE_LOOKUPS = 15;
const CHANGE_WINDOW_MS = 24 * 3600_000;

export function useAttentionModel(live: LiveObjects, clusterId: string): AttentionModel & { inboxError: unknown; inboxState: 'loading' | 'error' | 'ok'; currentUser?: string } {
  const isLocal = clusterId === LOCAL_CLUSTER_ID;
  const { connected, connectionError, findings, investigations, lastScanTime, scanReport, pendingActions, dismissed } = useMonitorStore(useShallow((s) => ({
    connected: s.connected,
    connectionError: s.connectionError,
    findings: s.findings,
    investigations: s.investigations,
    lastScanTime: s.lastScanTime,
    scanReport: s.scanReport,
    pendingActions: s.pendingActions,
    dismissed: s.dismissedFindingIds,
  })));
  const monitorUsable = isLocal && connected;
  const inboxQ = useQuery({
    queryKey: ['inbox', 'attention', LOCAL_CLUSTER_ID],
    queryFn: () => fetchInbox({ type: 'task', limit: 500 }),
    enabled: monitorUsable,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return useMemo(() => {
    const inboxState = inboxQ.isError ? 'error' as const : inboxQ.data ? 'ok' as const : 'loading' as const;
    const base = { inboxError: inboxQ.error, inboxState, currentUser: inboxQ.data?.current_user };
    if (!isLocal) {
      return { ...base, source: 'client' as const, fallbackReason: "Pulse's monitor watches the local cluster only, so this list was computed in your browser from this cluster's objects.", rows: rowsFromClient(live), noisy: [], couldNotCheck: [], lastScanTime: 0 };
    }
    if (!connected) {
      return { ...base, source: 'client' as const, fallbackReason: `The Pulse monitor is unreachable${connectionError ? ` (${connectionError})` : ''}, so this list was computed in your browser and may miss what only the monitor sees.`, rows: rowsFromClient(live), noisy: [], couldNotCheck: [], lastScanTime: 0 };
    }
    if (!lastScanTime) {
      return { ...base, source: 'checking' as const, rows: [], noisy: [], couldNotCheck: [], lastScanTime: 0 };
    }
    const open = findings.filter((f) => !dismissed.includes(f.id));
    const pendingFix = new Set(pendingActions.filter((a) => a.status === 'proposed').map((a) => a.findingId));
    const { rows, noisy, degraded } = rowsFromFindings(open, investigations, inboxQ.data?.items ?? [], live, pendingFix);
    const cnc = couldNotCheckFrom(degraded, scanReport);
    return { ...base, source: 'monitor' as const, rows, noisy, couldNotCheck: cnc.items, scanners: cnc.scanners, lastScanTime };
  }, [isLocal, connected, connectionError, lastScanTime, findings, dismissed, pendingActions, investigations, inboxQ.data, inboxQ.error, inboxQ.isError, scanReport, live]);
}

function ConfidenceCell({ row }: { row: AttentionRow }) {
  if (row.confidence === null) return <span className="text-slate-500">Not investigated yet</span>;
  return (
    <span>
      <span className="font-mono text-slate-200">{row.confidence.toFixed(2)}</span>
      <span className="block text-slate-500">{row.confidenceSource === 'investigated' ? 'investigated' : 'scanner'}</span>
    </span>
  );
}

function minutesBefore(change: ChangeEntry, onset: number): string {
  const mins = Math.max(0, Math.round((onset - Date.parse(change.at)) / 60_000));
  if (mins < 60) return `${mins} min before`;
  return `${Math.round(mins / 60)}h before`;
}

export function PrecedingChange({ row, enabled }: { row: AttentionRow; enabled: boolean }) {
  const r = row.resource;
  const supported = !!r && !!r.namespace && CHANGE_KINDS.has(r.kind);
  const q = useQuery({
    queryKey: ['agent', 'changes', 'attention', r?.kind, r?.namespace, r?.name, Math.floor(row.startedAt / 60_000)],
    queryFn: () => fetchChanges({
      kind: r!.kind, namespace: r!.namespace, name: r!.name,
      since: new Date(row.startedAt - CHANGE_WINDOW_MS).toISOString(),
      until: new Date(row.startedAt + 60_000).toISOString(),
    }),
    enabled: enabled && supported,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const before = useMemo(
    () => (q.data?.changes || []).filter((c) => Date.parse(c.at) <= row.startedAt + 60_000).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0],
    [q.data, row.startedAt],
  );
  if (!enabled) return <span className="text-slate-500">Not checked</span>;
  if (!supported) return <span className="text-slate-500" title="Change history covers workloads, pods, ConfigMaps and Secrets">—</span>;
  if (q.isPending) return <span className="text-slate-500">Checking…</span>;
  if (q.isError) {
    if (isAgentFeatureUnavailable(q.error)) return <span className="text-slate-500" title={q.error.message}>Not available on this agent</span>;
    if (q.error instanceof AgentRequestError && q.error.status === 404) return <span className="text-slate-500">The {r!.kind.toLowerCase()} was deleted</span>;
    return <span className="text-amber-300" title={q.error instanceof Error ? q.error.message : ''}>Could not check</span>;
  }
  if (q.data && !q.data.available) return <span className="text-amber-300">Could not check (cluster unreachable)</span>;
  const unreadable = q.data?.unreadable?.length ? q.data.unreadable.join('; ') : '';
  const partial = q.data?.truncated ? ' The change list was truncated, so older changes may be missing.' : '';
  if (!before) {
    return unreadable
      ? <span className="text-amber-300" title={partial || undefined}>No change found (could not read: {unreadable})</span>
      : <span className="text-slate-500" title={partial || undefined}>No change found in 24h{partial ? ' (partial list)' : ''}</span>;
  }
  return (
    <span>
      <span className="text-slate-200">{before.kind} {before.name} {before.summary}{before.actor ? ` by ${before.actor}` : ''}</span>
      <span className="block text-slate-500">{formatClock(before.at)} · {minutesBefore(before, row.startedAt)}</span>
      {(unreadable || partial) && <span className="block text-amber-300/80">{unreadable ? `Could not read: ${unreadable}.` : ''}{partial}</span>}
    </span>
  );
}

function OwnerCell({ row, inboxState }: { row: AttentionRow; inboxState: 'loading' | 'error' | 'ok' }) {
  if (!row.inboxItem) {
    if (inboxState === 'loading') return <span className="text-slate-500">Checking…</span>;
    if (inboxState === 'error') return <span className="text-amber-300">Unknown</span>;
    return <span className="text-slate-500">No Inbox item</span>;
  }
  return row.inboxItem.claimed_by
    ? <span className="text-slate-200">claimed by {row.inboxItem.claimed_by}</span>
    : <span className="text-slate-400">unclaimed</span>;
}

function PrimaryAction({ row, go, canAsk }: { row: AttentionRow; go: (p: string, t: string) => void; canAsk: boolean }) {
  if (row.inboxItem) {
    return (
      <Button size="sm" variant={row.fixReady ? 'primary' : 'secondary'} onClick={() => go(`/inbox?task=${encodeURIComponent(row.inboxItem!.id)}`, 'Inbox')}>
        {row.fixReady ? 'Review fix' : 'Open in Inbox'}
      </Button>
    );
  }
  if (canAsk) {
    return (
      <AskPulseButton suffix="to investigate" prompt={`Investigate: ${row.problem}. ${row.cause}`} context={row.resource} />
    );
  }
  return row.path ? <Button size="sm" variant="secondary" onClick={() => go(row.path!, row.resource?.name || 'Resource')}>Open</Button> : null;
}

type SevFilter = 'all' | 'critical' | 'warning';
type OwnerFilter = 'anyone' | 'mine' | 'unowned';

export function AttentionList({ model, clusterId, go }: {
  model: ReturnType<typeof useAttentionModel>;
  clusterId: string;
  go: (path: string, title: string) => void;
}) {
  const isLocal = clusterId === LOCAL_CLUSTER_ID;
  const [sev, setSev] = useState<SevFilter>('all');
  const [ns, setNs] = useState('all');
  const [owner, setOwner] = useState<OwnerFilter>('anyone');
  const [showSystem, setShowSystem] = useState(false);
  const [showNoisy, setShowNoisy] = useState(false);

  const ownerUnknown = model.inboxState !== 'ok';
  const effectiveOwner: OwnerFilter = ownerUnknown ? 'anyone' : owner;
  const all = useMemo(() => (showNoisy ? [...model.rows, ...model.noisy] : model.rows), [model.rows, model.noisy, showNoisy]);
  const filtered = all.filter((r) =>
    (sev === 'all' || r.severity === sev)
    && (ns === 'all' || r.namespace === ns)
    && (effectiveOwner === 'anyone' || (effectiveOwner === 'mine' ? !!model.currentUser && r.inboxItem?.claimed_by === model.currentUser : !r.inboxItem?.claimed_by)));
  const user = filtered.filter((r) => !r.system);
  const system = filtered.filter((r) => r.system);
  const namespaces = [...new Set(all.filter((r) => !r.system && r.namespace).map((r) => r.namespace))].sort();
  const critical = model.rows.filter((r) => r.severity === 'critical').length;
  const warning = model.rows.filter((r) => r.severity === 'warning').length;
  const lookups = new Set(user.slice(0, CHANGE_LOOKUPS).map((r) => r.key));
  const top = model.source === 'monitor' ? user.find((r) => r.causeSource === 'investigation') : undefined;

  const ask = () => askPulse(
    `What needs attention on this cluster? Open problems, worst first:\n${model.rows.slice(0, 20).map((r) => `- [${r.severity}] ${r.problem}: ${r.cause}`).join('\n')}`
    + (model.couldNotCheck.length ? `\nCould not check: ${model.couldNotCheck.map((c) => c.title).join('; ')}` : ''),
  );

  return (
    <div className="space-y-3" data-testid="attention-list">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-200">What needs attention</h3>
        <span className="text-xs text-slate-500">
          {model.source === 'monitor'
            ? <>One list from the monitor's findings · worst first · last scan {formatRelative(model.lastScanTime)}</>
            : model.source === 'checking' ? 'Waiting for the monitor\'s first scan…' : 'Computed in your browser'}
        </span>
      </div>

      {model.source === 'client' && (
        <div role="status" className="text-xs text-amber-200 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2" data-testid="attention-fallback">
          {model.fallbackReason}
        </div>
      )}
      {model.source === 'monitor' && !!model.inboxError && (
        <LoadError title="The Inbox could not be read: owners and Inbox links are unknown" error={model.inboxError} />
      )}

      {model.source !== 'checking' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="text-slate-400">Critical</div><div className="text-lg font-bold text-red-300">{critical}</div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="text-slate-400">Warning</div><div className="text-lg font-bold text-amber-300">{warning}</div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="text-slate-400">System namespaces</div><div className="text-lg font-bold text-slate-200">{model.rows.filter((r) => r.system).length} <span className="text-xs font-normal text-slate-500">collapsed</span></div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2"><div className="text-slate-400">Could not check</div><div className={cn('text-lg font-bold', model.couldNotCheck.length ? 'text-amber-300' : 'text-slate-200')}>{model.source === 'monitor' ? model.couldNotCheck.length : '—'}</div></div>
        </div>
      )}

      {top && (
        <Card className={cn('p-4', AI_ACCENT.card)}>
          <div className="flex items-start gap-3">
            <Sparkles className={cn('w-4 h-4 mt-0.5 shrink-0', AI_ACCENT.textStrong)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-100">
                Pulse suggests starting with {top.resource?.name ?? top.problem}{top.namespace ? ` in ${top.namespace}` : ''}
                {top.confidence !== null && <span className={cn('ml-2 text-xs', AI_ACCENT.textStrong)}>Confidence {top.confidence.toFixed(2)}</span>}
              </div>
              <p className="text-xs text-slate-400 mt-1">It is the worst open problem with a diagnosis: {top.cause}{top.fixReady ? ' A fix is ready to review.' : ''}</p>
              <div className="flex gap-2 mt-2">
                {top.inboxItem && <Button size="sm" onClick={() => go(`/inbox?task=${encodeURIComponent(top.inboxItem!.id)}`, 'Inbox')}>{top.fixReady ? 'Review and apply' : 'Open in Inbox'}</Button>}
                <AskPulseButton suffix="why" prompt={`Why should I start with ${top.problem}? ${top.cause}`} context={top.resource} />
              </div>
            </div>
          </div>
        </Card>
      )}

      {model.source !== 'checking' && (model.rows.length > 0 || model.noisy.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Filter problems">
          <select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value as SevFilter)} className="bg-slate-900 border border-slate-700 rounded-sm px-2 py-1 text-slate-200">
            <option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option>
          </select>
          <select aria-label="Namespace" value={ns} onChange={(e) => setNs(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-sm px-2 py-1 text-slate-200">
            <option value="all">All namespaces</option>
            {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {model.source === 'monitor' && (
            <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value as OwnerFilter)} className="bg-slate-900 border border-slate-700 rounded-sm px-2 py-1 text-slate-200">
              <option value="anyone">Anyone</option>
              {/* Ownership is unknown until the Inbox answers: filtering on it would hide or show the wrong rows. */}
              <option value="mine" disabled={ownerUnknown}>Mine</option>
              <option value="unowned" disabled={ownerUnknown}>Unowned</option>
            </select>
          )}
        </div>
      )}

      {model.source === 'checking' ? (
        <p className="text-xs text-slate-500">Checking… the monitor has not finished its first scan.</p>
      ) : user.length === 0 && system.length === 0 && model.rows.length + model.noisy.length > 0 ? (
        <p className="text-xs text-slate-500">No problem matches these filters.</p>
      ) : user.length > 0 ? (
        <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Problems, worst first</caption>
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Problem and cause</th>
                <th className="px-3 py-2 font-medium">Change just before</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">Age</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {user.map((r) => (
                <tr key={r.key} className="align-top" data-testid="attention-row">
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex items-center gap-1', r.severity === 'critical' ? 'text-red-300' : 'text-amber-300')}>
                      {r.severity === 'critical' ? <AlertOctagon className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      {r.severity === 'critical' ? 'Critical' : 'Warning'}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-md">
                    {r.path
                      ? <button type="button" className="text-slate-100 hover:text-blue-300 text-left" onClick={() => go(r.path!, r.resource?.name || r.problem)}>{r.problem}</button>
                      : <span className="text-slate-100">{r.problem}</span>}
                    <div className="text-slate-400 mt-0.5">{r.cause}</div>
                    {r.alsoAlerts && r.alsoAlerts.length > 0 && <div className="text-slate-500 mt-0.5">Also in: {r.alsoAlerts.map((a) => `alert ${a}`).join(', ')}</div>}
                    {r.inboxItem && <div className="text-slate-500 mt-0.5">Also in: <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => go(`/inbox?task=${encodeURIComponent(r.inboxItem!.id)}`, 'Inbox')}>Inbox item</button></div>}
                    {r.noisy && <div className="text-slate-500 mt-0.5">Noisy: shown because you asked</div>}
                  </td>
                  <td className="px-3 py-2"><PrecedingChange row={r} enabled={model.source === 'monitor' && lookups.has(r.key)} /></td>
                  <td className="px-3 py-2"><ConfidenceCell row={r} /></td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{formatRelative(r.startedAt).replace(' ago', '')}</td>
                  <td className="px-3 py-2"><OwnerCell row={r} inboxState={model.inboxState} /></td>
                  <td className="px-3 py-2"><PrimaryAction row={r} go={go} canAsk={isLocal} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : system.length === 0 && model.couldNotCheck.length === 0 && model.source === 'monitor' ? (
        <p role="status" className="text-xs text-slate-400" data-testid="attention-empty">The monitor has no open problem.</p>
      ) : null}

      {system.length > 0 && (
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300" aria-expanded={showSystem} onClick={() => setShowSystem((v) => !v)}>
            {showSystem ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            System namespaces: {system.length} problem{system.length === 1 ? '' : 's'} ({[...new Set(system.map((r) => r.namespace))].map((n) => `${n} ${system.filter((r) => r.namespace === n).length}`).join(', ')})
          </button>
          {showSystem && (
            <ul className="px-3 pb-2 space-y-1">
              {system.map((r) => (
                <li key={r.key} className="text-xs text-slate-400" data-testid="attention-system-row">
                  <span className={r.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}>{r.severity}</span> · {r.problem} · {r.cause}
                  {r.confidence !== null && <> · {r.confidence.toFixed(2)}</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {model.source === 'monitor' && model.couldNotCheck.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-800/50 rounded-lg px-3 py-2 text-xs space-y-1" data-testid="attention-could-not-check">
          <div className="flex items-center gap-2 font-medium text-amber-200"><HelpCircle className="w-3.5 h-3.5" /> Could not check</div>
          {model.couldNotCheck.map((c, i) => (
            <div key={i} className="text-slate-300">
              <span className="text-slate-100">{c.title}</span>{c.detail ? `: ${c.detail}` : ''}
              {c.remedy && <div className="text-slate-400">To fix: {c.remedy}</div>}
            </div>
          ))}
          {model.scanners && <div className="text-slate-500">{model.scanners.ran} of {model.scanners.total} scanners ran.</div>}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-slate-500">
        <span>
          {model.source === 'monitor'
            ? <>Where this list comes from: open monitor findings, the same ones the Inbox and the Alerts Triage chips open.{model.noisy.length > 0 && <> {model.noisy.length} noisy finding{model.noisy.length === 1 ? ' is' : 's are'} hidden by noise learning. <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => setShowNoisy((v) => !v)}>{showNoisy ? 'Hide them' : 'Show them'}</button></>}</>
            : 'Where this list comes from: the diagnosis engine run over the nodes, pods, deployments and volume claims this page loaded.'}
        </span>
        <AskPulseButton suffix="about this list" onAsk={ask} showReason />
      </div>
    </div>
  );
}
