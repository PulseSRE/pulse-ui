/**
 * HTTP side of the Pulse render service (auth, limits, routing). The renderer
 * and browser are injected, so this module needs no browser to test.
 *
 * Pulse render service: screenshots a draft dashboard so the agent can see
 * what it is about to save.
 *
 *   POST /render  Authorization: Bearer $RENDER_TOKEN
 *     { "spec": {title, description?, layout, positions?}, "userToken": "...", "width"?, "height"? }
 *   -> { image: <base64 png>, width, height, cells: [...], pageErrors: [...], error, truncated }
 *   GET /healthz
 *
 * The page is the real UI (UI_URL, the UI pod's nginx) at /preview, loaded
 * with the requesting user's token on every request, so widget data comes
 * back with that user's permissions and nobody else's. The service holds no
 * credentials of its own beyond RENDER_TOKEN, which only the agent has.
 *
 * Env: RENDER_TOKEN (required), UI_URL (default http://127.0.0.1:8080),
 * PORT (8090), MAX_CONCURRENT (2), RENDER_TIMEOUT_MS (30000),
 * CHROMIUM_PATH (default: Playwright's own).
 */

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { validateRequest } from './render.mjs';

const MAX_BODY = 2 * 1024 * 1024;

export function tokenMatches(header, expected) {
  if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function createServer({ token, uiUrl, maxConcurrent = 2, timeoutMs = 30000, launch, render }) {
  let browserPromise = null;
  let active = 0;

  async function browser() {
    if (!browserPromise) {
      browserPromise = launch().then((b) => {
        // Relaunch on the next request if Chromium dies.
        b.on('disconnected', () => {
          browserPromise = null;
        });
        return b;
      });
      browserPromise.catch(() => {
        browserPromise = null;
      });
    }
    return browserPromise;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/render') return send(res, 404, { error: 'not found' });
    if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: 'unauthorized' });
    if (active >= maxConcurrent) return send(res, 429, { error: 'busy, retry shortly' });

    active += 1;
    try {
      const body = await readBody(req);
      const invalid = validateRequest(body);
      if (invalid) return send(res, 400, { error: invalid });
      const result = await render(await browser(), {
        uiUrl,
        spec: body.spec,
        userToken: body.userToken,
        width: body.width,
        height: body.height,
        timeoutMs,
      });
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.status || 500, { error: e.status ? e.message : `render failed: ${e.name || 'Error'}` });
    } finally {
      active -= 1;
    }
  });
  server.closeBrowser = async () => {
    if (browserPromise) (await browserPromise).close().catch(() => {});
  };
  return server;
}

