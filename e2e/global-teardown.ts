import { execSync } from 'child_process';
import { dirname } from 'path';

export default function globalTeardown() {
  if (process.env.PULSE_URL) return;

  try {
    execSync('bash stop-agent.sh', { cwd: dirname(__filename), stdio: 'inherit' });
  } catch {
    // Best effort
  }
}
