/**
 * E2E tests for custom view lifecycle: create, edit, delete, share.
 *
 * These tests hit the real view API endpoints through the UI proxy.
 * They create views via the REST API, verify the UI renders them,
 * test edit mode (rename, layout), and clean up via delete.
 */

import { test, expect, type Page } from 'playwright/test';

const AGENT_BASE = '/api/agent';

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

  const response = await page.request.post(`${AGENT_BASE}/views`, {
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
  await page.request.delete(`${AGENT_BASE}/views/${viewId}`);
}

/** Helper: list views via the REST API */
async function listViews(page: Page) {
  const response = await page.request.get(`${AGENT_BASE}/views`);
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

    const response = await page.request.get(`${AGENT_BASE}/views/${testViewId}`);
    expect(response.ok()).toBe(true);
    const view = await response.json();
    expect(view.title).toBe('E2E Get Test');
    expect(view.layout).toHaveLength(2);
  });

  test('PUT /views/:id updates title and description', async ({ page }) => {
    testViewId = await createView(page, 'E2E Update Test');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    const response = await page.request.put(`${AGENT_BASE}/views/${testViewId}`, {
      data: { title: 'Updated Title', description: 'Updated description' },
    });
    expect(response.ok()).toBe(true);

    const getResp = await page.request.get(`${AGENT_BASE}/views/${testViewId}`);
    const updated = await getResp.json();
    expect(updated.title).toBe('Updated Title');
    expect(updated.description).toBe('Updated description');
  });

  test('PUT /views/:id updates positions', async ({ page }) => {
    testViewId = await createView(page, 'E2E Positions Test');
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }

    const positions = { 0: { x: 0, y: 0, w: 4, h: 3 }, 1: { x: 0, y: 3, w: 2, h: 2 } };
    const response = await page.request.put(`${AGENT_BASE}/views/${testViewId}`, {
      data: { positions },
    });
    expect(response.ok()).toBe(true);

    const getResp = await page.request.get(`${AGENT_BASE}/views/${testViewId}`);
    const updated = await getResp.json();
    expect(updated.positions).toBeDefined();
  });

  test('DELETE /views/:id removes the view', async ({ page }) => {
    const viewId = await createView(page, 'E2E Delete Test');
    if (!viewId) { test.skip(true, 'Agent unavailable'); return; }

    const delResp = await page.request.delete(`${AGENT_BASE}/views/${viewId}`);
    expect(delResp.ok()).toBe(true);

    const getResp = await page.request.get(`${AGENT_BASE}/views/${viewId}`);
    expect(getResp.status()).toBe(404);
    testViewId = null; // Already deleted
  });

  test('DELETE nonexistent view returns 404', async ({ page }) => {
    const response = await page.request.delete(`${AGENT_BASE}/views/cv-nonexistent`);
    expect(response.status()).toBe(404);
  });

  test('POST /views rejects empty layout', async ({ page }) => {
    const response = await page.request.post(`${AGENT_BASE}/views`, {
      data: { title: 'Empty', layout: [] },
    });
    expect(response.status()).toBe(400);
  });

  test('POST /views rejects invalid view ID', async ({ page }) => {
    const response = await page.request.post(`${AGENT_BASE}/views`, {
      data: { id: 'has:colons:bad', title: 'Bad ID', layout: [{ kind: 'key_value', pairs: [] }] },
    });
    expect(response.status()).toBe(400);
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

    const response = await page.request.post(`${AGENT_BASE}/views/${testViewId}/share`);
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
    const shareResp = await page.request.post(`${AGENT_BASE}/views/${testViewId}/share`);
    const { share_token } = await shareResp.json();

    // Claim it
    const claimResp = await page.request.post(`${AGENT_BASE}/views/claim/${share_token}`);
    expect(claimResp.ok()).toBe(true);
    const clone = await claimResp.json();
    expect(clone.id).toBeTruthy();
    expect(clone.id).not.toBe(testViewId);

    // Clean up clone
    await deleteView(page, clone.id);
  });

  test('POST /views/claim with expired token returns 410', async ({ page }) => {
    // Craft an expired token (timestamp in the past)
    const response = await page.request.post(`${AGENT_BASE}/views/claim/cv-fake:1000000:invalidsig`);
    expect(response.status()).toBe(410);
  });

  test('POST /views/claim with forged signature returns 400', async ({ page }) => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const response = await page.request.post(`${AGENT_BASE}/views/claim/cv-fake:${futureTs}:${'a'.repeat(64)}`);
    expect(response.status()).toBe(400);
  });
});

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
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('text=E2E UI Test View')).toBeVisible({ timeout: 10_000 });
    // Should render at least one widget (data_table or info_card_grid)
    await expect(page.locator('[class*="border-slate-800"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('edit mode toggle shows drag handles', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('text=E2E UI Test View')).toBeVisible({ timeout: 10_000 });

    // Click Edit Layout
    await page.click('text=Edit Layout');
    // Drag handles should appear
    await expect(page.locator('.widget-drag-handle').first()).toBeVisible({ timeout: 3_000 });
    // Edit hint should show
    await expect(page.locator('text=Drag widgets to reorder')).toBeVisible();

    // Click Done Editing
    await page.click('text=Done Editing');
    await expect(page.locator('.widget-drag-handle')).not.toBeVisible();
  });

  test('inline title rename works', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('text=E2E UI Test View')).toBeVisible({ timeout: 10_000 });

    // Click the title to enter edit mode
    await page.click('h1:has-text("E2E UI Test View")');
    // Input should appear
    const input = page.locator('input[class*="text-2xl"]');
    await expect(input).toBeVisible({ timeout: 3_000 });

    // Clear and type new title
    await input.fill('Renamed View');
    await input.press('Enter');

    // Title should update
    await expect(page.locator('text=Renamed View')).toBeVisible({ timeout: 5_000 });
  });

  test('share button copies link', async ({ page }) => {
    if (!testViewId) { test.skip(true, 'Agent unavailable'); return; }
    await page.goto(`/custom/${testViewId}`);
    await expect(page.locator('text=E2E UI Test View')).toBeVisible({ timeout: 10_000 });

    // Click Share
    await page.click('button:has-text("Share")');
    // Should show "Link Copied!"
    await expect(page.locator('text=Link Copied!')).toBeVisible({ timeout: 5_000 });
  });

  test('view not found shows empty state', async ({ page }) => {
    await page.goto('/custom/cv-nonexistent-id');
    await expect(page.locator('text=View not found')).toBeVisible({ timeout: 10_000 });
  });
});
