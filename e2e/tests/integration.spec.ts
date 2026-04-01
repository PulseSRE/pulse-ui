/**
 * Integration tests — validate views render with mock K8s data.
 */

import { test, expect } from 'playwright/test';

test.describe('Integration: Agent Health', () => {
  test('agent health endpoint is reachable from UI', async ({ page }) => {
    const response = await page.goto('/api/agent/health');
    if (!response || response.status() !== 200) {
      test.skip(true, 'Agent not running — skipping');
      return;
    }
    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});

test.describe('Integration: Data Flow', () => {
  test('Welcome page renders with stat cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
    // Stat cards render (Nodes, Alerts, etc.)
    await expect(page.locator('text=Nodes').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Healthy').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Workloads view renders heading', async ({ page }) => {
    await page.goto('/workloads');
    await expect(page.locator('text=Workloads').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Compute view renders heading', async ({ page }) => {
    await page.goto('/compute');
    await expect(page.locator('text=Compute').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Pulse view renders heading', async ({ page }) => {
    await page.goto('/pulse');
    await expect(page.locator('text=Cluster Pulse').first()).toBeVisible({ timeout: 15_000 });
  });
});
