import { test, expect } from 'playwright/test';

test.describe('View Content', () => {
  test('Welcome page shows navigation cards', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Pulse').first()).toBeVisible();
    await expect(page.locator('text=Workloads').first()).toBeVisible();
    await expect(page.locator('text=Compute').first()).toBeVisible();
  });

  test('Welcome page cards are clickable', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=Workloads').first().click();
    await page.waitForURL(/workloads/, { timeout: 10_000 });
  });

  test('Admin view loads and shows in status bar', async ({ page }) => {
    await page.goto('/admin');
    // Admin view is data-heavy — verify it loads by checking status bar
    await expect(page.locator('text=Administration').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Incident Center loads and shows in status bar', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.locator('text=Incident Center').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Workloads view renders heading', async ({ page }) => {
    await page.goto('/workloads');
    await expect(page.locator('text=Workloads').first()).toBeVisible({ timeout: 15_000 });
  });

  test('StatusBar shows connection status', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 5_000 });
  });
});
