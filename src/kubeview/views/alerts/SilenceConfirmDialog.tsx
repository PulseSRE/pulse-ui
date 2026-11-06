/**
 * Confirm a silence Pulse proposed: the exact matchers (editable, the preview
 * follows), what it hides now and what it does not, the duration and its end
 * time, the owner, a required comment, who it is created as, and how to undo
 * it. The write goes to Alertmanager through the same proxy and RBAC as the
 * Silences form; Alertmanager has no dry run, so the preview is computed from
 * the alerts firing now with Alertmanager's own matching rules.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { VolumeX } from 'lucide-react';
import { Dialog } from '../../components/primitives/Dialog';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { useCanI } from '../../hooks/useCanI';
import { errorMessage } from '../../hooks/usePinnedAction';
import { useUIStore } from '../../store/uiStore';
import { assertActiveCluster, clusterDisplayName } from '../../engine/pendingCluster';
import { getActiveClusterId } from '../../engine/clusterConnection';
import {
  buildSilenceBody, createSilence, describeMinutes, formatMatcher, formatMatchers,
  hiddenProblem, labelsMatch, matcherProblem, parseMatchers, type AlertForSilence, type Matcher,
} from '../../engine/silences';
import { cn } from '@/lib/utils';

export interface SilenceProposal {
  /** What the silence is about, for the title: "worker-5". */
  target: string;
  matchers: Matcher[];
  /** Proposed duration; the first option. */
  minutes: number;
  /** Why the proposed duration, e.g. "covers the 16:30 due time". */
  minutesReason?: string;
  comment: string;
  /** The Inbox owner, when there is an item. */
  owner?: string | null;
  /** Labels that define "the same target" for the "not hidden" list. */
  targetLabels: Record<string, string>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  proposal: SilenceProposal;
  /** Firing and pending alerts, for the preview. */
  alerts: AlertForSilence[];
  currentUser: string;
  /** Alerts and silences are the local cluster's only. */
  clusterId: string;
  onCreated?: (id: string) => void;
  /** Undo from the success toast: asks for confirmation before expiring. */
  onUndo?: (silence: { id: string; comment: string; matchers: Matcher[] }) => void;
  /** Retry the "who am I" lookup when it failed. */
  onRetryUser?: () => void;
}

const ALT_MINUTES = [60, 240];

