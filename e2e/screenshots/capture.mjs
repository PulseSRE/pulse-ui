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

async function mockAgent(page, { views = [] } = {}) {
  // Saved views the agent knows about; the chat adds its view once it sends view_spec.
  const saved = [...views];
  await page.route('**/api/agent/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/agent/, '');
    if (path === '/views') return route.fulfill({ json: { views: saved.map(demo.viewRow), owner: 'sre-oncall' } });
    if (/^\/views\/[^/]+\/versions$/.test(path)) return route.fulfill({ json: { versions: [] } });
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
  // Chat: answer demo.chatQuestion with demo.chatTurn, paced like a stream.
  await page.routeWebSocket(/\/api\/agent\/ws\/agent/, (ws) => {
    ws.onMessage(async (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type !== 'message') return;
      for (const event of demo.chatTurn) {
        await new Promise((r) => setTimeout(r, event.type === 'text_delta' ? 25 : 150));
        if (event.type === 'view_spec' && !saved.some((v) => v.id === event.spec.id)) saved.push(event.spec);
        ws.send(JSON.stringify(event));
      }
    });
  });
}

// Sidebar state lives in the persisted UI store (see uiStore partialize).
const sidebar = (expanded, width = 360) => ({ key: 'openshiftpulse-ui-storage', value: { state: { aiSidebarExpanded: expanded, aiSidebarWidth: width }, version: 0 } });

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
  // Story shots: the browser clock is pinned to demo.storyNow (UTC) so 14:02 reads as 14:02.
  {
    name: 'chat',
    path: '/inbox',
    clock: demo.storyNow,
    settle: 2500, // chart draw animations
    storage: sidebar(true, 600),
    wait: 'h1:has-text("Checkout since the rollout")',
    before: async (page) => {
      const input = page.getByPlaceholder('Ask Pulse anything...');
      await input.fill(demo.chatQuestion);
      await input.press('Enter');
      // done: the reply is a finished message with its skill footer.
      await page.getByText('view_designer').waitFor({ timeout: 15_000 });
    },
  },
  {
    name: 'view',
    path: `/custom/${demo.generatedView.id}`,
    clock: demo.storyNow,
    settle: 2500, // chart draw animations
    storage: sidebar(false),
    views: [demo.generatedView],
    wait: 'h1:has-text("Checkout since the rollout")',
  },
  {
    name: 'evidence',
    path: `/custom/${demo.investigationView.id}`,
    clock: demo.storyNow,
    settle: 2500, // chart draw animations
    storage: sidebar(false),
    views: [demo.investigationView],
    wait: 'h1:has-text("Investigation:")',
  },
];

// CHROMIUM_PATH lets a sandbox with a preinstalled browser skip the download.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
mkdirSync(OUT, { recursive: true });
for (const shot of shots) {
  if (process.env.ONLY && process.env.ONLY !== shot.name) continue;
  const context = await browser.newContext({
    viewport: shot.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    ...(shot.clock ? { timezoneId: 'UTC' } : {}),
  });
  await context.addInitScript((storage) => {
    try {
      localStorage.setItem('openshiftpulse-tour-completed', 'true');
      if (storage) localStorage.setItem(storage.key, JSON.stringify(storage.value));
    } catch { /* storage blocked */ }
  }, shot.storage ?? null);
  const page = await context.newPage();
  if (shot.clock) await page.clock.install({ time: shot.clock });
  await mockAgent(page, { views: shot.views });
  await page.goto(BASE + shot.path, { waitUntil: 'networkidle' });
  if (shot.before) await shot.before(page);
  try {
    await page.waitForSelector(shot.wait, { timeout: 15_000 });
  } catch {
    console.warn(`${shot.name}: "${shot.wait}" never appeared; capturing anyway`);
  }
  // Toasts announce the sample findings and would cover the content.
  await page.addStyleTag({ content: '[aria-label="Notifications"] { display: none !important; }' });
  await page.waitForTimeout(shot.settle ?? 800);
  const file = join(OUT, `${shot.name}.png`);
  if (shot.element) await shot.element(page).screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('wrote', file);
  await context.close();
}
await browser.close();
