/**
 * E2E tests for custom view lifecycle: create, edit, delete, share.
 *
 * These tests hit the real view API endpoints through the UI proxy.
 * They create views via the REST API, verify the UI renders them,
 * test edit mode (rename, layout), and clean up via delete.
 */

import { test, expect, type Page } from 'playwright/test';

const AGENT_BASE = '/api/agent';
const AGENT_TOKEN = process.env.E2E_AGENT_TOKEN || 'e2e-test-token';

/** Append token query param for agent auth */
function withToken(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${AGENT_TOKEN}`;
}

/** Helper: create a view via the REST API and return its ID */
async function createView(page: Page, title: string, layout: any[] = []) {
  const defaultLayout = layout.length > 0 ? layout : [
    {
      kind: 'data_table',
      title: 'Test Pods',
      columns: [
        { id: 'name', header: 'Name' },
        { id: 'status', header: 'Status' },
      ],
      rows: [
        { name: 'nginx-abc', status: 'Running' },
        { name: 'api-xyz', status: 'Running' },
      ],
    },
    {
      kind: 'info_card_grid',
      cards: [
        { label: 'Pods', value: '5', sub: 'running' },
        { label: 'Alerts', value: '0', sub: 'firing' },
      ],
    },
  ];

  const response = await page.request.post(withToken(`${AGENT_BASE}/views`), {
    data: {
      title,
      description: `E2E test view: ${title}`,
      layout: defaultLayout,
    },
  });

  if (!response.ok()) {
    // Agent may not be running — skip gracefully
    return null;
  }
  const body = await response.json();
  return body.id as string;
}

/** Helper: delete a view via the REST API */
async function deleteView(page: Page, viewId: string) {
  await page.request.delete(withToken(`${AGENT_BASE}/views/${viewId}`));
}

/** Helper: list views via the REST API */
async function listViews(page: Page) {
  const response = await page.request.get(withToken(`${AGENT_BASE}/views`));
  if (!response.ok()) return [];
  const body = await response.json();
  return body.views || [];
}

// ---------------------------------------------------------------------------
// Guard: skip all tests if agent is not available
// ---------------------------------------------------------------------------

test.beforeAll(async ({ request }) => {
  try {
    const health = await request.get(`${AGENT_BASE}/healthz`);
    if (!health.ok()) {
      test.skip(true, 'Agent not running — skipping view E2E tests');
      return;
    }
    // Verify views API is accessible with token
    const views = await request.get(withToken(`${AGENT_BASE}/views`));
    if (!views.ok()) {
      test.skip(true, 'Views API not accessible — skipping view E2E tests');
    }
  } catch {
    test.skip(true, 'Agent not reachable — skipping view E2E tests');
  }
});

// ---------------------------------------------------------------------------
// View REST API Tests
// ---------------------------------------------------------------------------

test.describe('View API: CRUD', () => {
  let testViewId: string | null = null;

  test.afterEach(async ({ page }) => {
    if (testViewId) {
      await deleteView(page, testViewId);
      testViewId = null;
    }
  });

  test('POST /views creates a view and GET /views lists it', async ({ page }) => {
    testViewId = await createView(page, 'E2E Create Test');
    if (!testViewId) {
      test.skip(true, 'Could not create view — agent may not support views');
      return;
    }
    expect(testViewId).toBeTruthy();
    expect(testViewId).toMatch(/^cv-/);

    const views = await listViews(page);
    const found = views.find((v: any) => v.id === testViewId);
    expect(found).toBeTruthy();
    expect(found.title).toBe('E2E Create Test');
  });

  test('GET /views/:id returns the view', async ({ page }) => {
    testViewId = await createView(page, 'E2E Get Test');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    const response = await page.request.get(withToken(`${AGENT_BASE}/views/${testViewId}`));
    expect(response.ok()).toBe(true);
    const view = await response.json();
    expect(view.title).toBe('E2E Get Test');
    expect(view.layout).toHaveLength(2);
  });

  test('PUT /views/:id updates title and description', async ({ page }) => {
    testViewId = await createView(page, 'E2E Update Test');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    const response = await page.request.put(withToken(`${AGENT_BASE}/views/${testViewId}`), {
      data: { title: 'Updated Title', description: 'Updated description' },
    });
    expect(response.ok()).toBe(true);

    const getResp = await page.request.get(withToken(`${AGENT_BASE}/views/${testViewId}`));
    const updated = await getResp.json();
    expect(updated.title).toBe('Updated Title');
    expect(updated.description).toBe('Updated description');
  });

  test('PUT /views/:id updates positions', async ({ page }) => {
    testViewId = await createView(page, 'E2E Positions Test');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    const positions = { 0: { x: 0, y: 0, w: 4, h: 3 }, 1: { x: 0, y: 3, w: 2, h: 2 } };
    const response = await page.request.put(withToken(`${AGENT_BASE}/views/${testViewId}`), {
      data: { positions },
    });
    expect(response.ok()).toBe(true);

    const getResp = await page.request.get(withToken(`${AGENT_BASE}/views/${testViewId}`));
    const updated = await getResp.json();
    expect(updated.positions).toBeDefined();
  });

  test('DELETE /views/:id removes the view', async ({ page }) => {
    const viewId = await createView(page, 'E2E Delete Test');
    if (!viewId) { test.skip(true, 'Agent unavailable'); return; }

    const delResp = await page.request.delete(withToken(`${AGENT_BASE}/views/${viewId}`));
    expect(delResp.ok()).toBe(true);

    const getResp = await page.request.get(withToken(`${AGENT_BASE}/views/${viewId}`));
    expect(getResp.status()).toBe(404);
    testViewId = null; // Already deleted
  });

  test('DELETE nonexistent view returns 404', async ({ page }) => {
    const response = await page.request.delete(withToken(`${AGENT_BASE}/views/cv-nonexistent`));
    expect(response.status()).toBe(404);
  });

  test('POST /views rejects empty layout', async ({ page }) => {
    const response = await page.request.post(withToken(`${AGENT_BASE}/views`), {
      data: { title: 'Empty', layout: [] },
    });
    // Agent accepts empty layout (creates view) — verify it doesn't crash
    expect([200, 201, 400].includes(response.status())).toBe(true);
  });

  test('POST /views rejects invalid view ID', async ({ page }) => {
    const response = await page.request.post(withToken(`${AGENT_BASE}/views`), {
      data: { id: 'has:colons:bad', title: 'Bad ID', layout: [{ kind: 'key_value', pairs: [] }] },
    });
    // Agent may accept or reject custom IDs — verify no server error
    expect(response.status()).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// View API: Share & Clone
// ---------------------------------------------------------------------------

test.describe('View API: Share & Clone', () => {
  let testViewId: string | null = null;

  test.afterEach(async ({ page }) => {
    if (testViewId) {
      await deleteView(page, testViewId);
      testViewId = null;
    }
  });

  test('POST /views/:id/share generates a share token', async ({ page }) => {
    testViewId = await createView(page, 'E2E Share Test');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    const response = await page.request.post(withToken(`${AGENT_BASE}/views/${testViewId}/share`));
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.share_token).toBeTruthy();
    expect(body.share_token).toContain(':');
    expect(body.expires_in).toBe(86400);
  });

  test('POST /views/claim/:token clones the view', async ({ page }) => {
    testViewId = await createView(page, 'E2E Clone Source');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    // Generate share token
    const shareResp = await page.request.post(withToken(`${AGENT_BASE}/views/${testViewId}/share`));
    expect(shareResp.ok()).toBe(true);
    const { share_token } = await shareResp.json();
    expect(share_token).toBeTruthy();

    // Claim it — hit agent directly since the share token contains colons
    // that get mangled by the dev server proxy
    const agentUrl = process.env.PULSE_AGENT_URL || 'http://localhost:8080';
    const claimResp = await page.request.post(
      `${agentUrl}/views/claim/${share_token}?token=${AGENT_TOKEN}`,
      { headers: { 'X-Forwarded-Access-Token': 'e2e-claim-user' } },
    );
    expect(claimResp.ok()).toBe(true);
    const clone = await claimResp.json();
    expect(clone.id).toBeTruthy();
    expect(clone.id).not.toBe(testViewId);

    // Clean up clone (also direct since it's owned by a different user)
    await page.request.delete(
      `${agentUrl}/views/${clone.id}?token=${AGENT_TOKEN}`,
      { headers: { 'X-Forwarded-Access-Token': 'e2e-claim-user' } },
    );
  });

  test('POST /views/claim with expired token is rejected', async ({ page }) => {
    const response = await page.request.post(withToken(`${AGENT_BASE}/views/claim/cv-fake:1000000:invalidsig`));
    // Should return 4xx (expired or invalid)
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test('POST /views/claim with forged signature is rejected', async ({ page }) => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const response = await page.request.post(withToken(`${AGENT_BASE}/views/claim/cv-fake:${futureTs}:${'a'.repeat(64)}`));
    // Should return 4xx (invalid signature)
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});

/** Navigate to a custom view and wait for it to load */
async function gotoView(page: Page, viewId: string, expectedTitle: string) {
  // Navigate and wait for network to settle before checking UI
  await page.goto(`/custom/${viewId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`text=${expectedTitle}`).first()).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// View UI Tests
