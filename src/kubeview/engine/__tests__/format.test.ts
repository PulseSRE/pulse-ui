import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import {
  formatAge, formatRelative, formatDurationMs, formatDurationSeconds, formatDurationBetween,
  formatShortDuration, formatElapsed, formatMetricSeconds, formatPromRange, formatBytes,
  formatBytesIEC, formatTimestamp, formatDate, formatTime, formatClock, formatCount, toIsoString,
  getDateKey, toEpochMs,
} from '../format';
import { formatBytes as metricBytes, formatDuration as metricDuration } from '../../components/metrics/AutoMetrics';
import { formatDuration as promDuration } from '../../components/metrics/prometheus';

const NOW = Date.UTC(2026, 9, 30, 14, 5, 9);
const ago = (ms: number) => NOW - ms;
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe('toEpochMs', () => {
  it('accepts numbers, ISO strings and Dates; rejects missing and garbage', () => {
    expect(toEpochMs(NOW)).toBe(NOW);
    expect(toEpochMs(new Date(NOW).toISOString())).toBe(NOW);
    expect(toEpochMs(new Date(NOW))).toBe(NOW);
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs('')).toBeNull();
    expect(toEpochMs('not a date')).toBeNull();
  });
});

describe('formatAge (bare table age)', () => {
  it('uses the coarsest whole unit', () => {
    expect(formatAge(ago(45 * S), '—', NOW)).toBe('45s');
    expect(formatAge(ago(12 * M), '—', NOW)).toBe('12m');
    expect(formatAge(ago(3 * H), '—', NOW)).toBe('3h');
    expect(formatAge(ago(5 * D), '—', NOW)).toBe('5d');
    expect(formatAge(ago(65 * D), '—', NOW)).toBe('65d');
    expect(formatAge(ago(364 * D), '—', NOW)).toBe('364d');
    expect(formatAge(ago(400 * D), '—', NOW)).toBe('1y');
  });
  it('shows the fallback for a missing timestamp and 0s for clock skew', () => {
    expect(formatAge(undefined, '-', NOW)).toBe('-');
    expect(formatAge('garbage', undefined, NOW)).toBe('—');
    expect(formatAge(NOW + 5 * S, '—', NOW)).toBe('0s');
  });
});

describe('formatRelative', () => {
  it('says just now under five seconds and for future timestamps', () => {
    expect(formatRelative(ago(0), '—', NOW)).toBe('just now');
    expect(formatRelative(ago(4 * S), '—', NOW)).toBe('just now');
    expect(formatRelative(NOW + M, '—', NOW)).toBe('just now');
  });
  it('carries its own "ago"', () => {
    expect(formatRelative(ago(30 * S), '—', NOW)).toBe('30s ago');
    expect(formatRelative(ago(5 * M), '—', NOW)).toBe('5m ago');
    expect(formatRelative(ago(2 * D), '—', NOW)).toBe('2d ago');
    expect(formatRelative(ago(65 * D), '—', NOW)).toBe('2mo ago');
  });
});

describe('durations', () => {
  it('formats measured spans in compound units', () => {
    expect(formatDurationMs(500)).toBe('<1s');
    expect(formatDurationMs(45 * S)).toBe('45s');
    expect(formatDurationMs(5 * M + 30 * S)).toBe('5m 30s');
    expect(formatDurationMs(5 * M)).toBe('5m');
    expect(formatDurationMs(2 * H + 5 * M)).toBe('2h 5m');
    expect(formatDurationMs(3 * D + 4 * H)).toBe('3d 4h');
    expect(formatDurationMs(-5)).toBe('<1s');
  });
  it('formats seconds and spans between timestamps', () => {
    expect(formatDurationSeconds(90)).toBe('1m 30s');
    expect(formatDurationSeconds(0.2)).toBe('<1s');
    expect(formatDurationBetween('2026-10-30T10:00:00Z', '2026-10-30T10:02:03Z')).toBe('2m 3s');
    expect(formatDurationBetween(ago(90 * S), undefined, NOW)).toBe('1m 30s');
    expect(formatDurationBetween('', undefined, NOW)).toBe('—');
  });
  it('formats label spans, elapsed time, metric seconds and Prometheus ranges', () => {
    expect(formatShortDuration(7200)).toBe('2h');
    expect(formatElapsed(NOW / 1000 - 1800, NOW)).toBe('30m');
    expect(formatMetricSeconds(0.012)).toBe('12ms');
    expect(formatMetricSeconds(0.0002)).toBe('200µs');
    expect(formatMetricSeconds(1.5)).toBe('1.5s');
    expect(formatPromRange(1209600)).toBe('2w');
  });
});

