import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { SeverityBanner } from '../../components/primitives/SeverityBanner';
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

export function OpenEpisodeBanner({
  onOpen,
  onVisibleChange,
}: {
  onOpen: () => void;
  /**
   * Told whether the banner is showing, so the posture bar below can drop its
   * own Investigate action instead of rendering a second identical red button
   * that goes to the same place.
   */
  onVisibleChange?: (visible: boolean) => void;
}) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const visible = episodes.length > 0;

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  useEffect(() => () => onVisibleChange?.(false), [onVisibleChange]);

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

  if (!visible) return null;

  const [first, ...rest] = episodes;

  return (
    <SeverityBanner
      level="red"
      eyebrow="Open incident"
      action={{ label: 'Investigate', onClick: onOpen }}
      meta={
        <>
          <span>running {formatElapsed(first.cause_started_at ?? first.started_at)}</span>
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
        </>
      }
    >
      <span className="font-medium">{first.cause_title}</span>
    </SeverityBanner>
  );
}
