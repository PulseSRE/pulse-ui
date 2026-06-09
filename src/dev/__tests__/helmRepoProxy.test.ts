import { describe, expect, it, vi } from 'vitest';
import { resolveAndValidateHelmRepoUrl } from '../helmRepoProxy';

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

  it('accepts public resolved addresses and appends index.yaml', async () => {
    const result = await resolveAndValidateHelmRepoUrl('https://charts.example.com', {
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    });

    expect(result.url.toString()).toBe('https://charts.example.com/index.yaml');
    expect(result.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(resolveAndValidateHelmRepoUrl('https://user:pass@charts.example.com', {
      lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    })).rejects.toThrow(/credentials/);
  });
});
