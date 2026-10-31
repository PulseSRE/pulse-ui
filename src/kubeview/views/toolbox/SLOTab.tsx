import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentJson } from '../../engine/safeQuery';
import { LoadError } from '../../components/primitives/LoadError';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { k8sList } from '../../engine/query';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { Button } from '../../components/primitives/Button';

interface DeploymentRef { metadata: { name: string; namespace?: string } }

/**
 * Deployments on the cluster the agent watches (the local one), grouped by
 * name: the agent's availability SLI matches `deployment="<service>"` with no
 * namespace, so every namespace holding a Deployment of that name is measured
 * together. The picker says so instead of letting a typo read as "no data".
 */
export function deploymentNamespacesByName(deployments: DeploymentRef[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of deployments) {
    const list = m.get(d.metadata.name) ?? [];
    list.push(d.metadata.namespace || '');
    m.set(d.metadata.name, list);
  }
  return m;
}

export function SLOTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newSLO, setNewSLO] = useState({ service: '', type: 'availability', target: '99.9', window_days: '30', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<{ service: string; type: string } | null>(null);
  // Editing an SLO re-registers it under the same service and type; the agent replaces the definition.
  const [editing, setEditing] = useState<{ service: string; type: string } | null>(null);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const { data: deployments, error: deploymentsError } = useQuery<DeploymentRef[]>({
    queryKey: ['slo', 'deployments', LOCAL_CLUSTER_ID],
    queryFn: () => k8sList<DeploymentRef>('/apis/apps/v1/deployments', undefined, LOCAL_CLUSTER_ID),
    enabled: showAdd,
    staleTime: 60000,
    retry: false,
  });
  const byName = deploymentNamespacesByName(deployments ?? []);
  const deploymentNames = [...byName.keys()].sort();
  const selectedNamespaces = byName.get(newSLO.service) ?? [];

  const [actionError, setActionError] = useState<{ title: string; error: unknown } | null>(null);

  // A failed read was turned into an empty list, which rendered "No SLOs
  // defined yet" — on a cluster that had SLOs and only could not read them.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['slo-status'],
    queryFn: () => agentJson<{ slos: Record<string, unknown>[]; total: number }>('/api/agent/slo'),
    refetchInterval: 60_000,
  });

  const slos = data?.slos ?? [];

  const addSLO = async () => {
    if (!newSLO.service.trim()) return;
    setActionError(null);
    try {
      await agentJson('/api/agent/slo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: newSLO.service,
          type: newSLO.type,
          // Rounded: 99.9 / 100 is 0.9990000000000001 in floating point.
          target: Number((parseFloat(newSLO.target) / 100).toFixed(8)),
          window_days: parseInt(newSLO.window_days),
          description: newSLO.description,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['slo-status'] });
      setShowAdd(false);
      setEditing(null);
      setNewSLO({ service: '', type: 'availability', target: '99.9', window_days: '30', description: '' });
    } catch (e) {
      // The form used to close as if the SLO had been created.
      setActionError({ title: editing ? 'The SLO was not updated' : 'The SLO was not created', error: e });
    }
    setConfirmEdit(false);
  };

  const startEdit = (slo: Record<string, unknown>) => {
    setActionError(null);
    setEditing({ service: String(slo.service), type: String(slo.type) });
    setNewSLO({
      service: String(slo.service),
      type: String(slo.type),
      target: (((slo.target as number) ?? 0) * 100).toFixed(3).replace(/\.?0+$/, ''),
      window_days: String(slo.window_days ?? 30),
      description: String(slo.description ?? ''),
    });
    setShowAdd(true);
  };

  const deleteSLO = async (service: string, type: string) => {
    setActionError(null);
    try {
      await agentJson(`/api/agent/slo/${encodeURIComponent(service)}/${encodeURIComponent(type)}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['slo-status'] });
    } catch (e) {
      setActionError({ title: `The SLO for ${service} was not deleted`, error: e });
    }
    setConfirmDelete(null);
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">
            Service Level Objectives with live burn rate monitoring. Define targets and track error budget depletion.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-md"
        >
          <Plus className="w-3.5 h-3.5" />
          Add SLO
        </button>
      </div>

      {actionError && <LoadError title={actionError.title} error={actionError.error} onRetry={() => setActionError(null)} />}
      {isError && <LoadError title="SLOs could not be loaded" error={error} onRetry={() => refetch()} />}

      {/* Add SLO form */}
      {showAdd && (
        <div className="bg-slate-900 border border-teal-800/50 rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-medium text-slate-200">{editing ? `Edit SLO — ${editing.service} (${editing.type})` : 'New Service Level Objective'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1" htmlFor="slo-service">Deployment</label>
              {editing || deploymentsError || deploymentNames.length === 0 ? (
                <input
                  id="slo-service"
                  value={newSLO.service}
                  disabled={!!editing}
                  onChange={(e) => setNewSLO({ ...newSLO, service: e.target.value.trim() })}
                  placeholder="e.g., checkout-api"
                  className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 disabled:opacity-60 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                />
              ) : (
                <select
                  id="slo-service"
                  value={newSLO.service}
                  onChange={(e) => setNewSLO({ ...newSLO, service: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
                >
                  <option value="">Choose a deployment…</option>
                  {deploymentNames.map((n) => (
                    <option key={n} value={n}>{n} ({(byName.get(n) ?? []).join(', ')})</option>
                  ))}
                </select>
              )}
              {deploymentsError && !editing && <p className="text-[10px] text-amber-400 mt-1">Deployments could not be listed; type the deployment name.</p>}
              {selectedNamespaces.length > 1 && (
                <p className="text-[10px] text-amber-400 mt-1" role="note">
                  {selectedNamespaces.length} namespaces have a Deployment named {newSLO.service} ({selectedNamespaces.join(', ')}). The agent matches by name only, so they are measured together.
                </p>
              )}
              {selectedNamespaces.length === 1 && <p className="text-[10px] text-slate-500 mt-1">In namespace {selectedNamespaces[0]}. The agent matches by deployment name only (no namespace).</p>}
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Type</label>
              <select
                value={newSLO.type}
                disabled={!!editing}
                onChange={(e) => setNewSLO({ ...newSLO, type: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              >
                <option value="availability">Availability</option>
                <option value="latency">Latency (requests under 1s)</option>
                <option value="error_rate">Error Rate (non-5xx)</option>
              </select>
              {newSLO.type !== 'availability' && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Measured for the API server (kube-apiserver) only. Other services report no data until they expose request metrics.
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Target (%)</label>
              <input
                value={newSLO.target}
                onChange={(e) => setNewSLO({ ...newSLO, target: e.target.value })}
                placeholder="99.9"
                className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Window (days)</label>
              <input
                value={newSLO.window_days}
                onChange={(e) => setNewSLO({ ...newSLO, window_days: e.target.value })}
                placeholder="30"
                className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Description (optional)</label>
            <input
              value={newSLO.description}
              onChange={(e) => setNewSLO({ ...newSLO, description: e.target.value })}
              placeholder="e.g., Checkout must be available 99.9% over rolling 30d"
              className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowAdd(false); setEditing(null); }} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={() => (editing ? setConfirmEdit(true) : addSLO())} disabled={!newSLO.service.trim()} className="px-3 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-md disabled:opacity-50">{editing ? 'Save changes' : 'Create SLO'}</button>
          </div>
        </div>
      )}

      {/* SLO list */}
      {isError ? null : slos.length === 0 && !showAdd ? (
        <div className="text-center py-12">
          <TrendingUp className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No SLOs defined yet</p>
          <p className="text-xs text-slate-500 mt-1">Add a Service Level Objective to track error budget burn rate from live Prometheus data.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {slos.map((slo: Record<string, unknown>) => {
            const alertLevel = slo.alert_level as string;
            // An SLO with no measurement yet is listed, not hidden: "no data" is
            // an answer, and dropping it read as the SLO not existing.
            const noData = alertLevel === 'no_data';
            const budgetPct = noData ? 0 : Math.round(((slo.error_budget_remaining as number) ?? 0) * 100);
            const burnRate = (slo.burn_rate as number) || 0;
            const target = (slo.target as number) || 0;
            const currentVal = slo.current_value as number | null | undefined;
            const windowDays = slo.window_days as number;
            const description = slo.description as string | undefined;
            const hoursLeft = slo.budget_remaining_hours as number | null | undefined;

            const gaugeColor = noData ? '#64748b' : alertLevel === 'critical' ? '#ef4444' : alertLevel === 'warning' ? '#f59e0b' : '#10b981';
            const gaugeBg = noData ? 'rgba(100,116,139,0.08)' : alertLevel === 'critical' ? 'rgba(239,68,68,0.08)' : alertLevel === 'warning' ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)';
            const fillDeg = Math.round((budgetPct / 100) * 270);

            // The agent decides the level (14.4x / 6x burn, or budget nearly
            // spent); the card used its own 2x / 1x cut-offs and could say
            // NORMAL beside a critical alert.
            const burnLabel = noData ? 'NO DATA' : alertLevel === 'critical' ? 'CRITICAL' : alertLevel === 'warning' ? 'WARNING' : 'OK';
            const burnColor = noData ? 'text-slate-400' : alertLevel === 'critical' ? 'text-red-400' : alertLevel === 'warning' ? 'text-amber-400' : 'text-emerald-400';

            return (
              <div
                key={`${slo.service}:${slo.type}`}
                className={cn(
                  'relative bg-slate-900 rounded-xl p-5 transition-all hover:ring-1',
                  alertLevel === 'critical' ? 'border border-red-900/50 hover:ring-red-800/40' :
                  alertLevel === 'warning' ? 'border border-amber-900/40 hover:ring-amber-800/30' :
                  'border border-slate-800 hover:ring-slate-700/50',
                )}
              >
                <Button size="sm" variant="ghost" className="absolute top-2 right-9" aria-label={`Edit SLO ${String(slo.service)} ${String(slo.type)}`} onClick={() => startEdit(slo)}>
                  Edit
                </Button>
                <button
                  onClick={() => setConfirmDelete({ service: String(slo.service), type: String(slo.type) })}
                  aria-label={`Delete SLO ${String(slo.service)} ${String(slo.type)}`}
                  className="absolute top-3 right-3 text-slate-700 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-start gap-2.5 mb-4 pr-6">
                  <div className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0 mt-1',
                    alertLevel === 'critical' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
                    alertLevel === 'warning' ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]' :
                    noData ? 'bg-slate-500' :
                    'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]',
                  )} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{String(slo.service).replace('pulse-openshift-sre-agent', 'agent').replace('openshiftpulse', 'ui')}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm font-medium">{String(slo.type)}</span>
                      <span className="text-[10px] text-slate-600">{windowDays}d window</span>
                    </div>
                    {description && <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{description}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-5">
                  <div className="relative shrink-0 w-[88px] h-[88px]">
                    <svg viewBox="0 0 100 100" className="w-full h-full rotate-[-135deg]">
                      <circle
                        cx="50" cy="50" r="40"
                        fill="none"
                        stroke="currentColor"
                        className="text-slate-800"
                        strokeWidth="7"
                        strokeDasharray={`${270 * (Math.PI * 80) / 360} ${(Math.PI * 80)}`}
                        strokeLinecap="round"
                      />
                      <circle
                        cx="50" cy="50" r="40"
                        fill="none"
                        stroke={gaugeColor}
                        strokeWidth="7"
                        strokeDasharray={`${fillDeg * (Math.PI * 80) / 360} ${(Math.PI * 80)}`}
                        strokeLinecap="round"
                        style={{ filter: `drop-shadow(0 0 4px ${gaugeColor}40)` }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-bold text-slate-100 leading-none">{noData ? '—' : `${budgetPct}%`}</span>
                      <span className="text-[8px] text-slate-500 uppercase tracking-wider mt-0.5">budget</span>
                    </div>
                    <div
                      className="absolute inset-0 rounded-full -z-10 blur-xl opacity-30"
                      style={{ backgroundColor: gaugeBg }}
                    />
                  </div>

                  <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Target</div>
                      <div className="text-sm font-semibold text-slate-200">{(target * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Current</div>
                      <div className="text-sm font-semibold text-slate-200">
                        {typeof currentVal === 'number' ? `${(currentVal * 100).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Burn Rate</div>
                      <div className={cn('text-sm font-semibold', burnColor)}>
                        {noData ? '—' : `${burnRate.toFixed(1)}x`}
                      </div>
                      {typeof hoursLeft === 'number' && (
                        <div className="text-[10px] text-slate-500">{hoursLeft < 48 ? `${Math.round(hoursLeft)}h` : `${Math.round(hoursLeft / 24)}d`} left at this rate</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Status</div>
                      <div className={cn('text-[10px] font-bold uppercase tracking-wider', burnColor)}>
                        {burnLabel}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmEdit && !!editing}
        onClose={() => setConfirmEdit(false)}
        title={`Update SLO for ${editing?.service}?`}
        description={`Replaces the ${editing?.type} SLO for ${editing?.service} with target ${newSLO.target}% over ${newSLO.window_days} days${newSLO.description ? ` ("${newSLO.description}")` : ''}. Burn rate and budget are recomputed from the new target.`}
        confirmLabel="Update"
        variant="warning"
        onConfirm={addSLO}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete SLO"
        description={`Remove the SLO for ${confirmDelete?.service} (${confirmDelete?.type})? This stops tracking and removes the definition.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDelete && deleteSLO(confirmDelete.service, confirmDelete.type)}
      />
    </div>
  );
}
