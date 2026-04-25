// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchFixHistory,
  fetchActionDetail,
  requestRollback,
} from '../fixHistory';

const mockAction = {
  id: 'a1',
  findingId: 'f1',
  timestamp: 1000,
  category: 'memory',
  tool: 'scale_deployment',
  input: { replicas: 3 },
  status: 'completed',
  beforeState: '1 replica',
  afterState: '3 replicas',
  reasoning: 'OOM risk detected',
  durationMs: 500,
  rollbackAvailable: true,
  resources: [{ kind: 'Deployment', name: 'web', namespace: 'default' }],
};

describe('fixHistory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchFixHistory', () => {
    it('fetches with no params', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              actions: [mockAction],
              total: 1,
              page: 1,
              pageSize: 20,
            }),
        }),
      );

      const result = await fetchFixHistory();
      expect((fetch as any).mock.calls[0][0]).toBe('/api/agent/fix-history');
      expect(result.actions).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('builds query string from filters', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ actions: [], total: 0, page: 2, pageSize: 20 }),
        }),
      );

      await fetchFixHistory({
        page: 2,
        filters: { category: 'memory', status: 'completed', search: 'oom' },
      });

      const url = (fetch as any).mock.calls[0][0] as string;
      expect(url).toContain('page=2');
      expect(url).toContain('category=memory');
      expect(url).toContain('status=completed');
      expect(url).toContain('search=oom');
    });

    it('includes since filter', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ actions: [], total: 0, page: 1, pageSize: 20 }),
        }),
      );

      await fetchFixHistory({ filters: { since: 1700000000 } });
      const url = (fetch as any).mock.calls[0][0] as string;
      expect(url).toContain('since=1700000000');
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        }),
      );

      await expect(fetchFixHistory()).rejects.toThrow(
        'Failed to fetch fix history: 500 Internal Server Error',
      );
    });
  });

  describe('fetchActionDetail', () => {
    it('fetches action by id', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockAction),
        }),
      );

      const result = await fetchActionDetail('a1');
      expect((fetch as any).mock.calls[0][0]).toBe('/api/agent/fix-history/a1');
      expect(result.id).toBe('a1');
    });

    it('encodes id in URL', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockAction),
        }),
      );

      await fetchActionDetail('a/b');
      expect((fetch as any).mock.calls[0][0]).toBe('/api/agent/fix-history/a%2Fb');
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      );

      await expect(fetchActionDetail('x')).rejects.toThrow(
        'Failed to fetch action detail: 404 Not Found',
      );
    });
  });

  describe('requestRollback', () => {
    it('sends POST to rollback endpoint', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true }),
      );

      await requestRollback('a1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/agent/fix-history/a1/rollback',
        { method: 'POST' },
      );
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          statusText: 'Conflict',
        }),
      );

      await expect(requestRollback('a1')).rejects.toThrow(
        'Failed to request rollback: 409 Conflict',
      );
    });
  });
});
