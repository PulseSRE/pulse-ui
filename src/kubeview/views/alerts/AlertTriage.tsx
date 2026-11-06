/**
 * Alerts ↔ Inbox: the Triage chip on each alert row, the "Pulse suggests a
 * silence" banner, and the unhealthy-pods panel a namespace-only alert opens.
 *
 * Triage comes from the agent's /inbox/by-alert (one batch for the page). An
 * agent without it hides the chips and says so once; a failed or slow lookup
 * is "Could not check" with Retry on each row, never "not in the Inbox".
 */
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowRight, BellOff, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { k8sList } from '../../engine/query';
import { diagnoseResource } from '../../engine/diagnosis';
import { fetchAlertTriage, summarizeTriage, type AlertTriage, type TriageItem } from '../../engine/alertTriage';
import { isAgentFeatureUnavailable } from '../../engine/agentFeature';
import { formatMatcher, type AlertForSilence, type SilenceSuggestion } from '../../engine/silences';
import type { K8sResource } from '../../engine/renderers';
import type { Pod } from '../../engine/types';

export function labelKey(labels: Record<string, string>): string {
  return JSON.stringify(Object.keys(labels).sort().map((k) => [k, labels[k]]));
}

export interface TriageState {
  byKey: Map<string, AlertTriage>;
  /** Keys whose batch is still loading. */
  pendingKeys: Set<string>;
  /** Keys whose batch failed, with why. One bad batch does not blank the others. */
  errorByKey: Map<string, unknown>;
  unsupported: boolean;
  refetch: () => void;
}

/** The agent accepts at most this many alerts per request. */
export const TRIAGE_BATCH = 200;

/** Firing alerts in batches of at most 200 (the agent's limit), one query each. */
export function useAlertTriage(alerts: AlertForSilence[], clusterId: string, enabled = true): TriageState {
  // The monitor makes Inbox items from firing alerts only.
  const firing = useMemo(() => alerts.filter((a) => a.state === 'firing').map((a) => a.labels), [alerts]);
  const batches = useMemo(() => {
    const out: Array<{ labels: Array<Record<string, string>>; keys: string[] }> = [];
    for (let i = 0; i < firing.length; i += TRIAGE_BATCH) {
      const labels = firing.slice(i, i + TRIAGE_BATCH);
      out.push({ labels, keys: labels.map(labelKey) });
    }
    return out;
  }, [firing]);
  const results = useQueries({
    queries: batches.map((b) => ({
      queryKey: ['alerts', 'triage', clusterId, b.keys.join('\n')],
      queryFn: () => fetchAlertTriage(b.labels),
      enabled,
      refetchInterval: 60_000,
      retry: false,
    })),
  });
  const byKey = new Map<string, AlertTriage>();
  const pendingKeys = new Set<string>();
  const errorByKey = new Map<string, unknown>();
  let unsupported = false;
  results.forEach((q, bi) => {
    const keys = batches[bi]?.keys ?? [];
    if (isAgentFeatureUnavailable(q.error)) unsupported = true;
    else if (q.error) keys.forEach((k) => errorByKey.set(k, q.error));
    else if (q.isPending) keys.forEach((k) => pendingKeys.add(k));
    (q.data || []).forEach((t, i) => { if (keys[i]) byKey.set(keys[i], t); });
  });
  const refetch = () => { results.forEach((q) => { if (q.isError) void q.refetch(); }); };
  return { byKey, pendingKeys, errorByKey, unsupported, refetch };
}

export function inboxPath(id: string): string {
  return `/inbox?task=${encodeURIComponent(id)}`;
}

