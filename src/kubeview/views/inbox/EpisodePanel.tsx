import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Clock, History, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { formatElapsed, formatShortDuration } from '../../engine/dateUtils';
import { detachSymptom, dismissEpisode, fetchEpisode, fetchOpenEpisodes } from '../../engine/episodeApi';
import type {
  Episode,
  EpisodeChange,
  EpisodeInvestigation,
  EpisodeRecurrence,
  EpisodeSymptom,
} from '../../engine/episodeApi';

/**
 * Shows open episodes above the inbox: a cause, with the findings it explains
 * folded underneath it.
 *
 * The problem this solves is concrete. During a control-plane outage the
 * monitor produced fourteen findings in one second — nine "Deployment
 * degraded" rated critical, and one etcd warning that was the cause of all of
 * them. Ranked by priority, the cause did not make the top thirteen. Reading
 * that list top-down sends you to the wrong problem.
 */

/** "6th time in 11h, every 2h" — the sentence that turns a page into a diagnosis. */
function recurrenceLine(r: EpisodeRecurrence): string | null {
  if (!r.recurring || r.occurrences < 2) return null;
  const parts = [`${r.occurrences} times`];
  if (r.window_seconds) parts.push(`in ${formatShortDuration(r.window_seconds)}`);
  if (r.interval_seconds) parts.push(`· every ${formatShortDuration(r.interval_seconds)}`);
  return parts.join(' ');
}

/**
 * The Timeline range that actually covers this cause's onset.
 *
 * `/timeline` correlates alerts, events, rollouts and config changes — on the
 * reference cluster, 2,472 entries and 84 correlated incidents — and it is the
 * page that answers "what else happened when this started". It had exactly one
 * inbound link in the whole app, so the question every finding leads to was a
 * URL you had to know to type.
 *
 * Defaulting to the page's own 6h would silently exclude a cause that began
 * fourteen hours ago, which is the case that most needs the context.
 */
export function timelineRangeFor(startedAtSeconds: number, nowSeconds = Date.now() / 1000): string {
  // No floor at zero: a cause "starting" in the future from clock skew
  // yields negative hours, which the first branch already catches. A
  // Math.max(0, …) here passed its own mutation test — dead code.
  const hours = (nowSeconds - startedAtSeconds) / 3600;
  if (hours <= 0.25) return '15m';
  if (hours <= 1) return '1h';
  if (hours <= 6) return '6h';
  if (hours <= 24) return '24h';
  if (hours <= 72) return '3d';
  return '7d';
}

