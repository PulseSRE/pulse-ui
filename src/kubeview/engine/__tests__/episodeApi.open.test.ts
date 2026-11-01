import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchOpenEpisodes } from '../episodeApi';

function answer(status: number, body: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchOpenEpisodes', () => {
  it('returns the open episodes', async () => {
    answer(200, { episodes: [{ id: 'ep-1' }] });
    expect(await fetchOpenEpisodes()).toEqual([{ id: 'ep-1' }]);
  });

  it('treats an agent without the route (404) as having none', async () => {
    answer(404);
    expect(await fetchOpenEpisodes()).toEqual([]);
  });

  it.each([401, 403, 500, 503])('throws on %i instead of reporting no open incidents', async (status) => {
    answer(status);
    await expect(fetchOpenEpisodes()).rejects.toThrow(String(status));
  });
});
