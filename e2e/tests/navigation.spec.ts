import { test, expect } from 'playwright/test';

test.describe('Navigation', () => {
  test('Welcome page loads and shows key elements', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.locator('text=OpenShift Pulse').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Pulse view loads', async ({ page }) => {
    await page.goto('/pulse');
    await expect(page.locator('text=Cluster Pulse').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Workloads view loads', async ({ page }) => {
    await page.goto('/workloads');
    await expect(page.locator('text=Workloads').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Compute view loads', async ({ page }) => {
    await page.goto('/compute');
    await expect(page.locator('text=Compute').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Storage view loads', async ({ page }) => {
    await page.goto('/storage');
    await expect(page.locator('text=Storage').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Networking view loads', async ({ page }) => {
    await page.goto('/networking');
    await expect(page.locator('text=Networking').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Admin view loads', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('text=Administration').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Inbox loads', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.locator('text=Inbox').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Identity view loads', async ({ page }) => {
    await page.goto('/identity');
    await expect(page.locator('text=Identity').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Security view loads', async ({ page }) => {
    await page.goto('/security');
    await expect(page.locator('text=Security').first()).toBeVisible({ timeout: 15_000 });
  });

  test('GitOps view loads', async ({ page }) => {
    await page.goto('/gitops');
    await expect(page.locator('text=GitOps').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Alerts view loads', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.locator('text=Alerts').first()).toBeVisible({ timeout: 15_000 });
  });

  test('unknown routes fall back to /pulse', async ({ page }) => {
    await page.goto('/nonexistent-page');
    await page.waitForURL(/pulse/, { timeout: 10_000 });
  });
});
