import type { ColumnDef } from '../../engine/renderers';

/**
 * One `grid-template-columns` for the whole resource list.
 *
 * The header used to be an auto-layout `<table>` and the rows flex `<div>`s,
 * so the two only agreed when every column had a fixed width: on Pods the
 * status sat under READY. The header row, the filter row and every body row
 * now use this one string, so a cell can only ever sit under its own header.
 */

/** Width of the selection checkbox column. */
export const SELECT_COLUMN_PX = 48;
/** Floor for a percentage column (in practice Name): it grows, never squeezes below this. */
export const FLEX_PERCENT_MIN_PX = 200;
/** Floor for a column with no declared width (auto-detected CRD columns). */
export const FLEX_AUTO_MIN_PX = 120;
/** Horizontal padding of a cell (px-4 on both sides). */
const CELL_PADDING_PX = 32;
/** One icon button in the actions cell, plus the gap after it. */
const ACTION_ITEM_PX = 30;
/** One character of a header (text-xs semibold, uppercase, tracking-wide), generously rounded up. */
const HEADER_CHAR_PX = 10;
/** The sort chevron and its gap. */
const SORT_ICON_PX = 16;

export interface ColumnTemplate {
  /** The `grid-template-columns` value shared by header and rows. */
  template: string;
  /** Narrowest the table can be before it scrolls horizontally instead of squeezing. */
  minWidth: number;
}

interface Track { track: string; min: number }

const FIXED_RE = /^(\d+(?:\.\d+)?)px$/;

/** Width the column's header needs so it is never cut to "REA…". */
export function headerWidth(header = '', sortable = false): number {
  return CELL_PADDING_PX + header.length * HEADER_CHAR_PX + (sortable ? SORT_ICON_PX : 0);
}

/**
 * Grid track for a column's declared CSS width, never narrower than its header
 * (a fixed width the header does not fit in is widened, for header and cells alike).
 */
export function trackFor(width: string | undefined, header?: string, sortable?: boolean): Track {
  const floor = headerWidth(header, sortable);
  const fixed = width ? FIXED_RE.exec(width.trim()) : null;
  if (fixed) {
    const px = Math.max(Number(fixed[1]), floor);
    return { track: `${px}px`, min: px };
  }
  // A percentage (Name, 25%) is the column meant to grow with the window.
  const min = Math.max(width && width.trim().endsWith('%') ? FLEX_PERCENT_MIN_PX : FLEX_AUTO_MIN_PX, floor);
  const fr = width && width.trim().endsWith('%') ? 2 : 1;
  return { track: `minmax(${min}px, ${fr}fr)`, min };
}

/**
 * Width of the actions column, from the number of icon controls a row shows
 * (inline enhancer actions, the workload menu, YAML and Delete). It is the last
 * column, so a row whose actions run wider cannot push another column out of
 * line; `measured` (the widest actions content seen) only widens it.
 */
export function actionsColumnWidth(itemCount: number, measured = 0): number {
  const estimate = CELL_PADDING_PX + Math.max(1, itemCount) * ACTION_ITEM_PX;
  return Math.max(estimate, measured > 0 ? measured + CELL_PADDING_PX : 0);
}

export function buildColumnTemplate(columns: Pick<ColumnDef, 'width' | 'header' | 'sortable'>[], actionsWidth: number): ColumnTemplate {
  const tracks: Track[] = [
    { track: `${SELECT_COLUMN_PX}px`, min: SELECT_COLUMN_PX },
    ...columns.map((c) => trackFor(c.width, c.header, c.sortable)),
    { track: `${actionsWidth}px`, min: actionsWidth },
  ];
  return {
    template: tracks.map((t) => t.track).join(' '),
    minWidth: tracks.reduce((sum, t) => sum + t.min, 0),
  };
}
