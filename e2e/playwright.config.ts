import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,
  use: {
    baseURL: process.env.PULSE_URL || 'http://localhost:9000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: {
      cookies: [],
      origins: [{
        origin: process.env.PULSE_URL || 'http://localhost:9000',
        localStorage: [{ name: 'openshiftpulse-tour-completed', value: 'true' }],
      }],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /* Tear down agent + PostgreSQL containers after tests */
  globalTeardown: process.env.PULSE_URL ? undefined : './global-teardown.ts',
  /* Start mock K8s + agent + dev server before tests (unless targeting a deployed instance) */
  ...(process.env.PULSE_URL ? {} : {
    webServer: [
      {
        command: 'node mock-k8s-server.mjs',
        cwd: __dirname,
        url: 'http://localhost:8001/api/v1/nodes',
        reuseExistingServer: true,
        timeout: 10_000,
      },
      {
        command: 'bash start-agent.sh',
        cwd: __dirname,
        url: 'http://localhost:8080/healthz',
        reuseExistingServer: true,
        timeout: 120_000,
      },
      {
        command: 'pnpm run dev',
        url: 'http://localhost:9000',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          PULSE_AGENT_WS_TOKEN: process.env.E2E_AGENT_TOKEN || 'e2e-test-token',
        },
      },
    ],
  }),
});
