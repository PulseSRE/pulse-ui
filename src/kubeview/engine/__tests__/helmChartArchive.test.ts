import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'zlib';
import { buildChartArchive, storedChartBlocker, storedChartFromRelease, tar } from '../helmChartArchive';

const b64 = (s: string) => Buffer.from(s).toString('base64');

function headers(buf: Uint8Array) {
  const b = Buffer.from(buf);
  const out: Array<{ name: string; prefix: string; checksumOk: boolean }> = [];
  for (let o = 0; o + 512 <= b.length && b[o] !== 0;) {
    const field = (a: number, n: number) => b.subarray(o + a, o + a + n).toString().replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : b[o + i];
    out.push({ name: field(0, 100), prefix: field(345, 155), checksumOk: parseInt(field(148, 8), 8) === sum });
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

describe('chart archive from a release record', () => {
  const rel = {
    chart: {
      metadata: { apiVersion: 'v2', name: 'web', version: '1.0.0' },
      values: {},
      templates: [{ name: 'templates/deploy.yaml', data: b64('kind: Deployment\n') }],
      files: [],
      schema: b64('{"type":"object"}'),
    },
  };

  it('writes valid ustar headers, splits long paths into prefix + name, and includes the schema', async () => {
    const long = `templates/${'x'.repeat(95)}/deep.yaml`;
    const chart = storedChartFromRelease({ chart: { ...rel.chart, templates: [...rel.chart.templates, { name: long, data: b64('a: 1\n') }] } })!;
    const hs = headers(gunzipSync(Buffer.from(await buildChartArchive(chart))));
    expect(hs.every((h) => h.checksumOk)).toBe(true);
    expect(hs.map((h) => (h.prefix ? `${h.prefix}/${h.name}` : h.name))).toEqual([
      'web/Chart.yaml', 'web/values.yaml', 'web/values.schema.json', 'web/templates/deploy.yaml', `web/${long}`,
    ]);
    expect(hs[4].prefix).toBe(`web/templates/${'x'.repeat(95)}`);
  });

  it('refuses a record without a chart, a chart with dependencies, and paths that escape the chart', async () => {
    expect(storedChartFromRelease({ manifest: '' })).toBeUndefined();
    await expect(buildChartArchive(undefined)).rejects.toThrow(/does not include a readable copy of its chart/);
    const withDeps = storedChartFromRelease({ chart: { ...rel.chart, metadata: { ...rel.chart.metadata, dependencies: [{ name: 'redis' }] } } });
    expect(storedChartBlocker(withDeps)).toMatch(/depends on redis/);
    const escaping = storedChartFromRelease({ chart: { ...rel.chart, templates: [{ name: '../etc/passwd', data: b64('x') }] } });
    await expect(buildChartArchive(escaping)).rejects.toThrow(/is not relative/);
  });

  it('ends the archive with two zero blocks and pads file data to 512 bytes', () => {
    const out = tar([{ path: 'a/b', data: new Uint8Array([1, 2, 3]) }]);
    expect(out.length).toBe(512 + 512 + 1024);
    expect(out.subarray(1024).every((x) => x === 0)).toBe(true);
  });
});
