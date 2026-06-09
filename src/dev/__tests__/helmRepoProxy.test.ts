import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { fetchHelmRepoIndex, resolveAndValidateHelmRepoUrl } from '../helmRepoProxy';

function makeResponse(statusCode: number, headers: IncomingMessage['headers'] = {}, body = ''): IncomingMessage {
  const stream = new PassThrough() as IncomingMessage;
  stream.statusCode = statusCode;
  stream.headers = headers;
  setImmediate(() => stream.end(body));
  return stream;
}

describe('resolveAndValidateHelmRepoUrl', () => {
  it('rejects hostnames that resolve to loopback addresses', async () => {
    await expect(resolveAndValidateHelmRepoUrl('https://metadata.example/index.yaml', {
      lookup: vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]),
    })).rejects.toThrow(/Internal\/private/);
  });

  it('rejects hostnames that resolve to cloud metadata addresses', async () => {
    await expect(resolveAndValidateHelmRepoUrl('https://repo.example/index.yaml', {
      lookup: vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }]),
    })).rejects.toThrow(/Internal\/private/);
  });

  it('rejects private IPv6 literals', async () => {
    await expect(resolveAndValidateHelmRepoUrl('https://[::1]/index.yaml')).rejects.toThrow(/Internal\/private/);
  });

  it('rejects reserved IPv4 and IPv6 ranges', async () => {
    const blockedAddresses = [
      { address: '192.0.2.10', family: 4 as const },
      { address: '198.51.100.10', family: 4 as const },
      { address: '203.0.113.10', family: 4 as const },
      { address: 'fe90::1', family: 6 as const },
      { address: '2001:db8::1', family: 6 as const },
      { address: 'ff02::1', family: 6 as const },
    ];

    for (const resolvedAddress of blockedAddresses) {
      await expect(resolveAndValidateHelmRepoUrl('https://repo.example/index.yaml', {
        lookup: vi.fn().mockResolvedValue([resolvedAddress]),
      })).rejects.toThrow(/Internal\/private/);
    }
  });

  it('accepts public resolved addresses and appends index.yaml', async () => {
    const result = await resolveAndValidateHelmRepoUrl('https://charts.example.com', {
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    });

    expect(result.url.toString()).toBe('https://charts.example.com/index.yaml');
    expect(result.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('accepts public IPv6 literals', async () => {
    const result = await resolveAndValidateHelmRepoUrl('https://[2606:2800:220:1:248:1893:25c8:1946]');

    expect(result.url.toString()).toBe('https://[2606:2800:220:1:248:1893:25c8:1946]/index.yaml');
    expect(result.addresses).toEqual([{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]);
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(resolveAndValidateHelmRepoUrl('https://user:pass@charts.example.com', {
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    })).rejects.toThrow(/credentials/);
  });
});

describe('fetchHelmRepoIndex', () => {
  it('revalidates redirect destinations before following them', async () => {
    const request = vi.fn().mockResolvedValue(makeResponse(302, { location: 'http://metadata.example' }));
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === 'metadata.example') return [{ address: '127.0.0.1', family: 4 as const }];
      return [{ address: '93.184.216.34', family: 4 as const }];
    });

    await expect(fetchHelmRepoIndex('http://charts.example', { lookup, request })).rejects.toThrow(/Internal\/private/);
    expect(request).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('metadata.example');
  });

  it('enforces redirect limits', async () => {
    const request = vi.fn().mockResolvedValue(makeResponse(302, { location: 'http://charts.example/next' }));
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(fetchHelmRepoIndex('http://charts.example', {
      lookup,
      request,
      maxRedirects: 1,
    })).rejects.toThrow(/Too many redirects/);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized chart index responses', async () => {
    const request = vi.fn().mockResolvedValue(makeResponse(200, {}, 'abcdef'));
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(fetchHelmRepoIndex('http://charts.example', {
      lookup,
      request,
      maxBytes: 3,
    })).rejects.toThrow(/too large/);
  });

  it('does not configure wildcard CORS for the dev helm repo proxy', () => {
    const rspackConfig = readFileSync(new URL('../../../rspack.config.ts', import.meta.url), 'utf8');
    expect(rspackConfig).not.toContain('Access-Control-Allow-Origin');
  });
});