function EpisodeCard({ episode, onChanged }: { episode: Episode; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [symptoms, setSymptoms] = useState<EpisodeSymptom[]>([]);
  const [symptomsLoaded, setSymptomsLoaded] = useState(false);
  const [changes, setChanges] = useState<EpisodeChange[]>([]);
  const [recurrence, setRecurrence] = useState<EpisodeRecurrence | null>(null);
  const [investigation, setInvestigation] = useState<EpisodeInvestigation | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEpisode(episode.id)
      .then((d) => {
        if (cancelled) return;
        setSymptoms(d.symptoms.filter((s) => s.detached_at == null));
        setSymptomsLoaded(true);
        setChanges(d.changes ?? []);
        setRecurrence(d.recurrence ?? null);
        setInvestigation(d.investigation ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setSymptoms([]);
        setChanges([]);
        setRecurrence(null);
        setInvestigation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [episode.id, episode.symptom_count]);

  const handleDetach = useCallback(
    async (key: string) => {
      setBusyKey(key);
      try {
        await detachSymptom(episode.id, key);
        setSymptoms((prev) => prev.filter((s) => s.correlation_key !== key));
        onChanged();
      } finally {
        setBusyKey(null);
      }
    },
    [episode.id, onChanged],
  );

  // Prefer the real sentence; fall back to the flag for an agent that only
  // reports that a prior episode existed.
  const recurrenceLabel =
    (recurrence ? recurrenceLine(recurrence) : null) ?? (episode.recurrence_of ? 'recurring' : null);

  const handleDismiss = useCallback(async () => {
    await dismissEpisode(episode.id);
    onChanged();
  }, [episode.id, onChanged]);

  /** Everything the card knows, so the agent is not asked to re-derive it. */
  const askPrompt = [
    `${episode.cause_title}.`,
    symptoms.length ? `${symptoms.length} symptoms across ${episode.namespaces.length} namespaces.` : '',
    recurrenceLabel ? `Recurring: ${recurrenceLabel}.` : '',
    changes.length ? `Changed just before: ${changes.map((c) => c.title).join('; ')}.` : '',
    'What should I do about it?',
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * One chat surface, not two.
   *
   * This used to render its own InlineAgent inside the card, so an operator
   * looking at an episode saw two places to type the same question: the
   * embedded "Ask about this Episode" box, and the Pulse AI sidebar already
   * open beside it with its own input. Two inputs, two conversations, two
   * connection states — and nothing to say which one to use.
   *
   * The sidebar wins because it persists across navigation: an answer about
   * this cause is still there after you follow it to the Timeline or a pod.
   * An inline panel dies with the card that owns it.
   */
  const askAboutThisEpisode = useCallback(() => {
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
    // connectAndSend rather than sendMessage: the socket may not be up yet if
    // the sidebar was collapsed, and sendMessage drops the message with
    // "Agent not connected" rather than waiting.
    useAgentStore.getState().connectAndSend(askPrompt, {
      kind: 'Episode',
      name: episode.id,
      namespace: episode.namespaces[0],
    });
  }, [askPrompt, episode.id, episode.namespaces]);


  // An episode is a claim that one thing explains others. Until it explains
  // something it has made no claim, and dressing it in the same red alarm as a
  // cause with eight symptoms underneath spends the operator's attention on
  // the wrong card.
  //
  // Read from the list payload until the detail fetch answers. Basing this on
  // the async `symptoms` alone meant every card rendered "explains nothing
  // yet" in grey for a beat and then flipped to red — a flash of the wrong
  // state on every episode, every load. `symptom_count` arrives with the list.
  const explainsNothing = symptomsLoaded ? symptoms.length === 0 : episode.symptom_count === 0;

  return (
    <div
      className={cn(
        'rounded-lg border',
        explainsNothing
          ? 'border-slate-700/60 bg-slate-800/30'
          : 'border-red-500/25 bg-red-500/[0.06]',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <AlertTriangle
          className={cn('mt-0.5 h-4 w-4 shrink-0', explainsNothing ? 'text-slate-500' : 'text-red-400')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wider',
                explainsNothing ? 'text-slate-500' : 'text-red-400',
              )}
            >
              Cause
            </span>
            <span className="truncate text-sm font-medium text-slate-100">{episode.cause_title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{episode.cause_category}</span>
            <span>started {formatElapsed(episode.cause_started_at ?? episode.started_at)} ago</span>
            <span>
              {explainsNothing ? (
                // "0 symptoms" reads like a count that failed to load. Saying
                // it in words makes clear this is a state, not a gap.
                'explains nothing yet'
              ) : (
                <>
                  {symptoms.length} {symptoms.length === 1 ? 'symptom' : 'symptoms'}
                  {episode.namespaces.length > 0 && ` across ${episode.namespaces.length} namespaces`}
                </>
              )}
            </span>
            {recurrenceLabel && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                <History className="h-3 w-3" />
                {recurrenceLabel}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={askAboutThisEpisode}
          title="Ask Pulse AI what to do about this cause"
          className="shrink-0 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] font-medium text-violet-300 transition-colors hover:bg-violet-500/15 hover:text-violet-200"
        >
          <Wrench className="h-3 w-3" />
          How do I fix this?
        </button>
        <a
          href={`/timeline?range=${timelineRangeFor(episode.cause_started_at ?? episode.started_at)}`}
          title="See alerts, events, rollouts and config changes from when this cause began"
          className="shrink-0 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
        >
          <Clock className="h-3 w-3" />
          What else changed
        </a>
        <button
          onClick={handleDismiss}
          title="Close this episode — the cause reopens a new one if it returns"
          className="shrink-0 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
        >
          <Check className="h-3 w-3" />
          Dismiss
        </button>
        {(symptoms.length > 0 || investigation) && (
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide symptoms' : 'Show symptoms'}
            className="shrink-0 rounded-sm p-1 text-slate-400 transition-colors hover:bg-slate-700/50"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      {expanded && investigation && (
        <div className="border-t border-red-500/15 px-3 py-2">
          <p className="mb-1.5 text-[11px] text-slate-500">
            {investigation.failed ? 'The agent tried to investigate and could not' : 'Investigated by the agent'}
          </p>
          {investigation.failed ? (
            <p className="text-xs text-amber-300/80">
              {investigation.error || 'The investigation failed.'} Findings below reached you without
              root-cause analysis behind them.
            </p>
          ) : (
            <div className="space-y-1 text-xs text-slate-300">
              {investigation.suspected_cause && (
                <p>
                  <span className="text-slate-500">Suspected cause </span>
                  {investigation.suspected_cause}
                </p>
              )}
              {investigation.recommended_fix && (
                <p>
                  <span className="text-slate-500">Recommended </span>
                  {investigation.recommended_fix}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {expanded && changes.length > 0 && (
        <div className="border-t border-red-500/15 px-3 py-2">
          <p className="mb-1.5 text-[11px] text-slate-500">
            Changed shortly before it started — not necessarily the cause.
          </p>
          <ul className="space-y-0.5">
            {changes.map((c) => (
              <li key={`${c.category}-${c.at}`} className="flex items-center gap-2 py-0.5 text-xs">
                <span className="w-20 shrink-0 text-right tabular-nums text-amber-400/80">
                  −{formatShortDuration(c.seconds_before)}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-300">{c.title}</span>
                <span className="shrink-0 truncate text-slate-500">{c.namespace}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {expanded && symptoms.length > 0 && (
        <div className="border-t border-red-500/15 px-3 py-2">
          <p className="mb-1.5 text-[11px] text-slate-500">
            Explained by the cause above — not separate problems.
          </p>
          <ul className="space-y-0.5">
            {symptoms.map((s) => (
              <li key={s.correlation_key} className="group flex items-center gap-2 py-0.5 text-xs">
                <span className="w-24 shrink-0 truncate text-slate-500">{s.category}</span>
                <span className="min-w-0 flex-1 truncate text-slate-300">{s.title}</span>
                <button
                  onClick={() => handleDetach(s.correlation_key)}
                  disabled={busyKey === s.correlation_key}
                  title="This was not caused by the episode above"
                  className={cn(
                    'shrink-0 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-slate-500',
                    'opacity-0 transition-opacity hover:bg-slate-700/50 hover:text-slate-300',
                    'focus:opacity-100 group-hover:opacity-100 disabled:opacity-40',
                  )}
                >
                  <Ban className="h-3 w-3" />
                  Not related
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function EpisodePanel() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  const load = useCallback(() => {
    fetchOpenEpisodes()
      // Most explanatory first. Two control-plane memory episodes opened in
      // the same second on the reference cluster: one explained eight
      // symptoms, its twin explained none, and the empty one rendered first.
      // Neither can explain the other — equal causal layers — so symptom
      // ownership went entirely to whichever claimed them, and the loser
      // still took a full-width card at the top of the queue.
      .then((list) => setEpisodes([...list].sort((a, b) => b.symptom_count - a.symptom_count)))
      .catch(() => setEpisodes([]));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (episodes.length === 0) return null;

  return (
    <div className="space-y-2 px-4 pt-3">
      {episodes.map((e) => (
        <EpisodeCard key={e.id} episode={e} onChanged={load} />
      ))}
    </div>
  );
}
