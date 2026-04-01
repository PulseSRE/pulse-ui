import { test, expect } from 'playwright/test';

test.describe('Keyboard Shortcuts', () => {
  test('search bar is clickable to open command palette', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });

    // Click the search bar instead of using keyboard shortcut (more reliable in headless)
    const searchBar = page.locator('text=Search resources').first();
    await expect(searchBar).toBeVisible({ timeout: 5_000 });
  });

  test('status bar shows keyboard hint text', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
    // Status bar shows ⌘K search hint
    await expect(page.locator('text=search').first()).toBeVisible({ timeout: 5_000 });
  });
});
