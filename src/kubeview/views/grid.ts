/**
 * The dashboard grid. Positions come from the agent's layout engine
 * (pulse-agent layout_engine.GRID_COLS), which lays out on 12 columns so a row
 * splits evenly into halves, thirds, quarters and sixths.
 *
 * Dashboards used to be laid out on 4 columns. Saved views were rescaled by
 * the agent's migration 037; an exported file from before then carries no
 * `gridColumns`, and is rescaled here when it is imported.
 */

export const GRID_COLS = 12;
export const LEGACY_GRID_COLS = 4;

export type GridCell = { x: number; y: number; w: number; h: number };

/** Positions laid out on `fromCols` columns, rescaled to the current grid. */
export function toCurrentGrid(
  positions: Record<string | number, GridCell> | undefined,
  fromCols: number = LEGACY_GRID_COLS,
): Record<string, GridCell> {
  const out: Record<string, GridCell> = {};
  if (!positions) return out;
  if (!Number.isInteger(fromCols) || fromCols <= 0 || GRID_COLS % fromCols !== 0) {
    // Unknown grid: keep positions as they are rather than guess a scale.
    for (const [k, v] of Object.entries(positions)) out[k] = v;
    return out;
  }
  const scale = GRID_COLS / fromCols;
  for (const [k, cell] of Object.entries(positions)) {
    if (!cell || typeof cell.x !== 'number' || typeof cell.w !== 'number') {
      out[k] = cell;
      continue;
    }
    const x = Math.min(cell.x * scale, GRID_COLS - 1);
    out[k] = { ...cell, x, w: Math.max(1, Math.min(cell.w * scale, GRID_COLS - x)) };
  }
  return out;
}
