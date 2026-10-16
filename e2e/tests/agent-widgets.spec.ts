/**
 * Every component kind the agent can emit must render.
 *
 * Unit tests cover renderers one at a time with hand-written props; this
 * test saves views through the real agent API in the shape the agent
 * produces and loads them in the app. It exists because node_map built from
 * the agent's own registry example crashed into the widget error boundary,
 * and nothing noticed: no test rendered agent-shaped specs end to end.
 */

import { test, expect, type Page } from 'playwright/test';
import { AGENT_WIDGET_PAGES } from '../fixtures/agent-widgets';

const BASE_URL = process.env.PULSE_URL || 'http://localhost:9000';
const AGENT_BASE = `${BASE_URL}/api/agent`;
const AGENT_TOKEN = process.env.E2E_AGENT_TOKEN || 'e2e-test-token';

function withToken(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${AGENT_TOKEN}`;
}

// Created through the dev-server proxy with no identity override, so the
// view's owner is the same identity the app reads it back with.
async function createView(page: Page, title: string, layout: unknown[]): Promise<string> {
  const resp = await page.request.post(withToken(`${AGENT_BASE}/views`), {
    data: { title, layout, description: 'Agent widget render test' },
  });
  expect(resp.ok(), `create view: ${resp.status()} ${await resp.text()}`).toBeTruthy();
  const body = await resp.json();
  return (body.view_id || body.id) as string;
}

test.describe('Agent widgets render', () => {
  test.describe.configure({ mode: 'serial' });

  const created: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of created) {
      await request.delete(withToken(`${AGENT_BASE}/views/${id}`));
    }
  });

  for (const widgetPage of AGENT_WIDGET_PAGES) {
    test(widgetPage.title, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      const viewId = await createView(page, widgetPage.title, widgetPage.layout);
      created.push(viewId);

      await page.goto(`${BASE_URL}/custom/${viewId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(widgetPage.title).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('View not found')).toHaveCount(0);

      // One grid cell per top-level widget.
      await expect(page.locator('.react-grid-item')).toHaveCount(widgetPage.layout.length);

      // No widget fell into the error boundary. Grid cells mount before their
      // contents, and a crashing widget swaps in its fallback a beat later, so
      // a retrying toHaveCount(0) would pass on the empty first frame. Let the
      // page settle, then count once.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      const failed = await page.getByText(/failed to render/i).allInnerTexts();
      expect(failed, failed.join('\n')).toEqual([]);

      // Renderer exceptions that an error boundary swallowed still surface here.
      const renderErrors = pageErrors.filter((m) => !/WebSocket|Failed to fetch|discover/i.test(m));
      expect(renderErrors, renderErrors.join('\n')).toEqual([]);
    });
  }
});
