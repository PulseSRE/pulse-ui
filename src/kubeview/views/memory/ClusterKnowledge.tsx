import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Gauge, GraduationCap, Plus, Trash2, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { EmptyState } from '../../components/primitives/EmptyState';
import { formatRelativeTime } from '../../engine/formatters';

const AGENT_BASE = '/api/agent';

export interface EnvironmentFact {
  scope: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  updatedAt: number;
}

export interface WorkloadBaseline {
  namespace: string;
  workload: string;
  metric: string;
  p50: number;
  p95: number;
  sampleCount: number;
  windowHours: number;
  reliable: boolean;
  updatedAt: number;
}

export interface LearningStats {
  pending: number;
  promoted: number;
  discarded: number;
  expired: number;
}

async function fetchFacts(): Promise<EnvironmentFact[]> {
  const res = await fetch(`${AGENT_BASE}/memory/environment`);
  if (!res.ok) throw new Error('Failed to load environment facts');
  return (await res.json()).facts || [];
}

async function fetchBaselines(namespace: string): Promise<WorkloadBaseline[]> {
  if (!namespace) return [];
  const params = new URLSearchParams({ namespace });
  const res = await fetch(`${AGENT_BASE}/memory/baselines?${params}`);
  if (!res.ok) throw new Error('Failed to load baselines');
  return (await res.json()).baselines || [];
}

async function fetchLearning(): Promise<LearningStats> {
  const res = await fetch(`${AGENT_BASE}/memory/learning`);
  if (!res.ok) throw new Error('Failed to load learning stats');
  return await res.json();
}

/** Compact a byte/count value the way an operator writes it. */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}G`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.round(value * 100) / 100}`;
}

