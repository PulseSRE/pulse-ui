import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, ChevronDown, ChevronRight, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { detachSymptom, fetchEpisode, fetchOpenEpisodes } from '../../engine/episodeApi';
import type { Episode, EpisodeSymptom } from '../../engine/episodeApi';

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

function since(startedAt: number): string {
  const mins = Math.max(0, Math.round((Date.now() / 1000 - startedAt) / 60));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

function EpisodeCard({ episode, onChanged }: { episode: Episode; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [symptoms, setSymptoms] = useState<EpisodeSymptom[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEpisode(episode.id)
      .then((d) => {
        if (!cancelled) setSymptoms(d.symptoms.filter((s) => s.detached_at == null));
      })
      .catch(() => {
        if (!cancelled) setSymptoms([]);
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

  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/[0.06]">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Cause</span>
            <span className="truncate text-sm font-medium text-slate-100">{episode.cause_title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{episode.cause_category}</span>
            <span>started {since(episode.started_at)} ago</span>
            <span>
              {symptoms.length} {symptoms.length === 1 ? 'symptom' : 'symptoms'}
              {episode.namespaces.length > 0 && ` across ${episode.namespaces.length} namespaces`}
            </span>
            {episode.recurrence_of && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <History className="h-3 w-3" />
                recurring
              </span>
            )}
          </div>
        </div>
        {symptoms.length > 0 && (
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
      .then(setEpisodes)
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
