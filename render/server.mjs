/**
 * Entry point for the Pulse render service. See app.mjs for the API and render.mjs for rendering.
 */

import { chromium } from 'playwright-core';
import { createServer } from './app.mjs';
import { renderDashboard } from './render.mjs';

const token = process.env.RENDER_TOKEN;
if (!token) {
  console.error('RENDER_TOKEN is required');
  process.exit(1);
}
const server = createServer({
  token,
  uiUrl: process.env.UI_URL || 'http://127.0.0.1:8080',
  maxConcurrent: Number(process.env.MAX_CONCURRENT || 2),
  timeoutMs: Number(process.env.RENDER_TIMEOUT_MS || 30000),
  render: renderDashboard,
  launch: () =>
    chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }),
});
const port = Number(process.env.PORT || 8090);
server.listen(port, () => console.log(`pulse-render listening on :${port}`));
const stop = async () => {
  await server.closeBrowser();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