export default function ClusterKnowledge() {
  const queryClient = useQueryClient();
  const [namespace, setNamespace] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ scope: 'cluster', key: '', value: '' });

  const facts = useQuery({ queryKey: ['env-facts'], queryFn: fetchFacts });
  const baselines = useQuery({
    queryKey: ['baselines', namespace],
    queryFn: () => fetchBaselines(namespace),
    enabled: namespace.length > 0,
  });
  const learning = useQuery({ queryKey: ['learning-stats'], queryFn: fetchLearning });

  const addFact = useMutation({
    mutationFn: async (fact: { scope: string; key: string; value: string }) => {
      const res = await fetch(`${AGENT_BASE}/memory/environment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fact, source: 'operator' }),
      });
      if (!res.ok) throw new Error('Failed to save');
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['env-facts'] });
      setDraft({ scope: 'cluster', key: '', value: '' });
      setShowAdd(false);
    },
  });

  const removeFact = useMutation({
    mutationFn: async (fact: EnvironmentFact) => {
      const res = await fetch(
        `${AGENT_BASE}/memory/environment/${encodeURIComponent(fact.scope)}/${encodeURIComponent(fact.key)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to delete');
      return await res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['env-facts'] }),
  });

  const factList = facts.data || [];
  const byScope = factList.reduce<Record<string, EnvironmentFact[]>>((acc, fact) => {
    (acc[fact.scope] ||= []).push(fact);
    return acc;
  }, {});

  const stats = learning.data;
  const totalJudged = stats ? stats.promoted + stats.discarded : 0;
  const promotionRate = totalJudged > 0 ? Math.round(((stats?.promoted ?? 0) / totalJudged) * 100) : null;

  return (
    <div className="space-y-6">
      {/* ── Learning gate ─────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <GraduationCap className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-slate-200">Verified learning</div>
            <p className="text-xs text-slate-400 mt-0.5">
              A diagnosis only becomes a reusable skill once the fix it proposed is confirmed to have
              resolved the problem. Diagnoses whose fix did not hold are discarded, not learned.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Awaiting outcome', value: stats?.pending ?? 0, tone: 'text-sky-300' },
            { label: 'Learned', value: stats?.promoted ?? 0, tone: 'text-emerald-300' },
            { label: 'Discarded', value: stats?.discarded ?? 0, tone: 'text-amber-300' },
            { label: 'Expired unverified', value: stats?.expired ?? 0, tone: 'text-slate-400' },
          ].map((s) => (
            <div key={s.label} className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2">
              <div className={cn('text-xl font-semibold tabular-nums', s.tone)}>{s.value}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {promotionRate !== null && (
          <div className="text-xs text-slate-400 mt-3">
            {promotionRate}% of judged trajectories were worth learning from
            <span className="text-slate-500"> ({totalJudged} judged)</span>
          </div>
        )}
      </Card>

      {/* ── Environment facts ─────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3">
            <Building2 className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-slate-200">What Pulse knows about this cluster</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Ownership, retention windows, GitOps topology, local conventions. Correct anything that is
                wrong — the agent uses these instead of re-deriving them every investigation.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="shrink-0 inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1
                       text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2
                       focus-visible:ring-sky-500"
          >
            <Plus className="w-3 h-3" /> Add fact
          </button>
        </div>

        {showAdd && (
          <div className="grid gap-2 sm:grid-cols-[8rem_10rem_1fr_auto] mb-4">
            <input
              value={draft.scope}
              onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
              placeholder="scope"
              aria-label="Scope"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
            <input
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              placeholder="key"
              aria-label="Fact key"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
            <input
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              placeholder="what is true"
              aria-label="Fact value"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
            <button
              type="button"
              disabled={!draft.key.trim() || !draft.value.trim() || addFact.isPending}
              onClick={() => addFact.mutate(draft)}
              className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white
                         disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-500"
            >
              {addFact.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        {factList.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Nothing recorded yet"
            description="Pulse records facts as it learns them, and you can add them directly. Until then it treats this cluster like any other."
          />
        ) : (
          <div className="space-y-4">
            {Object.entries(byScope)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([scope, entries]) => (
                <div key={scope}>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{scope}</div>
                  <div className="divide-y divide-slate-800 rounded border border-slate-800">
                    {entries.map((fact) => (
                      <div key={fact.key} className="flex items-start gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-200">{fact.key}</div>
                          <div className="text-xs text-slate-300 mt-0.5 break-words">{fact.value}</div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {fact.source ? `via ${fact.source}` : 'source unknown'}
                            {fact.updatedAt ? ` · ${formatRelativeTime(fact.updatedAt)}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Forget ${fact.key}`}
                          onClick={() => removeFact.mutate(fact)}
                          className="shrink-0 rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </Card>

      {/* ── Baselines ─────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <Gauge className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-200">What normal looks like</div>
            <p className="text-xs text-slate-400 mt-0.5">
              Learned per workload, so a reading can be reported as “three times this service’s normal”
              rather than a number you have to interpret.
            </p>
          </div>
        </div>

        <input
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          placeholder="namespace"
          aria-label="Namespace"
          className="mb-3 w-full sm:w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1
                     text-xs text-slate-200"
        />

        {!namespace ? (
          <p className="text-xs text-slate-500">Enter a namespace to see its learned baselines.</p>
        ) : baselines.isLoading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (baselines.data || []).length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={`No baselines for ${namespace}`}
            description="Baselines build up as Pulse observes a workload. Until one exists, readings are reported as raw values."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[34rem]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-1.5 pr-3 font-medium">Workload</th>
                  <th className="py-1.5 pr-3 font-medium">Metric</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Normal (p50)</th>
                  <th className="py-1.5 pr-3 font-medium text-right">p95</th>
                  <th className="py-1.5 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(baselines.data || []).map((b) => (
                  <tr key={`${b.workload}:${b.metric}`}>
                    <td className="py-1.5 pr-3 text-slate-200">{b.workload}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{b.metric}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-200">
                      {formatMetricValue(b.p50)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">
                      {formatMetricValue(b.p95)}
                    </td>
                    <td className="py-1.5">
                      {b.reliable ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <Check className="w-3 h-3" /> {b.sampleCount} samples
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="w-3 h-3" /> only {b.sampleCount} — not used yet
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
