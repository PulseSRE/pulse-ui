import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, History } from 'lucide-react';
import { fetchOpenEpisodes } from '../../engine/episodeApi';
import type { Episode } from '../../engine/episodeApi';
import { formatElapsed } from '../../engine/dateUtils';

/**
 * Puts an open episode at the top of the landing view.
 *
 * The audit item this closes asked for "one front door": at 03:00 an SRE needs
 * one screen that says what is wrong, and the product should already know
 * which one. Building the episode panel inside the Inbox tab was not that —
 * you still had to land on the dashboard and know to go looking.
 *
 * A banner rather than another card, and above everything else, because an
 * open episode outranks every tile beneath it by construction: those tiles are
 * showing its symptoms.
 */

export function OpenEpisodeBanner({ onOpen }: { onOpen: () => void }) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchOpenEpisodes()
        .then((e) => {
          if (!cancelled) setEpisodes(e);
        })
        .catch(() => {
          if (!cancelled) setEpisodes([]);
        });
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (episodes.length === 0) return null;

  const [first, ...rest] = episodes;

  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-left transition-colors hover:bg-red-500/15"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
            Open incident
          </span>
          <span className="truncate text-sm font-medium text-slate-100">{first.cause_title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          <span>running {formatElapsed(first.started_at)}</span>
          <span>
            {first.symptom_count} {first.symptom_count === 1 ? 'symptom' : 'symptoms'}
            {first.namespaces.length > 0 && ` across ${first.namespaces.length} namespaces`}
          </span>
          {first.recurrence_of && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <History className="h-3 w-3" />
              seen before
            </span>
          )}
          {rest.length > 0 && <span>+{rest.length} more open</span>}
        </div>
      </div>
      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-red-300 group-hover:text-red-200">
        Investigate
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
