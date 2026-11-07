/**
 * Resource list and detail pages against the mock K8s API (e2e/mock-k8s-server.mjs).
 *
 * - The list is one table: every cell starts exactly where its column header
 *   starts (the header used to be a <table> over flex rows, so on Pods the
 *   status sat under READY).
 * - A detail page renders. The mock used to answer single-object GETs with an
 *   empty list, so every detail page crashed here and none could be covered.
 */

import { test, expect, type Page } from 'playwright/test';

async function expectNoCrash(page: Page) {
  await expect(page.getByText(/Something went wrong|Application error|Cannot read properties/i)).toHaveCount(0);
}

test.describe('Resource list table', () => {
  test('Pods: every cell lines up under its header, rows are labelled', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/r/v1~pods?ns=*');

    const table = page.getByRole('table', { name: /Pods/ });
    await expect(table).toBeVisible({ timeout: 20_000 });
    const row = table.locator('[role="row"][data-index]').filter({ hasText: 'nginx-abc12' });
    await expect(row).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Select nginx-abc12' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Select all' })).toBeVisible();

    const headers = table.getByRole('columnheader');
    const cells = row.getByRole('cell');
    const count = await headers.count();
    expect(count).toBeGreaterThan(5);
    await expect(cells).toHaveCount(count);

    for (let i = 0; i < count; i++) {
      const h = await headers.nth(i).boundingBox();
      const c = await cells.nth(i).boundingBox();
      expect(h && c, `column ${i} has a box`).toBeTruthy();
      expect(Math.abs(h!.x - c!.x), `column ${i} left edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(h!.width - c!.width), `column ${i} width`).toBeLessThanOrEqual(1);
    }

    // The status is under STATUS, not under READY.
    const texts = await headers.allInnerTexts();
    const statusIdx = texts.findIndex((t) => t.trim().toUpperCase() === 'STATUS');
    expect(statusIdx).toBeGreaterThan(0);
    await expect(cells.nth(statusIdx)).toContainText('Running');
  });
});

test.describe('Resource detail pages', () => {
  test('Pod detail renders the pod', async ({ page }) => {
    await page.goto('/r/v1~pods/default/nginx-abc12');
    await expect(page.getByRole('heading', { name: /nginx-abc12/ }).first()).toBeVisible({ timeout: 20_000 });
    await expectNoCrash(page);
  });

  test('Deployment detail renders the deployment', async ({ page }) => {
    await page.goto('/r/apps~v1~deployments/default/nginx');
    await expect(page.getByRole('heading', { name: /nginx/ }).first()).toBeVisible({ timeout: 20_000 });
    await expectNoCrash(page);
  });
});
