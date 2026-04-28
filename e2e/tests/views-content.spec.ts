import { test, expect } from 'playwright/test';

test.describe('View Content', () => {
  test('Pulse page shows cluster overview', async ({ page }) => {
    await page.goto('/pulse');
    await expect(page.locator('text=Cluster Pulse').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Pulse page compute pill navigates to compute', async ({ page }) => {
    await page.goto('/pulse');
    await expect(page.locator('text=Cluster Pulse').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=nodes').first().click();
    await page.waitForURL(/compute/, { timeout: 10_000 });
  });

  test('Admin view loads and shows in status bar', async ({ page }) => {
    await page.goto('/admin');
    // Admin view is data-heavy — verify it loads by checking status bar
    await expect(page.locator('text=Administration').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Inbox loads and shows heading', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.locator('text=Inbox').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Workloads view renders heading', async ({ page }) => {
    await page.goto('/workloads');
    await expect(page.locator('text=Workloads').first()).toBeVisible({ timeout: 15_000 });
  });

  test('StatusBar shows connection status', async ({ page }) => {
    await page.goto('/pulse');
    await expect(page.locator('text=Cluster Pulse').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 5_000 });
  });
});
