import { describe, it, expect } from 'vitest';
import { compareToUsual, formatMetricValue, isFlatZero, thresholdColor, THRESHOLD_COLORS, usualQuery } from '../metricFormat';

describe('formatMetricValue', () => {
  it.each([
    [4, '4'],
    [10, '10'],
    [0, '0'],
    [-3, '-3'],
    [0.0013, '0.0013'], // a crash loop's restart rate, previously shown as "0.0"
    [0.25, '0.25'],
    [6.371, '6.37'],
    [51.56, '51.6'],
    [58, '58'],
    [12345.6, '12,346'],
    [20000, '20,000'],
  ])('%s → %s', (value, expected) => {
    expect(formatMetricValue(value)).toBe(expected);
  });

  it('does not render non-finite values as numbers', () => {
    expect(formatMetricValue(Number.NaN)).toBe('—');
    expect(formatMetricValue(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('thresholdColor', () => {
  it('treats critical above warning as higher-is-worse', () => {
    const t = { warning: 70, critical: 90 };
    expect(thresholdColor(50, t)).toBeNull();
    expect(thresholdColor(75, t)).toBe(THRESHOLD_COLORS.warning);
    expect(thresholdColor(95, t)).toBe(THRESHOLD_COLORS.critical);
  });

  it('treats critical below warning as lower-is-worse', () => {
    // The agent's Nodes Ready card: fewer ready nodes is the problem.
    const t = { warning: 2, critical: 1 };
    expect(thresholdColor(4, t)).toBeNull();
    expect(thresholdColor(2, t)).toBe(THRESHOLD_COLORS.warning);
    expect(thresholdColor(1, t)).toBe(THRESHOLD_COLORS.critical);
    expect(thresholdColor(0, t)).toBe(THRESHOLD_COLORS.critical);
  });

  it('returns null without a value or thresholds', () => {
    expect(thresholdColor(null, { warning: 1, critical: 2 })).toBeNull();
    expect(thresholdColor(5)).toBeNull();
  });
});

describe('compareToUsual', () => {
  it('says how far today is from usual, with the direction thresholds give', () => {
    const higherIsWorse = { warning: 70, critical: 90 };
    expect(compareToUsual(80, 40, higherIsWorse)).toEqual({ label: '2× usual', tone: 'worse', usual: 40 });
    expect(compareToUsual(10, 40, higherIsWorse)).toEqual({ label: '0.3× usual', tone: 'better', usual: 40 });
    const lowerIsWorse = { warning: 2, critical: 1 };
    expect(compareToUsual(2, 6, lowerIsWorse)?.tone).toBe('worse');
  });

  it('is neutral without thresholds, and "usual" inside the normal band', () => {
    expect(compareToUsual(90, 30)?.tone).toBe('neutral');
    expect(compareToUsual(42, 40)?.label).toBe('usual');
    expect(compareToUsual(500, 40)?.label).toBe('13× usual');
  });

  it('says nothing it cannot back up', () => {
    expect(compareToUsual(5, 0)).toBeNull(); // no "∞× usual"
    expect(compareToUsual(null, 4)).toBeNull();
    expect(compareToUsual(5, null)).toBeNull();
    expect(compareToUsual(5, Number.NaN)).toBeNull();
    expect(compareToUsual(-5, 4)).toBeNull();
  });

  it('builds the usual query from the card query', () => {
    expect(usualQuery('sum(up)')).toBe('quantile_over_time(0.5, (sum(up))[24h:10m])');
  });
});

describe('isFlatZero', () => {
  it('is true only when there is data and all of it is zero', () => {
    expect(isFlatZero([{ data: [[1, 0], [2, 0]] }, { data: [[1, 0]] }])).toBe(true);
    expect(isFlatZero([{ data: [[1, 0], [2, 1]] }])).toBe(false);
    expect(isFlatZero([{ data: [] }])).toBe(false);
    expect(isFlatZero([])).toBe(false);
    expect(isFlatZero([{ data: [[1, Number.NaN], [2, 0]] }])).toBe(true);
  });
});
