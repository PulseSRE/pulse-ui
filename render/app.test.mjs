// The render service's HTTP contract: who may call it, what it accepts, and
// that every render gets the caller's token. Rendering itself needs a browser
// and is exercised against a running UI (see render/README.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, tokenMatches } from './app.mjs';
import { validateRequest } from './render.mjs';

const TOKEN = 'render-secret';
const spec = { title: 'Prod', layout: [{ kind: 'chart', title: 'CPU' }] };

let server;
async function start(overrides = {}) {
  const render = vi.fn(async () => ({ image: 'cG5n', width: 1440, height: 1000, cells: [], pageErrors: [], error: '' }));
  const browser = { on: vi.fn(), close: vi.fn(async () => {}) };
  const launch = vi.fn(async () => browser);
  server = createServer({ token: TOKEN, uiUrl: 'http://ui:8080', render, launch, ...overrides });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = { Authorization: `Bearer ${TOKEN}` }) =>
    fetch(`${base}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { render, launch, post, base };
}

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  server = undefined;
});

describe('tokenMatches', () => {
  it('accepts only the exact bearer token', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches('Bearer ', '')).toBe(false); // an unset token never matches
  });
});

describe('validateRequest', () => {
  it('requires a spec with a layout and a user token', () => {
    expect(validateRequest({ spec, userToken: 't' })).toBeNull();
    expect(validateRequest({ spec: { title: 'x' }, userToken: 't' })).toMatch(/layout/);
    expect(validateRequest({ spec })).toMatch(/userToken/);
    expect(validateRequest({ spec, userToken: 'has space' })).toMatch(/userToken/);
    expect(validateRequest({ spec, userToken: 't', width: 99999 })).toMatch(/width/);
    expect(validateRequest({ spec: { title: 'x', layout: Array(61).fill({}) }, userToken: 't' })).toMatch(/too many/);
  });
});

describe('POST /render', () => {
  it('renders with the caller-supplied user token, never anything else', async () => {
    const { render, post } = await start();
    const res = await post({ spec, userToken: 'alice-token' });
    expect(res.status).toBe(200);
    expect((await res.json()).image).toBe('cG5n');
    expect(render).toHaveBeenCalledOnce();
    const opts = render.mock.calls[0][1];
    expect(opts).toMatchObject({ uiUrl: 'http://ui:8080', spec, userToken: 'alice-token' });
  });

  it('rejects callers without the service token', async () => {
    const { render, post } = await start();
    expect((await post({ spec, userToken: 't' }, {})).status).toBe(401);
    expect((await post({ spec, userToken: 't' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies before launching a browser', async () => {
    const { launch, post } = await start();
    expect((await post('not json')).status).toBe(400);
    expect((await post({ spec: {} , userToken: 't' })).status).toBe(400);
    expect(launch).not.toHaveBeenCalled();
  });

  it('turns away work beyond its concurrency limit', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const render = vi.fn(async () => {
      await gate;
      return { image: '', cells: [] };
    });
    const { post } = await start({ render, maxConcurrent: 1 });
    const first = post({ spec, userToken: 't' });
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect((await post({ spec, userToken: 't' })).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });

  it('reports a render failure without leaking its message', async () => {
    const render = vi.fn(async () => {
      throw new Error('net::ERR at http://internal-host/secret');
    });
    const { post } = await start({ render });
    const res = await post({ spec, userToken: 't' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('render failed: Error');
  });

  it('answers health checks without auth', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
