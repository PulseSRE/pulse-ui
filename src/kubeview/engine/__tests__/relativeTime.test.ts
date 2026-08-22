import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from '../formatters';

/**
 * Two things this got wrong, both visible on the landing page.
 *
 * The status bar rendered `synced {formatRelativeTime(t)} ago` while the
 * function already ends in "ago" — "synced 26s ago ago", on every page.
 *
 * And the subtraction was unclamped. The timestamp comes from the agent and
 * the comparison from the browser: two machines, two clocks. A beat of skew
 * rendered "Last scan: -1s ago".
 */

const NOW = 1_787_000_000_000;

function at(msAgo: number) {
  vi.setSystemTime(NOW);
  return formatRelativeTime(NOW - msAgo);
}

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('never reports the past as the future', () => {
    vi.useFakeTimers();
    // Agent clock a second ahead of the browser's.
    expect(at(-1000)).toBe('just now');
    expect(at(-60_000)).toBe('just now');
  });

  it('says just now rather than counting single seconds', () => {
    vi.useFakeTimers();
    expect(at(0)).toBe('just now');
    expect(at(4_000)).toBe('just now');
  });

  it('counts seconds, minutes, hours and days', () => {
    vi.useFakeTimers();
    expect(at(30_000)).toBe('30s ago');
    expect(at(5 * 60_000)).toBe('5m ago');
    expect(at(3 * 3_600_000)).toBe('3h ago');
    expect(at(2 * 86_400_000)).toBe('2d ago');
  });

  it('already carries its own "ago", so callers must not add one', () => {
    // The bug was `synced ${formatRelativeTime(t)} ago`. Anything appending to
    // this needs to know the word is already there.
    vi.useFakeTimers();
    expect(at(30_000).endsWith('ago')).toBe(true);
  });
});
