import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentFetch } from '../../engine/safeQuery';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';

export function SLOTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newSLO, setNewSLO] = useState({ service: '', type: 'availability', target: '99.9', window_days: '30', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<{ service: string; type: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['slo-status'],
    queryFn: async () => {
      const res = await agentFetch('/api/agent/slo');
      if (!res.ok) return { slos: [], total: 0 };
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const slos = data?.slos ?? [];

  const addSLO = async () => {
    if (!newSLO.service.trim()) return;
    try {
      await agentFetch('/api/agent/slo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: newSLO.service,
          type: newSLO.type,
          target: parseFloat(newSLO.target) / 100,
          window_days: parseInt(newSLO.window_days),
          description: newSLO.description,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['slo-status'] });
      setShowAdd(false);
      setNewSLO({ service: '', type: 'availability', target: '99.9', window_days: '30', description: '' });
    } catch { /* ignore */ }
  };

  const deleteSLO = async (service: string, type: string) => {
    try {
      await agentFetch(`/api/agent/slo/${encodeURIComponent(service)}/${encodeURIComponent(type)}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['slo-status'] });
    } catch { /* ignore */ }
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

      {/* Add SLO form */}
      {showAdd && (
        <div className="bg-slate-900 border border-teal-800/50 rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-medium text-slate-200">New Service Level Objective</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Service Name</label>
              <input
                value={newSLO.service}
                onChange={(e) => setNewSLO({ ...newSLO, service: e.target.value })}
                placeholder="e.g., checkout-api"
                className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">Type</label>
              <select
                value={newSLO.type}
                onChange={(e) => setNewSLO({ ...newSLO, type: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              >
                <option value="availability">Availability</option>
                <option value="latency">Latency (p99)</option>
                <option value="error_rate">Error Rate</option>
              </select>
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
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={addSLO} className="px-3 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-md">Create SLO</button>
          </div>
        </div>
      )}

      {/* SLO list */}
      {slos.length === 0 && !showAdd ? (
        <div className="text-center py-12">
          <TrendingUp className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No SLOs defined yet</p>
          <p className="text-xs text-slate-500 mt-1">Add a Service Level Objective to track error budget burn rate from live Prometheus data.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {slos.map((slo: Record<string, unknown>) => {
            const budgetPct = Math.round((slo.error_budget_remaining as number) * 100);
            const alertLevel = slo.alert_level as string;
            const burnRate = (slo.burn_rate as number) || 0;
            const target = (slo.target as number) || 0;
            const currentVal = slo.current_value as number | undefined;
            const windowDays = slo.window_days as number;
            const description = slo.description as string | undefined;

            const gaugeColor = alertLevel === 'critical' ? '#ef4444' : alertLevel === 'warning' ? '#f59e0b' : '#10b981';
            const gaugeBg = alertLevel === 'critical' ? 'rgba(239,68,68,0.08)' : alertLevel === 'warning' ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)';
            const fillDeg = Math.round((budgetPct / 100) * 270);

            const burnLabel = burnRate > 2 ? 'CRITICAL' : burnRate > 1 ? 'ELEVATED' : 'NORMAL';
            const burnColor = burnRate > 2 ? 'text-red-400' : burnRate > 1 ? 'text-amber-400' : 'text-emerald-400';

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
                <button
                  onClick={() => setConfirmDelete({ service: String(slo.service), type: String(slo.type) })}
                  className="absolute top-3 right-3 text-slate-700 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-start gap-2.5 mb-4 pr-6">
                  <div className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0 mt-1',
                    alertLevel === 'critical' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
                    alertLevel === 'warning' ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]' :
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
                      <span className="text-lg font-bold text-slate-100 leading-none">{budgetPct}%</span>
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
                        {currentVal ? `${(currentVal * 100).toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">Burn Rate</div>
                      <div className={cn('text-sm font-semibold', burnColor)}>
                        {burnRate.toFixed(2)}x
                      </div>
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
