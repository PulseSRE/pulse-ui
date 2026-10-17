import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Grid geometry shared with CustomView's <Responsive> (rowHeight, margin[1]). */
export const GRID_ROW_HEIGHT = 32;
export const GRID_MARGIN_Y = 8;

/** Padding + border the cell adds around widgets that do not draw their own card (p-3 + 1px border). */
const CELL_FRAME_PX = 2 * 12 + 2;

/**
 * Widget kinds whose root element already draws a bordered card. The grid
 * cell drops its own card for these, so they are not framed twice. Measured
 * from rendered widgets, not assumed; a kind missing here keeps the cell card,
 * which is the safe default.
 */
export const SELF_FRAMED_KINDS: ReadonlySet<string> = new Set([
  'bar_list',
  'blast_radius',
  'chart',
  'data_table',
  'key_value',
  'log_viewer',
  'metric_card',
  'node_map',
  'progress_list',
  'relationship_tree',
  'resolution_tracker',
  'section',
  'stat_card',
  'status_list',
  'tabs',
  'timeline',
  'topology',
  'yaml_viewer',
]);

/**
 * Grid rows needed to show `contentPx` of widget content without clipping or
 * slack. A cell of h rows is h*rowHeight + (h-1)*margin pixels tall.
 */
export function rowsForContent(contentPx: number, selfFramed: boolean): number {
  const needed = contentPx + (selfFramed ? 0 : CELL_FRAME_PX);
  return Math.max(2, Math.ceil((needed + GRID_MARGIN_Y) / (GRID_ROW_HEIGHT + GRID_MARGIN_Y)));
}

/**
 * Measures each widget's natural content height and returns the grid rows it
 * needs. Heights from the layout engine are estimates made before anything
 * renders, and were often 2-4x the content (a 141px node map in a 472px cell).
 * Callers apply these in view mode only, so edit mode still shows and saves
 * the stored sizes a person chose.
 */
export function useFitToContent(kinds: string[], enabled: boolean) {
  const [rows, setRows] = useState<Record<number, number>>({});
  const observers = useRef(new Map<number, ResizeObserver>());
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;

  // One stable ref callback per widget index. A fresh function each render
  // would make React detach and re-attach every observer on every render.
  // Rebuilt (synchronously) when `enabled` flips, so no stale closure survives.
  const callbacks = useMemo(() => {
    void enabled; // keyed on `enabled`: each callback closes over it
    return new Map<number, (node: HTMLElement | null) => void>();
  }, [enabled]);

  const contentRef = useCallback(
    (index: number) => {
      const cached = callbacks.get(index);
      if (cached) return cached;
      const callback = (node: HTMLElement | null) => {
        observers.current.get(index)?.disconnect();
        observers.current.delete(index);
        if (!node || !enabled || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
          const height = node.getBoundingClientRect().height;
          if (height <= 0) return;
          const next = rowsForContent(height, SELF_FRAMED_KINDS.has(kindsRef.current[index] ?? ''));
          setRows((prev) => (prev[index] === next ? prev : { ...prev, [index]: next }));
        });
        observer.observe(node);
        observers.current.set(index, observer);
      };
      callbacks.set(index, callback);
      return callback;
    },
    [enabled, callbacks],
  );

  useEffect(() => {
    const current = observers.current;
    return () => {
      current.forEach((o) => o.disconnect());
      current.clear();
    };
  }, []);

  // A widget removed or reordered must not keep a stale height.
  useEffect(() => {
    setRows({});
  }, [kinds.length]);

  return { rows: enabled ? rows : {}, contentRef };
}
