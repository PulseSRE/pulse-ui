import { useEffect, useState } from 'react';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * A Prometheus range window that holds still between ticks.
 *
 * Pages used to compute `end = Date.now()` on every render and put it in the
 * query key, so any re-render — a chart hover setting state, for one — made a
 * new key, refetched every chart and flashed their skeletons. The window here
 * is state: it moves forward every `advanceMs` (and when the range changes),
 * and stays the same in between.
 */
export function useMetricsWindow(rangeSeconds: number, advanceMs = 60_000) {
  const [end, setEnd] = useState(nowSeconds);
  const [range, setRange] = useState(rangeSeconds);
  if (range !== rangeSeconds) {
    // A new range starts a fresh window ending now.
    setRange(rangeSeconds);
    setEnd(nowSeconds());
  }

  useEffect(() => {
    const id = setInterval(() => setEnd(nowSeconds()), advanceMs);
    return () => clearInterval(id);
  }, [advanceMs]);

  const step = Math.max(15, Math.floor(rangeSeconds / 200));
  return { start: end - rangeSeconds, end, step };
}
