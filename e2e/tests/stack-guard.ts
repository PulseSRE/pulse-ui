import { test } from 'playwright/test';

/**
 * Bail out of a test when the mock agent stack is not reachable.
 *
 * Locally this skips, so a developer who has not run `pnpm run e2e:stack` still
 * gets a useful partial run out of the suite.
 *
 * In CI it throws instead. playwright.config.ts starts the mock K8s server, the
 * agent and the dev server via its `webServer` block, so in CI the stack is
 * always supposed to be up -- an unreachable agent there means something is
 * genuinely broken. Every one of these guards sits directly in front of the
 * assertions it protects, so a guard that fires in CI converts a real failure
 * into a silent pass and takes the test's coverage with it.
 *
 * That is not hypothetical: this suite did not run at all between 2026-08-07
 * and 2026-08-18 because the Playwright config failed to load, and nothing
 * about a green-looking board revealed it.
 */
export function bailUnlessStackAvailable(reason: string): void {
  if (process.env.CI) {
    throw new Error(
      `${reason} — the mock agent stack must be reachable in CI ` +
        '(started by the webServer block in e2e/playwright.config.ts)',
    );
  }
  test.skip(true, reason);
}
