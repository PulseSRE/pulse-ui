/**
 * Visual regression tests — snapshot key UI states to catch CSS/layout regressions.
 *
 * Uses Playwright's toHaveScreenshot() for pixel-level comparison against baselines.
 * Baselines are auto-generated on first run and stored in tests/visual-regression.spec.ts-snapshots/.
 * Update baselines: npx playwright test visual-regression --update-snapshots
 *
 * These tests create views via the REST API, navigate to them, and snapshot
 * the rendered output.  The mock agent server provides deterministic data.
 */

import { test, expect, type Page } from 'playwright/test';

const BASE_URL = process.env.PULSE_URL || 'http://localhost:9000';
const AGENT_BASE = `${BASE_URL}/api/agent`;
const AGENT_TOKEN = process.env.E2E_AGENT_TOKEN || 'e2e-test-token';

function withToken(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${AGENT_TOKEN}`;
}

// Views are created through the dev-server proxy with no identity override.
// These calls used to add X-Forwarded-User: e2e-test-user, which made that
// user the owner, while the app reads views as the identity the proxy derives
// from X-Forwarded-Access-Token. The owners never matched, so every view test
// loaded "View not found" and the baselines captured that error page.
async function createView(page: Page, title: string, layout: any[]) {
  const resp = await page.request.post(withToken(`${AGENT_BASE}/views`), {
    data: { title, layout, description: 'Visual regression test view' },
  });
  const body = await resp.json();
  return (body.view_id || body.id) as string;
}

async function deleteView(page: Page, viewId: string) {
  await page.request.delete(withToken(`${AGENT_BASE}/views/${viewId}`));
}

/** Fail before the screenshot if the view did not load, so an error page can never become a baseline. */
async function expectViewLoaded(page: Page, title: string) {
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('View not found')).toHaveCount(0);
}

test.describe('Visual Regression', () => {
  test.describe.configure({ mode: 'serial' });

  let viewId: string;

  test.afterEach(async ({ page }) => {
    if (viewId) {
      await deleteView(page, viewId);
      viewId = '';
    }
  });

  test('dashboard with mixed widget types', async ({ page }) => {
    viewId = await createView(page, 'Visual Test — Mixed Widgets', [
      {
        kind: 'info_card_grid',
        cards: [
          { label: 'Pods', value: '12', sub: 'running' },
          { label: 'Alerts', value: '2', sub: 'firing', severity: 'warning' },
          { label: 'Nodes', value: '3', sub: 'ready' },
          { label: 'CPU', value: '47%', sub: 'cluster avg' },
        ],
      },
      {
        kind: 'data_table',
        title: 'Pod Status',
        columns: [
          { id: 'name', header: 'Name' },
          { id: 'namespace', header: 'Namespace' },
          { id: 'status', header: 'Status' },
          { id: 'restarts', header: 'Restarts', type: 'number' },
        ],
        rows: [
          { name: 'api-server-abc', namespace: 'production', status: 'Running', restarts: 0 },
          { name: 'worker-def', namespace: 'production', status: 'Running', restarts: 2 },
          { name: 'cache-ghi', namespace: 'staging', status: 'CrashLoopBackOff', restarts: 47 },
          { name: 'db-jkl', namespace: 'production', status: 'Running', restarts: 0 },
        ],
      },
      {
        kind: 'status_list',
        title: 'Node Health',
        items: [
          { name: 'worker-1', status: 'ready', detail: '4 CPU, 16Gi' },
          { name: 'worker-2', status: 'ready', detail: '8 CPU, 32Gi' },
          { name: 'worker-3', status: 'pressure', detail: 'MemoryPressure' },
        ],
      },
    ]);

    await page.goto(`${BASE_URL}/custom/${viewId}`, { waitUntil: 'domcontentloaded' });
    await expectViewLoaded(page, 'Visual Test — Mixed Widgets');
    await page.waitForTimeout(3000);

    await expect(page).toHaveScreenshot('dashboard-mixed-widgets.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('empty state — no views', async ({ page }) => {
    await page.goto(`${BASE_URL}/views`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await expect(page).toHaveScreenshot('views-empty-state.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('data table with sort indicator', async ({ page }) => {
    viewId = await createView(page, 'Visual Test — Sorted Table', [
      {
        kind: 'data_table',
        title: 'Pods by Restarts',
        columns: [
          { id: 'name', header: 'Name' },
          { id: 'restarts', header: 'Restarts', type: 'number' },
          { id: 'status', header: 'Status' },
        ],
        rows: [
          { name: 'flaky-pod', restarts: 142, status: 'CrashLoopBackOff' },
          { name: 'stable-pod', restarts: 0, status: 'Running' },
          { name: 'recovering', restarts: 3, status: 'Running' },
        ],
        _sort: { column: 'restarts', direction: 'desc' },
      },
    ]);

    await page.goto(`${BASE_URL}/custom/${viewId}`, { waitUntil: 'domcontentloaded' });
    await expectViewLoaded(page, 'Visual Test — Sorted Table');
    await page.waitForTimeout(3000);

    await expect(page).toHaveScreenshot('table-sorted-by-restarts.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('info cards with severity colors', async ({ page }) => {
    viewId = await createView(page, 'Visual Test — Severity Cards', [
      {
        kind: 'info_card_grid',
        cards: [
          { label: 'Critical', value: '3', sub: 'incidents', severity: 'critical' },
          { label: 'Warning', value: '7', sub: 'alerts', severity: 'warning' },
          { label: 'Info', value: '12', sub: 'events', severity: 'info' },
          { label: 'Healthy', value: '98%', sub: 'availability' },
        ],
      },
    ]);

    await page.goto(`${BASE_URL}/custom/${viewId}`, { waitUntil: 'domcontentloaded' });
    await expectViewLoaded(page, 'Visual Test — Severity Cards');
    await page.waitForTimeout(3000);

    await expect(page).toHaveScreenshot('info-cards-severity.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
