import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same ESM constraint as playwright.config.ts: __filename does not exist under
// "type": "module". This never surfaced in CI because the config failed to load
// first, so teardown was never reached.
const teardownDir = dirname(fileURLToPath(import.meta.url));

export default function globalTeardown() {
  if (process.env.PULSE_URL) return;

  try {
    execSync('bash stop-agent.sh', { cwd: teardownDir, stdio: 'inherit' });
  } catch {
    // Best effort
  }
}
