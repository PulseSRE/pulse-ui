import { describe, expect, it } from 'vitest';
import { GRID_COLS, toCurrentGrid } from '../grid';

describe('toCurrentGrid', () => {
  it('rescales 4-column positions to 12 columns', () => {
    const out = toCurrentGrid({
      0: { x: 0, y: 0, w: 4, h: 3 },
      1: { x: 2, y: 3, w: 2, h: 10 },
      2: { x: 3, y: 13, w: 1, h: 3 },
    });
    expect(out).toEqual({
      0: { x: 0, y: 0, w: 12, h: 3 },
      1: { x: 6, y: 3, w: 6, h: 10 },
      2: { x: 9, y: 13, w: 3, h: 3 },
    });
  });

  it('leaves positions already on the current grid alone', () => {
    const cells = { 0: { x: 4, y: 0, w: 4, h: 3 } };
    expect(toCurrentGrid(cells, GRID_COLS)).toEqual(cells);
  });

  it('never lets a cell overflow the grid', () => {
    const out = toCurrentGrid({ 0: { x: 3, y: 0, w: 4, h: 2 } });
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(GRID_COLS);
  });

  it('keeps an unknown grid as it is rather than guessing', () => {
    const cells = { 0: { x: 1, y: 0, w: 5, h: 2 } };
    expect(toCurrentGrid(cells, 7)).toEqual(cells);
    expect(toCurrentGrid(undefined)).toEqual({});
  });
});
