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
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /* Start mock K8s + dev server before tests (unless targeting a deployed instance) */
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
        command: 'npm run dev',
        url: 'http://localhost:9000',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
    ],
  }),
});
