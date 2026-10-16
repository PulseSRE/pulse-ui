import { describe, it, expect } from 'vitest';
import { rowsForContent, SELF_FRAMED_KINDS, GRID_ROW_HEIGHT, GRID_MARGIN_Y } from '../fitToContent';

const cellPx = (rows: number) => rows * GRID_ROW_HEIGHT + (rows - 1) * GRID_MARGIN_Y;

describe('rowsForContent', () => {
  it('returns the fewest rows whose cell holds the content', () => {
    for (const px of [40, 74, 75, 141, 334, 591]) {
      const rows = rowsForContent(px, true);
      expect(cellPx(rows)).toBeGreaterThanOrEqual(px);
      expect(cellPx(rows - 1)).toBeLessThan(px);
    }
  });

  it('adds the cell frame for widgets that do not draw their own', () => {
    const framed = rowsForContent(100, false);
    const bare = rowsForContent(100, true);
    expect(cellPx(framed)).toBeGreaterThanOrEqual(100 + 26);
    expect(framed).toBeGreaterThanOrEqual(bare);
  });

  it('never goes below two rows', () => {
    expect(rowsForContent(1, true)).toBe(2);
  });

  it('treats kinds that draw a bordered card as self-framed', () => {
    for (const k of ['chart', 'data_table', 'metric_card', 'tabs']) expect(SELF_FRAMED_KINDS.has(k)).toBe(true);
    for (const k of ['badge_list', 'info_card_grid', 'action_button']) expect(SELF_FRAMED_KINDS.has(k)).toBe(false);
  });
});