describe('bytes', () => {
  it('formats Kubernetes quantities and IEC metric values', () => {
    expect(formatBytes(512)).toBe('512');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 Gi');
    expect(formatBytesIEC(0)).toBe('0 B');
    expect(formatBytesIEC(1536)).toBe('1.50 KiB');
    expect(formatBytesIEC(256 * 1024 ** 3)).toBe('256 GiB');
    expect(formatBytesIEC(1024 ** 6)).toContain('TiB');
  });
});

// Pin the zone so the absolute-time assertions below do not depend on where
// the test runs. Node re-reads TZ when it is assigned.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

describe('timestamps use a fixed locale', () => {
  const iso = '2026-10-30T14:05:09Z';
  afterEach(() => vi.restoreAllMocks());

  it('renders one absolute format regardless of the browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(formatTimestamp(iso)).toBe('Oct 30, 2026, 2:05:09 PM');
    expect(formatDate(iso)).toBe('Oct 30, 2026');
    expect(formatTime(iso)).toBe('2:05:09 PM');
    expect(formatClock(iso)).toBe('2:05 PM');
    expect(formatTimestamp(iso, '—', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })).toBe('Oct 30, 2026, 2:05 PM');
  });

  it('accepts epoch ms, ISO strings and Dates alike', () => {
    const ms = Date.parse(iso);
    expect(formatTimestamp(ms)).toBe(formatTimestamp(iso));
    expect(formatTimestamp(new Date(ms))).toBe(formatTimestamp(iso));
    expect(toIsoString(ms)).toBe('2026-10-30T14:05:09.000Z');
  });

  it('falls back for missing or unparseable times', () => {
    expect(formatTimestamp(undefined)).toBe('—');
    expect(formatTimestamp('not a date')).toBe('—');
    expect(formatDate(null, 'never')).toBe('never');
    expect(formatClock('')).toBe('—');
    expect(toIsoString(undefined)).toBeUndefined();
  });

  it('only shifts the hour when the time zone changes, never the shape', () => {
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatTimestamp(iso)).toBe('Oct 30, 2026, 7:05:09 AM');
      expect(formatClock(iso)).toBe('7:05 AM');
    } finally {
      process.env.TZ = 'UTC';
    }
    expect(formatTimestamp(iso)).toBe('Oct 30, 2026, 2:05:09 PM');
  });

  it('groups dates as Today / Yesterday / full date', () => {
    const now = new Date(2026, 9, 30, 12);
    expect(getDateKey(new Date(2026, 9, 30, 1), now)).toBe('Today');
    expect(getDateKey(new Date(2026, 9, 29, 23), now)).toBe('Yesterday');
    expect(getDateKey(new Date(2026, 9, 1), now)).toBe('October 1, 2026');
  });
});

describe('formatCount', () => {
  afterEach(() => vi.restoreAllMocks());
  it('groups digits the same way in every browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(-4200)).toBe('-4,200');
  });
  it('rounds to a whole number and falls back for missing values', () => {
    expect(formatCount(1234.6)).toBe('1,235');
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount(Number.NaN, '?')).toBe('?');
  });
});

describe('metric helpers agree with engine/format', () => {
  it('keeps metric bytes and durations on the unified output', () => {
    expect(metricBytes(1536)).toBe('1.50 KiB');
    expect(metricDuration(0.25)).toBe('250ms');
    expect(promDuration(300)).toBe('5m');
  });
});