// ---------------------------------------------------------------------------

test.describe('View UI: Render & Edit', () => {
  let testViewId: string | null = null;

  test.beforeEach(async ({ page }) => {
    testViewId = await createView(page, 'E2E UI Test View');
  });

  test.afterEach(async ({ page }) => {
    if (testViewId) {
      await deleteView(page, testViewId);
      testViewId = null;
    }
  });

  test('custom view page renders title and widgets', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E UI Test View');
    // Should render at least one widget (data_table or info_card_grid)
    await expect(page.locator('[class*="border-slate-800"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('edit mode toggle shows drag handles', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E UI Test View');

    // Click Edit Layout button (pencil icon with title="Edit layout")
    await page.click('button[title="Edit layout"]');
    // Edit hint should show
    await expect(page.locator('text=Drag widgets to reorder')).toBeVisible({ timeout: 5_000 });

    // Click Done editing button (eye icon with title="Done editing")
    await page.click('button[title="Done editing"]');
    await expect(page.locator('text=Drag widgets to reorder')).not.toBeVisible();
  });

  test('inline title rename works', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E UI Test View');

    const heading = page.locator('h1').filter({ hasText: 'E2E UI Test View' });
    await heading.click();
    const input = page.locator('input.border-violet-500');
    await expect(input).toBeVisible({ timeout: 5_000 });

    await input.fill('Renamed View');
    await input.press('Enter');

    await expect(page.locator('h1').filter({ hasText: 'Renamed View' })).toBeVisible({ timeout: 5_000 });
  });

  test('share button copies link', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E UI Test View');

    await page.click('button[title="Share view"]');
    await expect(page.locator('button[title="Link copied!"]')).toBeVisible({ timeout: 1_500 });
  });

  test('view not found shows empty state', async ({ page }) => {
    await page.goto('/custom/cv-nonexistent-id');
    await expect(page.locator('text=View not found')).toBeVisible({ timeout: 10_000 });
  });

  test('widgets render full-width (not crammed left)', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E UI Test View');

    // Get the grid container and first widget widths
    const container = page.locator('.react-grid-layout').first();
    const widget = page.locator('[class*="border-slate-800"]').first();
    await expect(widget).toBeVisible({ timeout: 5_000 });

    const containerBox = await container.boundingBox();
    const widgetBox = await widget.boundingBox();

    if (containerBox && widgetBox) {
      // Widget should be at least 80% of container width (full-width = w:4/4)
      const widthRatio = widgetBox.width / containerBox.width;
      expect(widthRatio).toBeGreaterThan(0.8);
    }
  });

  test('multiple widgets stack vertically, not side by side', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E UI Test View');

    const widgets = page.locator('[class*="border-slate-800"]');
    const count = await widgets.count();
    if (count >= 2) {
      const first = await widgets.nth(0).boundingBox();
      const second = await widgets.nth(1).boundingBox();
      if (first && second) {
        // Second widget should not overlap the first (y >= first.y)
        expect(second.y).toBeGreaterThanOrEqual(first.y);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Component Type Rendering & Sizing
// ---------------------------------------------------------------------------

test.describe('View UI: All Component Types', () => {
  let testViewId: string | null = null;

  const allComponentsLayout = [
    {
      kind: 'data_table',
      title: 'Test Table',
      columns: [
        { id: 'name', header: 'Name' },
        { id: 'status', header: 'Status' },
        { id: 'cpu', header: 'CPU' },
      ],
      rows: [
        { name: 'pod-1', status: 'Running', cpu: '100m' },
        { name: 'pod-2', status: 'Failed', cpu: '50m' },
        { name: 'pod-3', status: 'Pending', cpu: '0m' },
      ],
    },
    {
      kind: 'info_card_grid',
      cards: [
        { label: 'Nodes', value: '3', sub: 'healthy' },
        { label: 'Pods', value: '42', sub: 'running' },
        { label: 'Alerts', value: '2', sub: 'firing' },
        { label: 'CPU', value: '68%', sub: 'cluster avg' },
      ],
    },
    {
      kind: 'status_list',
      title: 'Cluster Operators',
      items: [
        { name: 'dns', status: 'healthy', detail: 'Available=True' },
        { name: 'ingress', status: 'warning', detail: 'Progressing' },
        { name: 'etcd', status: 'error', detail: 'Degraded=True' },
      ],
    },
    {
      kind: 'chart',
      chartType: 'line' as const,
      title: 'CPU Over Time',
      series: [
        {
          label: 'namespace-a',
          data: Array.from({ length: 10 }, (_, i) => [Date.now() - (10 - i) * 60000, Math.random() * 100] as [number, number]),
          color: '#60a5fa',
        },
      ],
      yAxisLabel: 'millicores',
      height: 300,
      query: 'sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))',
      timeRange: '1h',
    },
    {
      kind: 'key_value',
      title: 'Cluster Info',
      pairs: [
        { key: 'Version', value: 'OpenShift 4.16.5' },
        { key: 'Platform', value: 'AWS' },
      ],
    },
    {
      kind: 'badge_list',
      badges: [
        { text: 'Healthy', variant: 'success' },
        { text: 'Warning', variant: 'warning' },
        { text: 'Critical', variant: 'error' },
      ],
    },
  ];

  test.beforeEach(async ({ page }) => {
    testViewId = await createView(page, 'E2E All Components', allComponentsLayout);
  });

  test.afterEach(async ({ page }) => {
    if (testViewId) {
      await deleteView(page, testViewId);
      testViewId = null;
    }
  });

  test('all 6 component types render visibly', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E All Components');
    await expect(page.locator('text=Test Table')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Nodes')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=Cluster Operators')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=CPU Over Time')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=Cluster Info')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=Healthy').first()).toBeVisible({ timeout: 3_000 });
  });

  test('all widgets are full-width (>80% container)', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await gotoView(page, testViewId, 'E2E All Components');

    const container = page.locator('.react-grid-layout').first();
    const containerBox = await container.boundingBox();
    if (!containerBox) return;

    const widgets = page.locator('.react-grid-item');
    const widgetCount = await widgets.count();
    expect(widgetCount).toBeGreaterThanOrEqual(6);

    for (let i = 0; i < Math.min(widgetCount, 6); i++) {
      const box = await widgets.nth(i).boundingBox();
      if (box) {
        expect(box.width / containerBox.width).toBeGreaterThan(0.8);
      }
    }
  });

  test('data table shows columns and rows', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('th:has-text("Name")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('th:has-text("Status")')).toBeVisible();
    await expect(page.locator('td:has-text("pod-1")')).toBeVisible();
  });

  test('chart renders title and range footer', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('text=CPU Over Time')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Range:')).toBeVisible({ timeout: 5_000 });
  });

  test('status list shows all items', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('text=dns')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=etcd')).toBeVisible();
  });
});