function endTime(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AlertLine({ a }: { a: AlertForSilence }) {
  const sev = a.labels.severity || 'warning';
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className={cn('px-1.5 py-0.5 rounded-sm', sev === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300')}>{sev}</span>
      <span className="text-slate-200">{a.labels.alertname}</span>
      <span className="text-slate-500">· {a.state}</span>
    </li>
  );
}

export function SilenceConfirmDialog({ open, onClose, proposal, alerts, currentUser, clusterId, onCreated, onUndo, onRetryUser }: Props) {
  const addToast = useUIStore((s) => s.addToast);
  const [matcherText, setMatcherText] = useState(formatMatchers(proposal.matchers));
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(proposal.minutes);
  const [comment, setComment] = useState(proposal.comment);
  const [running, setRunning] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  // Pinned when the dialog opens: switching clusters meanwhile must not retarget it.
  const pinnedCluster = useRef(getActiveClusterId());

  useEffect(() => {
    if (!open) return;
    setMatcherText(formatMatchers(proposal.matchers));
    setEditing(false);
    setMinutes(proposal.minutes);
    setComment(proposal.comment);
    setWriteError(null);
    pinnedCluster.current = getActiveClusterId();
    // Reset when a new proposal opens, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposal]);

  // The kube-rbac-proxy in front of alertmanager-main authorises the API as
  // monitoring.coreos.com alertmanagers/api "main" in openshift-monitoring;
  // monitoring-alertmanager-edit grants it. Write verbs fail closed.
  const { allowed, isLoading: rbacLoading } = useCanI('create', 'monitoring.coreos.com', 'alertmanagers', 'openshift-monitoring', 'api', { name: 'main', enabled: open });

  const parsed = useMemo((): { matchers: Matcher[] | null; error: string | null } => {
    try {
      const ms = parseMatchers(matcherText);
      return { matchers: ms, error: matcherProblem(ms) };
    } catch (e) {
      return { matchers: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [matcherText]);

  const hides = useMemo(() => (parsed.matchers && !parsed.error ? alerts.filter((a) => labelsMatch(a.labels, parsed.matchers!)) : []), [alerts, parsed]);
  const sameTarget = useMemo(() => {
    const tl = Object.entries(proposal.targetLabels);
    return alerts.filter((a) => tl.every(([k, v]) => a.labels[k] === v) && !hides.includes(a));
  }, [alerts, hides, proposal.targetLabels]);

  const proposed = useMemo(() => new Set(proposal.matchers.map(formatMatcher)), [proposal.matchers]);
  const commentMissing = !comment.trim();
  // The signed-in user when known; typed in only when the lookup failed.
  // The signed-in user only: when the lookup failed nobody can be named, so nothing is created.
  const creator = currentUser;
  const creatorMissing = !creator;
  const firing = useMemo(() => alerts.filter((a) => a.state === 'firing'), [alerts]);
  const tooMuch = useMemo(() => (parsed.error ? null : hiddenProblem(hides.filter((a) => a.state === 'firing'), firing)), [parsed.error, hides, firing]);
  const edited = matcherText !== formatMatchers(proposal.matchers);
  const blocked = !!parsed.error || !!tooMuch || commentMissing || creatorMissing || rbacLoading || !allowed;

  const confirm = async () => {
    if (!parsed.matchers || blocked || running) return;
    const matchers = parsed.matchers;
    const mins = minutes;
    setRunning(true);
    setWriteError(null);
    try {
      assertActiveCluster(pinnedCluster.current, 'The silence');
      const id = await createSilence(buildSilenceBody(matchers, mins, creator, comment.trim()));
      addToast({
        type: 'success',
        title: `Silence created for ${describeMinutes(mins)}`,
        detail: formatMatchers(matchers),
        action: {
          label: 'Undo',
          onClick: () => onUndo?.({ id, comment: comment.trim(), matchers }),
        },
      });
      onCreated?.(id);
      onClose();
    } catch (e) {
      setWriteError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const options = [proposal.minutes, ...ALT_MINUTES.filter((m) => m !== proposal.minutes)];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!running}
      size="xl"
      icon={<VolumeX className="w-5 h-5 text-slate-300" />}
      title={`Silence ${hides.length} alert${hides.length === 1 ? '' : 's'}${edited ? '' : ` on ${proposal.target}`} for ${describeMinutes(minutes)}?`}
      description={<>Proposed by Pulse · Alertmanager · cluster {clusterDisplayName(clusterId)} · you are acting as {creator || 'unknown'}</>}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={running}>Cancel</Button>
          <Button onClick={() => { void confirm(); }} disabled={blocked || running} loading={running}>
            Create silence for {describeMinutes(minutes)}
          </Button>
        </>
      )}
    >
      <div className="space-y-4 text-sm">
        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-medium text-slate-400">Matchers</h3>
            <button type="button" className="text-xs text-blue-400 hover:text-blue-300" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done' : 'Edit matchers'}
            </button>
          </div>
          {editing ? (
            <input
              aria-label="Matchers"
              value={matcherText}
              onChange={(e) => setMatcherText(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          ) : null}
          {parsed.matchers && (
            <ul className="font-mono text-xs space-y-0.5 mt-1" aria-label="Matcher changes">
              {parsed.matchers.map((m) => (
                <li key={formatMatcher(m)} className="text-green-300">+ {formatMatcher(m)}{!proposed.has(formatMatcher(m)) && <span className="text-slate-500 font-sans"> (edited)</span>}</li>
              ))}
            </ul>
          )}
          {parsed.error ? (
            <p role="alert" className="mt-1 text-xs text-red-300">{parsed.error}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Edit matchers if you want a wider or narrower silence. The preview below updates.</p>
          )}
        </section>

        <section>
          <h3 className="text-xs font-medium text-slate-400 mb-1">What it will hide</h3>
          {tooMuch && <p role="alert" className="text-xs text-red-300 mb-1">{tooMuch}</p>}
          {parsed.error ? (
            <p className="text-xs text-slate-500">—</p>
          ) : hides.length === 0 ? (
            <p className="text-xs text-amber-300">No alert firing now matches these matchers.</p>
          ) : (
            <ul className="space-y-1">{hides.map((a, i) => <AlertLine key={i} a={a} />)}</ul>
          )}
          {!parsed.error && (
            <p className="text-xs text-slate-500 mt-1">
              Also any new alert with these matchers until it ends.
              {sameTarget.length > 0
                ? <> Not hidden: other alerts on {proposal.target} ({[...new Set(sameTarget.map((a) => a.labels.alertname))].join(', ')}) and everything else.</>
                : <> Not hidden: every alert these matchers do not match.</>}
              {' '}Alertmanager has no dry run; this preview is computed from the alerts firing now.
            </p>
          )}
        </section>

        <fieldset>
          <legend className="text-xs font-medium text-slate-400 mb-1">Duration</legend>
          <div className="space-y-1">
            {options.map((m, i) => (
              <label key={m} className="flex items-center gap-2 text-xs text-slate-300">
                <input type="radio" name="silence-duration" checked={minutes === m} onChange={() => setMinutes(m)} />
                {describeMinutes(m)}, until {endTime(m)}
                {i === 0 && proposal.minutesReason && <span className="text-slate-500">({proposal.minutesReason})</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-slate-400 font-medium mb-0.5">Owner</div>
            <div className="text-slate-200">{proposal.owner || 'No Inbox owner'}</div>
          </div>
          <div>
            <div className="text-slate-400 font-medium mb-0.5">Created by</div>
            {currentUser ? (
              <div className="text-slate-200">{currentUser}, on Pulse's proposal</div>
            ) : (
              <div role="alert" className="text-amber-300" data-testid="creator-unknown">
                Could not confirm who you are; try again.{' '}
                {onRetryUser && <button type="button" className="text-blue-400 hover:text-blue-300" onClick={onRetryUser}>Retry</button>}
              </div>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="silence-comment" className="text-xs font-medium text-slate-400 block mb-1">Comment (required, shown on the silence and in the audit log)</label>
          <textarea
            id="silence-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
          {commentMissing && <p className="text-xs text-amber-300 mt-0.5">Say why these alerts are expected.</p>}
        </div>

        <div className="text-xs">
          <div className="text-slate-400 font-medium">Undo</div>
          <div className="text-slate-300">Expire it any time in Alerts › Silences (or from the toast right after it is created).</div>
        </div>

        {!rbacLoading && !allowed && (
          <p role="alert" className="text-xs text-amber-300">
            Your account cannot create silences: it needs the monitoring-alertmanager-edit role in openshift-monitoring.
          </p>
        )}
        {writeError && <LoadError title="The silence was not created" error={writeError} />}
      </div>
    </Dialog>
  );
}
