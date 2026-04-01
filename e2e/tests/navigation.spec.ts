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

  test('Incident Center loads', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.locator('text=Incident Center').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Review Queue loads', async ({ page }) => {
    await page.goto('/reviews');
    await expect(page.locator('text=Review Queue').first()).toBeVisible({ timeout: 15_000 });
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

  test('redirects /alerts to /incidents', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForURL(/incidents/, { timeout: 10_000 });
  });

  test('redirects /builds to /workloads', async ({ page }) => {
    await page.goto('/builds');
    await page.waitForURL(/workloads/, { timeout: 10_000 });
  });
});
