import { describe, it, expect } from 'vitest';
import { parseCpu, parseMem, formatMem, parseResourceValue, formatCpu, formatResourceValue } from '../formatting';
import { formatBytes } from '../format';

describe('parseCpu', () => {
  it('parses millicores', () => {
    expect(parseCpu('500m')).toBe(0.5);
    expect(parseCpu('1000m')).toBe(1);
    expect(parseCpu('100m')).toBe(0.1);
  });

  it('parses whole cores', () => {
    expect(parseCpu('2')).toBe(2);
    expect(parseCpu('0.5')).toBe(0.5);
  });

  it('returns 0 for invalid input', () => {
    expect(parseCpu('')).toBe(0);
    expect(parseCpu('abc')).toBe(0);
  });
});

describe('parseMem', () => {
  it('parses Ki', () => {
    expect(parseMem('1024Ki')).toBe(1024 * 1024);
  });

  it('parses Mi', () => {
    expect(parseMem('256Mi')).toBe(256 * 1024 * 1024);
  });

  it('parses Gi', () => {
    expect(parseMem('2Gi')).toBe(2 * 1024 * 1024 * 1024);
  });

  it('parses Ti', () => {
    expect(parseMem('1Ti')).toBe(1024 * 1024 * 1024 * 1024);
  });

  it('parses plain bytes', () => {
    expect(parseMem('4096')).toBe(4096);
  });

  it('returns 0 for invalid', () => {
    expect(parseMem('abc')).toBe(0);
  });
});

describe('formatMem', () => {
  it('formats Gi', () => {
    expect(formatMem(2 * 1024 * 1024 * 1024)).toBe('2 Gi');
  });

  it('formats Mi', () => {
    expect(formatMem(512 * 1024 * 1024)).toBe('512 Mi');
  });

  it('formats small values as raw bytes', () => {
    expect(formatMem(1000)).toBe('1000');
  });
});

describe('parseResourceValue', () => {
  it('returns 0 for undefined', () => {
    expect(parseResourceValue(undefined)).toBe(0);
  });

  it('parses Ki', () => {
    expect(parseResourceValue('10Ki')).toBe(10 * 1024);
  });

  it('parses Mi', () => {
    expect(parseResourceValue('1Mi')).toBe(1024 * 1024);
  });

  it('parses Gi', () => {
    expect(parseResourceValue('1Gi')).toBe(1024 * 1024 * 1024);
  });

  it('parses Ti', () => {
    expect(parseResourceValue('1Ti')).toBe(1024 ** 4);
  });

  it('parses millicores (m)', () => {
    expect(parseResourceValue('500m')).toBe(0.5);
  });

  it('parses k (decimal kilo)', () => {
    expect(parseResourceValue('2k')).toBe(2000);
  });

  it('parses M (decimal mega)', () => {
    expect(parseResourceValue('1M')).toBe(1000000);
  });

  it('parses G (decimal giga)', () => {
    expect(parseResourceValue('1G')).toBe(1000000000);
  });

  it('parses plain number', () => {
    expect(parseResourceValue('42')).toBe(42);
  });
});

describe('formatBytes', () => {
  it('formats Ti', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 Ti');
  });

  it('formats Gi', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 Gi');
  });

  it('formats Mi', () => {
    expect(formatBytes(1024 ** 2)).toBe('1 Mi');
  });

  it('formats Ki', () => {
    expect(formatBytes(2048)).toBe('2 Ki');
  });

  it('formats small values as raw bytes', () => {
    expect(formatBytes(512)).toBe('512');
  });
});

describe('formatCpu', () => {
  it('formats whole cores', () => {
    expect(formatCpu(2)).toBe('2.0 cores');
    expect(formatCpu(1.5)).toBe('1.5 cores');
  });

  it('formats millicores for sub-core values', () => {
    expect(formatCpu(0.5)).toBe('500m');
    expect(formatCpu(0.25)).toBe('250m');
  });
});

describe('formatResourceValue', () => {
  it('returns dash for empty value', () => {
    expect(formatResourceValue('', 'memory')).toBe('—');
  });

  it('formats memory values in Gi', () => {
    const result = formatResourceValue('2Gi', 'memory');
    expect(result).toBe('2.0 Gi');
  });

  it('formats memory values in Mi', () => {
    const result = formatResourceValue('512Mi', 'memory');
    expect(result).toBe('512 Mi');
  });

  it('formats storage values', () => {
    const result = formatResourceValue('10Gi', 'storage');
    expect(result).toBe('10.0 Gi');
  });

  it('formats ephemeral-storage values', () => {
    const result = formatResourceValue('1Gi', 'ephemeral-storage');
    expect(result).toBe('1.0 Gi');
  });

  it('returns raw value for cpu resource', () => {
    expect(formatResourceValue('500m', 'cpu')).toBe('500m');
  });

  it('formats small memory as Mi when >= 1Mi', () => {
    const result = formatResourceValue('2048Ki', 'memory');
    expect(result).toBe('2 Mi');
  });

  it('returns raw value for very small memory', () => {
    expect(formatResourceValue('500', 'memory')).toBe('500');
  });
});
