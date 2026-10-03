import { useQuery } from '@tanstack/react-query';
import { fetchInstallationReadiness } from '../../engine/installationReadiness';
import { useFleetStore } from '../../store/fleetStore';

const CHECK_LABELS: Record<string, string> = {
  provider_configuration: 'Model provider configuration',
  provider_connectivity: 'Model provider connectivity',
  database: 'Database',
  kubernetes_pods: 'Read pods',
  kubernetes_deployments: 'Read deployments',
  kubernetes_nodes: 'Read nodes',
  kubernetes_events: 'Read events',
  kubernetes_logs: 'Read pod logs',
  monitor: 'Monitoring runtime',
};
const STATUS_LABELS = { healthy: 'Check passed', unhealthy: 'Needs attention', unknown: 'Unknown' };
const SUMMARY_LABELS = { healthy: 'Reported checks passed', degraded: 'Installation needs attention', unknown: 'Readiness not established' };

export function InstallationReadinessPanel() {
  const activeClusterId = useFleetStore(state => state.activeClusterId);
  const query = useQuery({ queryKey: ['agent-installation-readiness'], queryFn: fetchInstallationReadiness, retry: false, staleTime: 0 });
  const report = query.data;
  const stale = query.isError || query.isFetching;
  return <section aria-label="Agent installation readiness" className="mb-6 rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Agent installation readiness</h2>
        <p className="text-xs text-slate-400 mt-1">Read-only checks of the agent deployment, separate from the cluster checklist below. Kubernetes probes use installation credentials, not your browser identity.</p>
      </div>
      <button disabled={query.isFetching} onClick={() => { void query.refetch(); }} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">{query.isFetching ? 'Checking installation…' : 'Re-check installation'}</button>
    </div>
    {activeClusterId !== 'local' && <p className="text-xs text-amber-300">These checks describe the agent deployment cluster, not the selected fleet cluster.</p>}
    {query.isError && <div role="alert" className="text-sm text-amber-300"><p>Readiness unknown.</p><p className="text-xs mt-1">{query.error instanceof Error ? query.error.message : 'Readiness could not be checked. Retry after checking the agent connection.'}</p></div>}
    {query.isFetching && <p role="status" className="text-xs text-slate-400">Checking installation. Current readiness is not established while this request is pending.</p>}
    {report && <>
      <p className={`text-sm font-medium ${stale ? 'text-slate-400' : report.status === 'healthy' ? 'text-emerald-300' : report.status === 'degraded' ? 'text-amber-300' : 'text-slate-300'}`}>
        {stale ? 'Previous report — awaiting a successful current check' : SUMMARY_LABELS[report.status]}
      </p>
      <p className="text-xs text-slate-400">Scope: {report.scope}. Checked {new Date(report.checked_at).toLocaleString()}.</p>
      <ul className="divide-y divide-slate-800" aria-label={stale ? 'Previous installation checks' : 'Installation checks'}>
        {report.checks.map(check => <li key={check.id} className="py-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-medium text-slate-200">{CHECK_LABELS[check.id] ?? check.id.replaceAll('_', ' ')}</h3><span className={`text-xs ${stale ? 'text-slate-500' : check.status === 'healthy' ? 'text-emerald-300' : check.status === 'unhealthy' ? 'text-amber-300' : 'text-slate-400'}`}>{STATUS_LABELS[check.status]}{stale ? ' (previous report)' : ''}</span></div>
          <p className="text-xs text-slate-300">{check.message}</p>
          {check.remediation && <p className="text-xs text-slate-400">Next step: {check.remediation}</p>}
          <p className="text-[11px] text-slate-500">Source: {check.source}</p>
        </li>)}
      </ul>
      {!!report.limitations.length && <div className="text-xs text-slate-400"><h3 className="font-medium text-slate-300 mb-1">What these checks do not prove</h3><ul className="list-disc pl-4 space-y-1">{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    </>}
    <p className="text-xs text-slate-500">Installation diagnostics do not prove workload recovery or end-to-end model execution. No workload mutation or model request is performed by this check. Agent reports are cached for up to 60 seconds; retries may show the same check timestamp.</p>
  </section>;
}