export function TriageChip({ labels, state, triage, go }: {
  labels: Record<string, string>;
  state: string;
  triage: TriageState;
  go: (path: string, title: string) => void;
}) {
  if (triage.unsupported) return null;
  if (state !== 'firing') {
    return <span className="text-xs text-slate-500">Pending alerts are not triaged until they fire</span>;
  }
  const key = labelKey(labels);
  const error = triage.errorByKey.get(key);
  if (error) {
    return (
      <span className="text-xs text-amber-300" data-testid="triage-could-not-check">
        Could not check · {error instanceof Error ? error.message : 'the Inbox did not answer'}{' '}
        <button type="button" className="text-blue-400 hover:text-blue-300" onClick={triage.refetch}>Retry</button>
      </span>
    );
  }
  const t = triage.byKey.get(key);
  if (triage.pendingKeys.has(key) || !t) return <span className="text-xs text-slate-500">Checking Inbox…</span>;
  const s = summarizeTriage(t);
  if (!s) return <span className="text-xs text-slate-500">Not in the Inbox</span>;
  return (
    <button
      type="button"
      onClick={() => s.itemId && go(inboxPath(s.itemId), 'Inbox')}
      disabled={!s.itemId}
      className="text-left text-xs group"
      aria-label={`Triage: ${s.label}`}
    >
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-sky-900/40 text-sky-200 border border-sky-800/60 group-hover:border-sky-600">
        Triage · {s.label}{s.confidence !== null && <span className="font-mono">{` ${s.confidence.toFixed(2)}`}</span>}
        <ArrowRight className="w-3 h-3" />
      </span>
      {s.detail && <span className="block text-slate-400 mt-0.5 line-clamp-1">{s.detail}</span>}
    </button>
  );
}

/** The Inbox item about a node, if the lookup found one for any of its alerts. */
export function nodeItem(triage: TriageState, alerts: AlertForSilence[], node: string): TriageItem | null {
  for (const a of alerts) {
    if (a.labels.node !== node) continue;
    const t = triage.byKey.get(labelKey(a.labels));
    if (!t) continue;
    // Only an item about this node: never an unrelated item the lookup also returned.
    const aboutNode = [...t.related, ...(t.item ? [t.item] : [])].filter((r) => r.correlationKey?.endsWith(`:Node/${node}`));
    // Prefer the work item (maintenance, Inbox task) over the alert's own item.
    const maint = aboutNode.find((r) => !r.correlationKey?.startsWith('alerts:')) ?? aboutNode[0];
    if (maint) return maint;
  }
  return null;
}

