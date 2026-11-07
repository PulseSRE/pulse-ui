import { useSyncExternalStore } from 'react';

/**
 * Below Tailwind's `sm` breakpoint (640px): the width at which the shell
 * collapses the command bar into "More", hides the AI rail and opens chat as a
 * bottom sheet. Keep in step with the `sm:` / `max-sm:` classes those use.
 */
export const PHONE_QUERY = '(max-width: 639.98px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}

function snapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(PHONE_QUERY).matches;
}

/** True while the viewport is phone width. False where matchMedia is unavailable. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
