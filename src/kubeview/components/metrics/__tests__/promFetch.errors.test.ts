/**
 * A failed Prometheus read must come back as a typed error with a sentence a
 * user can act on — never as a raw `Unexpected token '<'` parser message and
 * never as an empty result. An empty result is reserved for a query that
 * succeeded and matched nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promFetch, queryRange, queryInstant, getMetricNames, PrometheusReadError, PROM_TIMEOUT_MS } from '../prometheus';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function html(status: number) {
  return new Response('<!DOCTYPE html><html><body>Bad Gateway</body></html>', {
    status,
    statusText: status === 200 ? 'OK' : 'Bad Gateway',
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function failure(p: Promise<unknown>): Promise<PrometheusReadError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PrometheusReadError);
    return e as PrometheusReadError;
  }
  throw new Error('expected the read to fail');
}

beforeEach(() => { mockFetch.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('Prometheus reads that fail', () => {
  it('an HTML 502 (proxy error page) says so, with the status', async () => {
    mockFetch.mockResolvedValueOnce(html(502));
    const e = await failure(queryRange('up', 0, 100));
    expect(e.kind).toBe('html');
    expect(e.status).toBe(502);
    expect(e.message).toBe('Prometheus returned an HTML page (status 502) — the metrics backend may be down or behind a login');
    expect(e.message).not.toMatch(/Unexpected token/);
  });

  it('an HTML page served with 200 (a login page) is an error, not data', async () => {
    mockFetch.mockResolvedValueOnce(html(200));
    const e = await failure(queryInstant('up'));
    expect(e.kind).toBe('html');
    expect(e.message).toMatch(/HTML page \(status 200\)/);
  });

  it('a body that fails to parse as JSON with no content type still reads as an HTML page', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>login</html>', { status: 200 }));
    const e = await failure(getMetricNames());
    expect(e.kind).toBe('html');
    expect(e.message).not.toMatch(/Unexpected token|not valid JSON/);
  });

  it('a 403 is "forbidden", not an empty chart', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'error', error: 'forbidden' }, 403));
    const e = await failure(queryRange('up', 0, 100));
    expect(e.kind).toBe('forbidden');
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/403 forbidden/);
  });

  it('a gateway timeout (504) is "timed out"', async () => {
    mockFetch.mockResolvedValueOnce(json({}, 504));
    const e = await failure(queryRange('up', 0, 100));
    expect(e.kind).toBe('timeout');
    expect(e.message).toMatch(/timed out/);
  });

  it('no answer at all within the timeout is "timed out"', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const pending = failure(queryRange('up', 0, 100));
    await vi.advanceTimersByTimeAsync(PROM_TIMEOUT_MS + 1);
    const e = await pending;
    expect(e.kind).toBe('timeout');
    expect(e.message).toBe(`Prometheus did not answer within ${PROM_TIMEOUT_MS / 1000}s (timed out)`);
  });

  it('a network failure says Prometheus could not be reached and keeps the raw text as detail', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const e = await failure(queryRange('up', 0, 100));
    expect(e.kind).toBe('unreachable');
    expect(e.detail).toBe('Failed to fetch');
  });

  it('a caller cancelling the read passes the abort through untouched', async () => {
    const outer = new AbortController();
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const p = promFetch('/api/v1/rules', undefined, { signal: outer.signal });
    outer.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a query Prometheus rejects (400) keeps its own reason', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'error', errorType: 'bad_data', error: 'parse error at char 3' }, 400));
    const e = await failure(queryRange('up{', 0, 100));
    expect(e.kind).toBe('query');
    expect(e.message).toBe('Prometheus error: parse error at char 3');
  });

  it('a 5xx with a JSON body keeps Prometheus\'s reason next to the status', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'error', errorType: 'internal', error: 'query processing would load too many samples' }, 500));
    const e = await failure(queryRange('up', 0, 100));
    expect(e.kind).toBe('http');
    expect(e.message).toMatch(/^Prometheus query failed: 500/);
    expect(e.message).toContain('query processing would load too many samples');
  });

  it('errorType "timeout" is a timeout, whatever the status', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'error', errorType: 'timeout', error: 'query timed out in expression evaluation' }, 503));
    const e = await failure(queryRange('up', 0, 100));
    expect(e.kind).toBe('timeout');
    expect(e.message).toContain('query timed out in expression evaluation');
  });

  it('a 403 keeps the server text as detail', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'error', error: 'user "dev" cannot get prometheus' }, 403));
    const e = await failure(queryInstant('up'));
    expect(e.kind).toBe('forbidden');
    expect(e.detail).toBe('user "dev" cannot get prometheus');
  });

  it('the timeout also covers reading the body', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      // Headers arrive at once; the body never finishes until aborted.
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    } as unknown as Response));
    const pending = failure(queryRange('up', 0, 100));
    await vi.advanceTimersByTimeAsync(PROM_TIMEOUT_MS + 1);
    expect((await pending).kind).toBe('timeout');
  });

  it('passes a caller signal through queryRange and queryInstant', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(json({ status: 'success', data: { result: [] } })));
    const outer = new AbortController();
    await queryRange('up', 0, 100, undefined, undefined, outer.signal);
    await queryInstant('up', undefined, undefined, outer.signal);
    for (const [, init] of mockFetch.mock.calls) {
      const inner = (init as RequestInit).signal!;
      expect(inner.aborted).toBe(false);
    }
    // Aborting the caller's signal aborts an in-flight read.
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const p = queryRange('up', 0, 100, undefined, undefined, outer.signal);
    outer.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('a Prometheus read that succeeds', () => {
  it('with no series is an empty result, not an error', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'success', data: { resultType: 'matrix', result: [] } }));
    await expect(queryRange('up', 0, 100)).resolves.toEqual([]);
  });

  it('with data returns it', async () => {
    mockFetch.mockResolvedValueOnce(json({ status: 'success', data: { resultType: 'vector', result: [{ metric: { a: 'b' }, value: [1, '3'] }] } }));
    await expect(queryInstant('up')).resolves.toEqual([{ metric: { a: 'b' }, value: 3 }]);
  });
});