export function SilenceSuggestionBanner({ suggestion, alerts, item, onReview, onDismiss, onAsk }: {
  suggestion: SilenceSuggestion;
  alerts: AlertForSilence[];
  item: TriageItem | null;
  onReview: () => void;
  onDismiss: () => void;
  onAsk: () => void;
}) {
  const firing = alerts.filter((a) => a.state === 'firing').length;
  const pending = alerts.length - firing;
  const otherNodes = new Set(alerts.filter((a) => suggestion.alertnames.includes(a.labels.alertname) && a.labels.node && a.labels.node !== suggestion.node).map((a) => a.labels.node));
  return (
    <section data-testid="silence-suggestion">
    <Card className="p-4 border border-violet-800/60">
      <div className="flex items-start gap-3">
        <Sparkles className="w-4 h-4 text-violet-300 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-sm font-medium text-slate-100">Pulse suggests a silence for {suggestion.node}</div>
          <p className="text-xs text-slate-300">
            {suggestion.node} is cordoned{item ? <> for “{item.title}”</> : null}. Its {suggestion.alertnames.length} alert{suggestion.alertnames.length === 1 ? ' is' : 's are'} expected
            and will keep notifying the on-call until the node is back.
          </p>
          <ul className="text-xs text-slate-400 space-y-0.5">
            <li>Node {suggestion.node} unschedulable{suggestion.cordonedAt ? ` since ${new Date(suggestion.cordonedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — from node status</li>
            {item
              ? <li>Inbox item “{item.title}”{item.claimedBy ? ` claimed by ${item.claimedBy}` : ', unclaimed'}{item.dueDate ? `, due ${new Date(item.dueDate * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — from Inbox</li>
              : <li>No Inbox item found for {suggestion.node} — check the reason before silencing</li>}
            <li>
              {suggestion.alertnames.join(' and ')} carry <span className="font-mono">{formatMatcher(suggestion.matchers[0])}</span>
              {otherNodes.size === 0 ? '; no other node matches' : `; ${otherNodes.size} other node(s) fire the same alert and stay visible`}
              {' '}— matched against the {firing} firing and {pending} pending alerts
            </li>
          </ul>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onReview}><BellOff className="w-3.5 h-3.5" /> Review silence</Button>
            <Button size="sm" variant="secondary" onClick={onAsk}>Ask Pulse why</Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      </div>
    </Card>
    </section>
  );
}

/** Not running, not ready, pending or failed, with the diagnosis engine's reason. */
export function unhealthyReason(pod: Pod): string | null {
  const phase = pod.status?.phase;
  if (phase === 'Succeeded') return null;
  const statuses = pod.status?.containerStatuses || [];
  const notReady = phase === 'Running' && statuses.some((cs) => !cs.ready);
  if (phase === 'Running' && !notReady) return null;
  const diagnosis = diagnoseResource({ ...pod, kind: 'Pod' } as unknown as K8sResource).find((d) => d.severity !== 'info');
  if (diagnosis) return diagnosis.title;
  const waiting = statuses.find((cs) => cs.state?.waiting)?.state?.waiting?.reason;
  if (waiting) return waiting;
  if (notReady) return `Running, not ready (${statuses.filter((cs) => cs.ready).length}/${statuses.length} containers ready)`;
  return phase || 'Unknown';
}

export function NamespaceUnhealthyPods({ namespace, fromAlert, clusterId, onClose, go }: {
  namespace: string;
  fromAlert: string;
  clusterId: string;
  onClose: () => void;
  go: (path: string, title: string) => void;
}) {
  const q = useQuery({
    queryKey: ['k8s', 'list', 'pods', namespace, clusterId, 'alert-unhealthy'],
    queryFn: () => k8sList<Pod>('/api/v1/pods', namespace, clusterId),
    staleTime: 15_000,
  });
  const pods = q.data || [];
  const unhealthy = pods.map((p) => ({ pod: p, reason: unhealthyReason(p) })).filter((x) => x.reason);
  return (
    <section data-testid="namespace-unhealthy-pods">
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-slate-100">Unhealthy pods in {namespace}</div>
          <div className="text-xs text-slate-500">
            Opened from {fromAlert}
            {q.isSuccess && <> · {unhealthy.length} of {pods.length} pods · <button type="button" className="text-blue-400 hover:text-blue-300" onClick={() => go(`/r/v1~pods/${encodeURIComponent(namespace)}`, 'Pods')}>show all {pods.length}</button></>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close unhealthy pods" className="text-slate-400 hover:text-slate-200"><X className="w-4 h-4" /></button>
      </div>
      {q.isPending ? (
        <p className="text-xs text-slate-500">Checking pods…</p>
      ) : q.isError ? (
        <LoadError title={`Pods in ${namespace} could not be listed`} error={q.error} onRetry={() => { void q.refetch(); }} />
      ) : unhealthy.length === 0 ? (
        <p className="text-xs text-slate-400">All {pods.length} pods in {namespace} are running and ready; the alert's cause is elsewhere.</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {unhealthy.map(({ pod, reason }) => (
            <li key={pod.metadata.uid || pod.metadata.name}>
              <button type="button" className={cn('w-full text-left py-1.5 flex items-center gap-3 text-xs hover:bg-slate-800/40')}
                onClick={() => go(`/r/v1~pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod.metadata.name)}`, pod.metadata.name)}>
                <span className="text-slate-200 font-mono">{pod.metadata.name}</span>
                <span className="text-slate-500">{pod.status?.phase}</span>
                <span className="text-slate-400 truncate">{reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
    </section>
  );
}
