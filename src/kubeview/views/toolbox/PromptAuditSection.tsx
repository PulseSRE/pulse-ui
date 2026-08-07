import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Hash, Database, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatCard } from './StatCard';

interface PromptStats {
  avg_tokens: number;
  cache_hit_rate: number;
  static_chars: number;
  dynamic_chars: number;
  avg_static_chars: number;
  avg_dynamic_chars: number;
  total_prompts: number;
  section_avg: Record<string, number>;
  skill_names?: string[];
}

interface PromptVersion {
  prompt_hash: string;
  label: string;
  first_seen: string;
  last_seen: string;
  count: number;
  duration_days: number;
  skill_version: number;
  avg_tokens: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_cache_read: number;
  static_chars: number;
  avg_dynamic_chars: number;
  is_current: boolean;
  sections?: Record<string, number>;
  total_static_chars?: number;
}

export function PromptAuditSection() {
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const { data: promptStats, isLoading } = useQuery({
    queryKey: ['admin', 'prompt-stats'],
    queryFn: async () => {
      const res = await fetch('/api/agent/prompt/stats?days=30');
      if (!res.ok) return null;
      return res.json() as Promise<PromptStats>;
    },
    refetchInterval: 30_000,
  });

  const { data: promptVersions, isLoading: versionsLoading } = useQuery({
    queryKey: ['admin', 'prompt-versions', selectedSkill],
    queryFn: async () => {
      if (!selectedSkill) return null;
      const res = await fetch(`/api/agent/prompt/versions/${encodeURIComponent(selectedSkill)}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ versions: PromptVersion[] }>;
    },
    enabled: !!selectedSkill,
  });

  if (isLoading) {
    return (
      <div className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          Prompt Audit (30 days)
        </h2>
        <div className="flex justify-center py-8"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>
      </div>
    );
  }

  if (!promptStats) return null;

  const sectionEntries = Object.entries(promptStats.section_avg || {}).sort(([, a], [, b]) => b - a);
  const sc = promptStats.avg_static_chars || promptStats.static_chars || 0;
  const dc = promptStats.avg_dynamic_chars || promptStats.dynamic_chars || 0;
  const staticDynamic = sc + dc > 0
    ? `${Math.round((sc / (sc + dc)) * 100)}% / ${Math.round((dc / (sc + dc)) * 100)}%`
    : '- / -';

  const skillNames = Array.isArray(promptStats.skill_names)
    ? promptStats.skill_names
    : [...new Set(sectionEntries.map(([name]) => name.split('.')[0]).filter(Boolean))];

  return (
    <div className="border-t border-slate-800 pt-6 space-y-4">
      <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        Prompt Audit (30 days)
      </h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Avg Prompt Tokens" value={promptStats.avg_tokens.toLocaleString()} icon={<Hash className="w-4 h-4 text-cyan-400" />} />
        <StatCard label="Cache Hit Rate" value={`${(promptStats.cache_hit_rate * 100).toFixed(1)}%`} icon={<Database className="w-4 h-4 text-emerald-400" />} />
        <StatCard label="Static / Dynamic" value={staticDynamic} icon={<BarChart3 className="w-4 h-4 text-violet-400" />} />
        <StatCard label="Prompts Logged" value={promptStats.total_prompts.toLocaleString()} icon={<FileText className="w-4 h-4 text-blue-400" />} />
      </div>

      {/* Section Breakdown */}
      {sectionEntries.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-slate-300 mb-3">Section Breakdown</h3>
          <div className="space-y-1">
            {sectionEntries.map(([name, avgChars]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-mono truncate mr-2">{name}</span>
                <span className="text-slate-400 whitespace-nowrap">{Math.round(avgChars).toLocaleString()} chars avg</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Versions */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-medium text-slate-300 mb-3">Prompt Version History</h3>
        <p className="text-xs text-slate-500 mb-3">Track how skill prompts evolve — token costs, size changes, and active periods.</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {skillNames.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedSkill(selectedSkill === name ? null : name)}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-md transition-colors',
                selectedSkill === name
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200',
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {selectedSkill && (
          <div>
            {versionsLoading ? (
              <div className="flex justify-center py-4"><div className="kv-skeleton w-6 h-6 rounded-full" /></div>
            ) : promptVersions && promptVersions.versions.length > 0 ? (
              <div className="space-y-2">
                {promptVersions.versions.map((v, idx) => {
                  const prev = promptVersions.versions[idx + 1];
                  const tokenDelta = prev ? v.avg_tokens - prev.avg_tokens : 0;
                  const sizeDelta = prev && v.total_static_chars && prev.total_static_chars
                    ? v.total_static_chars - prev.total_static_chars
                    : 0;

                  return (
                    <div key={v.prompt_hash} className="bg-slate-800/50 rounded-lg px-4 py-3 space-y-2">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-sm font-medium',
                            v.is_current
                              ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/40'
                              : 'bg-slate-700/50 text-slate-400',
                          )}>
                            {v.label || `v${promptVersions.versions.length - idx}`}
                          </span>
                          <span className="text-[10px] text-slate-500">skill v{v.skill_version}</span>
                          {v.is_current && <span className="text-[10px] text-emerald-500">current</span>}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>{v.count} turn{v.count !== 1 ? 's' : ''}</span>
                          <span>{v.duration_days > 0 ? `${v.duration_days}d active` : 'today'}</span>
                        </div>
                      </div>

                      {/* Metrics row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        <span className="text-slate-300">
                          {v.avg_tokens.toLocaleString()} tokens avg
                          {tokenDelta !== 0 && (
                            <span className={cn('ml-1', tokenDelta > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                              ({tokenDelta > 0 ? '+' : ''}{tokenDelta.toLocaleString()})
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500">
                          {v.avg_input_tokens.toLocaleString()} in / {v.avg_output_tokens.toLocaleString()} out
                        </span>
                        {v.avg_cache_read > 0 && (
                          <span className="text-emerald-500">{v.avg_cache_read.toLocaleString()} cached</span>
                        )}
                        {v.total_static_chars != null && (
                          <span className="text-slate-500">
                            {(v.total_static_chars / 1000).toFixed(1)}k chars
                            {sizeDelta !== 0 && (
                              <span className={cn('ml-1', sizeDelta > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                                ({sizeDelta > 0 ? '+' : ''}{(sizeDelta / 1000).toFixed(1)}k)
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Date range */}
                      <div className="text-[10px] text-slate-600">
                        {new Date(v.first_seen).toLocaleDateString()} — {new Date(v.last_seen).toLocaleDateString()}
                        <span className="ml-2 font-mono text-slate-700">{v.prompt_hash?.slice(0, 8)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500 text-center py-4">No version data for {selectedSkill}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
