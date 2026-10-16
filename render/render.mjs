/**
 * Render a draft dashboard in the real UI and return a screenshot plus per-widget checks.
 *
 * Kept free of HTTP concerns so it can be tested and reused by the server.
 */

// Function sources, invoked in the page as `(src)()`: a bare string passed to
// page.evaluate is evaluated as an expression and would return the function uncalled.
// Probe each grid cell: its title, text, and whether content is cut off
// without a scrollbar to reach it. The same checks the render eval runs.
const CELL_PROBE = `() => [...document.querySelectorAll('.react-grid-item')].map((cell) => {
  const heading = (cell.querySelector('h1,h2,h3,h4,[class*="title"]')?.textContent || '').trim();
  const title = (heading || (cell.innerText || '').trim().split('\\n')[0] || '').slice(0, 80);
  const scrollers = [cell, ...cell.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
  });
  const clipped = [...cell.querySelectorAll('*')].some((el) => {
    const r = el.getBoundingClientRect(), c = cell.getBoundingClientRect();
    return r.height > 0 && r.bottom > c.bottom + 4 && getComputedStyle(el).visibility !== 'hidden';
  });
  return { title, text: cell.innerText.slice(0, 600), scrolls: scrollers.length > 0, clipped };
})`;

// The view scrolls inside its own container; report how tall its content is.
const MEASURE_VIEW = `() => {
  const grid = document.querySelector('.react-grid-layout');
  if (!grid) return null;
  let el = grid.parentElement;
  while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
  el = el || grid;
  el.setAttribute('data-render-view', '');
  return { top: el.getBoundingClientRect().top, height: el.scrollHeight };
}`;

const NOISE = /WebSocket|Failed to fetch|discover/;
export const MAX_HEIGHT = 6000;

/**
 * @param {import('playwright-core').Browser} browser
 * @param {{ uiUrl: string, spec: object, userToken: string, width?: number, height?: number, settleMs?: number, timeoutMs?: number }} opts
 */
export async function renderDashboard(browser, opts) {
  const { uiUrl, spec, userToken, width = 1440, height = 1000, settleMs = 2500, timeoutMs = 30000 } = opts;
  // A fresh context per request: nothing a previous user loaded is visible to the next.
  const context = await browser.newContext({
    viewport: { width, height },
    extraHTTPHeaders: { 'X-Forwarded-Access-Token': userToken },
  });
  const pageErrors = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 300)));
    await page.addInitScript((draft) => {
      window.__PULSE_PREVIEW__ = draft;
    }, spec);
    await page.goto(`${uiUrl.replace(/\/$/, '')}/preview`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    let error = '';
    try {
      await page.waitForSelector('.react-grid-item', { timeout: timeoutMs });
    } catch {
      error = (await page.locator('[data-preview-status="missing"]').count()) ? 'preview spec rejected' : 'no widgets rendered';
    }
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 15000) });
    } catch {
      // Live widgets poll; settle on the fixed wait instead.
    }
    // Widgets mount, fetch, then draw; an error boundary swaps in a beat later.
    await page.waitForTimeout(settleMs);

    const box = await page.evaluate(`(${MEASURE_VIEW})()`);
    let fullHeight = height;
    if (box) {
      fullHeight = Math.min(Math.ceil(box.top + box.height) + 24, MAX_HEIGHT);
      if (fullHeight > height) {
        await page.setViewportSize({ width, height: fullHeight });
        await page.waitForTimeout(1200);
      }
    }
    const cells = await page.evaluate(`(${CELL_PROBE})()`);
    const target = page.locator('[data-render-view]');
    const image = box && (await target.count()) ? await target.screenshot({ type: 'png' }) : await page.screenshot({ type: 'png' });
    return {
      image: image.toString('base64'),
      width,
      height: fullHeight,
      cells,
      pageErrors: pageErrors.filter((m) => !NOISE.test(m)),
      error,
      truncated: Boolean(box && box.top + box.height + 24 > MAX_HEIGHT),
    };
  } finally {
    await context.close();
  }
}

/** Validate a POST /render body. Returns an error string, or null. */
export function validateRequest(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const { spec, userToken, width, height } = body;
  if (!spec || typeof spec !== 'object' || typeof spec.title !== 'string' || !Array.isArray(spec.layout)) {
    return 'spec must have a title and a layout array';
  }
  if (spec.layout.length > 60) return 'spec has too many widgets';
  if (typeof userToken !== 'string' || userToken.length === 0 || userToken.length > 8192 || /\s/.test(userToken)) {
    return 'userToken is required';
  }
  for (const [name, v, lo, hi] of [['width', width, 640, 2560], ['height', height, 400, 2000]]) {
    if (v !== undefined && (!Number.isInteger(v) || v < lo || v > hi)) return `${name} must be an integer in ${lo}-${hi}`;
  }
  return null;
}
