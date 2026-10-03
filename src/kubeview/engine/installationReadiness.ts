import { agentFetch } from './safeQuery';

export const INSTALLATION_CHECK_IDS = [
  'provider_configuration', 'provider_connectivity', 'database',
  'kubernetes_pods', 'kubernetes_deployments', 'kubernetes_nodes',
  'kubernetes_events', 'kubernetes_logs', 'monitor',
] as const;
export type InstallationCheckStatus = 'healthy' | 'unhealthy' | 'unknown';
export interface InstallationCheck {
  id: string;
  status: InstallationCheckStatus;
  message: string;
  remediation: string;
  source: string;
}
export interface InstallationReadiness {
  status: 'healthy' | 'degraded' | 'unknown';
  checked_at: string;
  scope: string;
  checks: InstallationCheck[];
  limitations: string[];
}

/** Reject missing coverage and malformed diagnostics instead of rendering a green badge. */
export function parseInstallationReadiness(raw: unknown): InstallationReadiness {
  if (!raw || typeof raw !== 'object') throw new Error('Agent returned an invalid readiness report.');
  const report = raw as Partial<InstallationReadiness>;
  if (!['healthy', 'degraded', 'unknown'].includes(report.status ?? '') ||
      typeof report.checked_at !== 'string' || !Number.isFinite(Date.parse(report.checked_at)) ||
      typeof report.scope !== 'string' || !report.scope.trim() ||
      !Array.isArray(report.checks) || !Array.isArray(report.limitations) ||
      report.limitations.some(item => typeof item !== 'string')) {
    throw new Error('Agent returned an invalid readiness report.');
  }
  const seen = new Set<string>();
  for (const check of report.checks) {
    if (!check || typeof check.id !== 'string' || !check.id.trim() || seen.has(check.id) ||
        !['healthy', 'unhealthy', 'unknown'].includes(check.status) ||
        typeof check.message !== 'string' || !check.message.trim() ||
        typeof check.remediation !== 'string' || typeof check.source !== 'string' || !check.source.trim()) {
      throw new Error('Agent returned invalid or duplicate readiness checks.');
    }
    seen.add(check.id);
  }
  const missing = INSTALLATION_CHECK_IDS.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Readiness checks are missing: ${missing.join(', ')}. Update the paired agent release and retry.`);
  if (report.status === 'healthy' && report.checks.some(check => check.status !== 'healthy')) {
    throw new Error('Agent readiness summary conflicts with incomplete or failed checks.');
  }
  return report as InstallationReadiness;
}

export async function fetchInstallationReadiness(): Promise<InstallationReadiness> {
  const response = await agentFetch('/api/agent/readiness');
  if (response.status === 404) throw new Error('The agent does not expose installation readiness. Update the paired agent release and retry.');
  if (response.status === 401 || response.status === 403) throw new Error(`Readiness authentication denied (${response.status}). Check the UI-to-agent token configuration, then retry.`);
  if (!response.ok) throw new Error(`The readiness request failed (${response.status}). Check agent availability and token configuration, then retry.`);
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('The agent readiness response was not valid JSON. Check the paired agent release and proxy configuration.'); }
  return parseInstallationReadiness(data);
}
