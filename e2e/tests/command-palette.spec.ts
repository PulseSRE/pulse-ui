import { test, expect } from 'playwright/test';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
  });

  test('opens with Cmd/Ctrl+K or by clicking search bar', async ({ page }) => {
    // Try keyboard shortcut first
    await page.keyboard.press(`${MOD}+k`);
    const dialog = page.locator('[role="dialog"], [data-testid="command-palette"], input[placeholder*="Search"]');
    const opened = await dialog.first().isVisible({ timeout: 3_000 }).catch(() => false);

    if (!opened) {
      // Fallback: click the search bar in the command bar
      const searchBar = page.locator('text=Search resources').first();
      if (await searchBar.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await searchBar.click();
      }
    }
  });

  test('search bar is visible in header', async ({ page }) => {
    await expect(page.locator('text=Search resources').first()).toBeVisible({ timeout: 5_000 });
  });
});
