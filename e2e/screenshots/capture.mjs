/**
 * Capture README / GitHub Pages screenshots.
 *
 *   node e2e/mock-k8s-server.mjs &    # K8s API on :8001
 *   pnpm dev &                        # UI on :9000
 *   node e2e/screenshots/capture.mjs  # writes docs/screenshots/*.png
 *
 * The agent is not needed: /api/agent/** and the monitor WebSocket are answered
 * from demo-data.mjs, so the shots show sample data. Pass ONLY=name to capture
 * one shot, OUT=dir to write elsewhere.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import * as demo from './demo-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PULSE_URL || 'http://localhost:9000';
const OUT = process.env.OUT || join(here, '..', '..', 'docs', 'screenshots');

const agentRoutes = {
  '/inbox': demo.inbox,
  '/inbox/stats': demo.inbox.stats,
  '/episodes': { episodes: [demo.episode] },
  [`/episodes/${demo.episode.id}`]: demo.episodeDetail,
  '/monitor/coverage': demo.coverage,
  '/version': { version: '2.33.0', protocol: '2', scanners: demo.coverage.total_scanners },
  '/healthz': { status: 'ok' },
  '/health': { status: 'ok', circuit_breaker: 'closed', errors: { total: 0 } },
  '/monitor/capabilities': { max_trust_level: 2, categories: ['crashloop', 'workloads'] },
};

async function mockAgent(page) {
  await page.route('**/api/agent/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/agent/, '');
    const body = agentRoutes[path];
    if (body === undefined) return route.fulfill({ status: 404, json: { detail: 'not in demo data' } });
    return route.fulfill({ json: body });
  });
  await page.routeWebSocket(/\/api\/agent\/ws\/monitor/, (ws) => {
    ws.onMessage((raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type !== 'subscribe_monitor') return;
      for (const f of demo.findings) ws.send(JSON.stringify({ type: 'finding', ...f }));
      ws.send(JSON.stringify({
        type: 'findings_snapshot',
        activeIds: demo.findings.map((f) => f.id),
        timestamp: Date.now(),
      }));
    });
  });
}

const shots = [
  { name: 'inbox', path: '/inbox', wait: 'text=To fix:' },
  {
    name: 'scanners',
    path: '/agent',
    viewport: { width: 1440, height: 720 },
    wait: 'text=Scanner Coverage',
    before: async (page) => {
      await page.getByText(/scanners?/i).first().click();
    },
    // The drawer only: the page behind it is dimmed and says nothing useful.
    element: (page) => page.getByRole('dialog', { name: 'Scanner Coverage' }).locator('div.max-w-2xl'),
  },
];

// CHROMIUM_PATH lets a sandbox with a preinstalled browser skip the download.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
mkdirSync(OUT, { recursive: true });
for (const shot of shots) {
  if (process.env.ONLY && process.env.ONLY !== shot.name) continue;
  const context = await browser.newContext({ viewport: shot.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await context.addInitScript(() => {
    try { localStorage.setItem('openshiftpulse-tour-completed', 'true'); } catch { /* storage blocked */ }
  });
  const page = await context.newPage();
  await mockAgent(page);
  await page.goto(BASE + shot.path, { waitUntil: 'networkidle' });
  if (shot.before) await shot.before(page);
  try {
    await page.waitForSelector(shot.wait, { timeout: 15_000 });
  } catch {
    console.warn(`${shot.name}: "${shot.wait}" never appeared; capturing anyway`);
  }
  // Toasts announce the sample findings and would cover the content.
  await page.addStyleTag({ content: '[aria-label="Notifications"] { display: none !important; }' });
  await page.waitForTimeout(800);
  const file = join(OUT, `${shot.name}.png`);
  if (shot.element) await shot.element(page).screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('wrote', file);
  await context.close();
}
await browser.close();
