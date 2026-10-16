import { describe, it, expect } from 'vitest';
import { formatMetricValue, thresholdColor, THRESHOLD_COLORS } from '../metricFormat';

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
