import { describe, it, expect } from 'vitest';
import { isSnapshotData } from '../chartShape';

const at = (ts: number, v: number): [number, number] => [ts, v];

describe('isSnapshotData', () => {
  it('is true for one sample per series at a shared instant (instant query)', () => {
    expect(isSnapshotData('bar', [{ data: [at(100, 14)] }, { data: [at(100, 3)] }])).toBe(true);
    expect(isSnapshotData('line', [{ data: [at(100, 14)] }])).toBe(true);
  });

  it('is false for a real time series', () => {
    expect(isSnapshotData('line', [{ data: [at(100, 1), at(160, 2)] }])).toBe(false);
  });

  it('is false when single samples are at different instants', () => {
    expect(isSnapshotData('bar', [{ data: [at(100, 1)] }, { data: [at(160, 2)] }])).toBe(false);
  });

  it('leaves non-time charts alone', () => {
    expect(isSnapshotData('donut', [{ data: [at(100, 1)] }])).toBe(false);
    expect(isSnapshotData('scatter', [{ data: [at(100, 1)] }])).toBe(false);
  });

  it('is false with no series or no data', () => {
    expect(isSnapshotData('bar', [])).toBe(false);
    expect(isSnapshotData('bar', [{ data: [] }])).toBe(false);
  });
});
