import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, BookOpen, TrendingUp, Search, ChevronDown, ChevronRight, Zap, History, Target, Activity, Award, Download, Upload, Building2, Trash2, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../components/primitives/Card';
import { EmptyState } from '../components/primitives/EmptyState';
import { LoadError } from '../components/primitives/LoadError';
import { agentJson } from '../engine/safeQuery';
import { formatRelativeTime } from '../engine/formatters';
import ClusterKnowledge from './memory/ClusterKnowledge';

const AGENT_BASE = '/api/agent';

interface Runbook {
  id: number;
  name: string;
  description: string;
  tool_sequence?: string[] | string;
  success_count: number;
  total_count: number;
  trigger_keywords?: string[];
}

interface Pattern {
  id: number;
  pattern_type: string;
  description: string;
  keywords: string[];
  frequency: number;
}

interface Incident {
  id: number;
  query: string;
  resolution: string;
  outcome: string;
  score: number;
  timestamp?: number;
  tools_used?: string[];
}

interface MemorySummary {
  incidents_count: number;
  runbooks_count: number;
  patterns_count: number;
  avg_score: number;
}

/** A memory list plus whether memory is switched on at all. */
interface MemoryList<T> {
  items: T[];
  enabled: boolean;
}

async function fetchSummary(): Promise<MemorySummary> {
  return agentJson<MemorySummary>(`${AGENT_BASE}/memory/summary`);
}

async function fetchList<T>(kind: 'runbooks' | 'patterns' | 'incidents', params?: URLSearchParams): Promise<MemoryList<T>> {
  const data = await agentJson<Record<string, unknown>>(`${AGENT_BASE}/memory/${kind}${params ? `?${params}` : ''}`);
  return { items: (data[kind] as T[]) || [], enabled: data.enabled !== false };
}

function fetchIncidents(search = ''): Promise<MemoryList<Incident>> {
  const params = new URLSearchParams({ limit: '20' });
  if (search) params.set('search', search);
  return fetchList<Incident>('incidents', params);
}

/** Forget one learned row. Admin-only on the agent; a refusal is shown, not swallowed. */
async function forgetRow(kind: 'runbooks' | 'patterns' | 'incidents', id: number): Promise<void> {
  await agentJson(`${AGENT_BASE}/memory/${kind}/${id}`, { method: 'DELETE' });
}

type Tab = 'cluster' | 'runbooks' | 'patterns' | 'incidents';

export default function MemoryView({ embedded = false }: { embedded?: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>('incidents');
  const [search, setSearch] = useState('');
  const [expandedRunbook, setExpandedRunbook] = useState<string | null>(null);
  const [expandedIncident, setExpandedIncident] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto-dismiss import status after 5 seconds
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => setImportStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [importStatus]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: summary } = useQuery({
    queryKey: ['memory', 'summary'],
    queryFn: fetchSummary,
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const runbooksQuery = useQuery({
    queryKey: ['memory', 'runbooks'],
    queryFn: () => fetchList<Runbook>('runbooks'),
    staleTime: 30_000,
  });
  const patternsQuery = useQuery({
    queryKey: ['memory', 'patterns'],
    queryFn: () => fetchList<Pattern>('patterns'),
    staleTime: 30_000,
  });
  const incidentsQuery = useQuery({
    queryKey: ['memory', 'incidents', search],
    queryFn: () => fetchIncidents(search),
    staleTime: 15_000,
  });
  const runbooks = runbooksQuery.data?.items ?? [];
  const patterns = patternsQuery.data?.items ?? [];
  const incidents = incidentsQuery.data?.items ?? [];
  const rbLoading = runbooksQuery.isLoading;
  const patLoading = patternsQuery.isLoading;
  const incLoading = incidentsQuery.isLoading;
  // Memory switched off on the agent: say so, rather than "nothing learned yet".
  const memoryOff = [runbooksQuery, patternsQuery, incidentsQuery].some((q) => q.data && !q.data.enabled);

  const forget = useMutation({
    mutationFn: ({ kind, id }: { kind: 'runbooks' | 'patterns' | 'incidents'; id: number }) => forgetRow(kind, id),
    onSuccess: (_data, { kind }) => {
      queryClient.invalidateQueries({ queryKey: ['memory', kind] });
      queryClient.invalidateQueries({ queryKey: ['memory', 'summary'] });
    },
  });
  const forgetButton = (kind: 'runbooks' | 'patterns' | 'incidents', id: number | undefined, label: string) =>
    typeof id === 'number' ? (
      <button
        type="button"
        aria-label={`Forget ${label}`}
        title="Forget this — it taught the wrong lesson"
        disabled={forget.isPending}
        onClick={() => {
          if (window.confirm(`Forget ${label}? The agent will stop using it.`)) forget.mutate({ kind, id });
        }}
        className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    ) : null;

  const handleExport = async () => {
    try {
      const data = await agentJson(`${AGENT_BASE}/memory/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pulse-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('memory export failed:', e);
      setImportStatus({ type: 'error', message: e instanceof Error ? `Export failed: ${e.message}` : 'Export failed' });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        setImportStatus({ type: 'error', message: 'Invalid JSON file' });
        return;
      }
      // The agent answers imported_runbooks / imported_patterns; the UI read
      // runbooks_imported and always reported 0.
      const result = await agentJson<{ imported_runbooks?: number; imported_patterns?: number }>(
        `${AGENT_BASE}/memory/import`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      );
      setImportStatus({
        type: 'success',
        message: `Imported ${result.imported_runbooks ?? 0} runbooks, ${result.imported_patterns ?? 0} patterns`,
      });
      queryClient.invalidateQueries({ queryKey: ['memory'] });
    } catch (e) {
      console.error('memory import failed:', e);
      setImportStatus({ type: 'error', message: e instanceof Error ? e.message : 'Import failed' });
    } finally {
      // Reset file input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const tabs: { id: Tab; label: string; count: number; icon: typeof Brain }[] = [
    { id: 'cluster', label: 'This Cluster', count: 0, icon: Building2 },
    { id: 'runbooks', label: 'Learned Runbooks', count: runbooks.length, icon: BookOpen },
    { id: 'patterns', label: 'Detected Patterns', count: patterns.length, icon: TrendingUp },
    { id: 'incidents', label: 'Incident History', count: incidents.length, icon: History },
  ];

  const TAB_DESCRIPTIONS: Record<Tab, { title: string; description: string }> = {
    cluster: {
      title: 'This Cluster',
      description: 'What Pulse knows about your environment specifically — ownership, retention, conventions — and what normal looks like for each workload. Also shows which diagnoses have been confirmed by a working fix, since only those become reusable skills.',
    },
    runbooks: {
      title: 'Learned Runbooks',
      description: 'When you give thumbs up on a helpful response, the agent extracts the tool sequence as a reusable runbook. Next time it encounters a similar issue, it will suggest these steps first.',
    },
    patterns: {
      title: 'Detected Patterns',
      description: 'After every 10 incidents, the agent analyzes history for recurring keyword clusters and time-based patterns. These help it predict issues before they happen.',
    },
    incidents: {
      title: 'Incident History',
      description: 'Every interaction is scored on resolution (40%), efficiency (30%), safety (20%), and speed (10%). The agent uses similar past incidents to inform future diagnoses.',
    },
  };

  const getSuccessRate = (successCount: number, totalCount: number) => {
    if (totalCount === 0) return 0;
    return (successCount / totalCount) * 100;
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate > 80) return 'bg-emerald-900/50 text-emerald-300';
    if (rate > 50) return 'bg-amber-900/50 text-amber-300';
    return 'bg-red-900/50 text-red-300';
  };

  const getPatternTypeColor = (type: string) => {
    if (type === 'recurring') return 'bg-amber-900/50 text-amber-300';
    if (type === 'time-based') return 'bg-blue-900/50 text-blue-300';
    if (type === 'correlation') return 'bg-violet-900/50 text-violet-300';
    return 'bg-slate-800 text-slate-400';
  };

  return (
    <div className={embedded ? '' : 'h-full overflow-auto bg-slate-950 p-6'}>
      <div className={embedded ? 'space-y-6' : 'max-w-5xl mx-auto space-y-6'}>
        {/* Header — hidden when embedded as a tab */}
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Brain className="w-6 h-6 text-blue-500" />
              Agent Memory
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              The agent learns from every interaction. Give thumbs up on helpful responses to teach it reusable runbooks.
            </p>
          </div>
        )}

        {/* Export / Import */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export Memory
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-sm transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Memory
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
            aria-label="Import memory file"
          />
          {importStatus && (
            <span className={cn(
              'text-xs px-2 py-1 rounded-sm',
              importStatus.type === 'success' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300',
            )}>
              {importStatus.message}
            </span>
          )}
        </div>

        {memoryOff && (
          <div role="status" className="flex items-start gap-3 rounded border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm">
            <PowerOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <div>
              <div className="font-medium text-amber-200">Agent memory is switched off</div>
              <div className="mt-0.5 text-xs text-amber-300/80">
                Nothing is being recorded or learned. It is enabled with PULSE_AGENT_MEMORY on the agent.
              </div>
            </div>
          </div>
        )}
        {forget.isError && <LoadError title="Could not forget that item" error={forget.error} onRetry={() => forget.reset()} />}

        {/* Summary Cards */}
        {!embedded && summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-linear-to-br from-slate-900 to-slate-800 border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <History className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-100">{summary.incidents_count}</div>
                  <div className="text-xs text-slate-400">Incidents</div>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-linear-to-br from-slate-900 to-slate-800 border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <BookOpen className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-100">{summary.runbooks_count}</div>
                  <div className="text-xs text-slate-400">Runbooks</div>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-linear-to-br from-slate-900 to-slate-800 border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-500/10 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-100">{summary.patterns_count}</div>
                  <div className="text-xs text-slate-400">Patterns</div>
                </div>
              </div>
            </Card>
            <Card className="p-4 bg-linear-to-br from-slate-900 to-slate-800 border-slate-700">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Award className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-100">{summary.avg_score.toFixed(1)}</div>
                  <div className="text-xs text-slate-400">Avg Score / 10</div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'text-violet-400 border-violet-500'
                  : 'text-slate-500 border-transparent hover:text-slate-300',
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.count > 0 && (
                <span className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab description */}
        <div className="flex items-start gap-3 px-4 py-3 bg-slate-900/50 rounded-lg border border-slate-800/50">
          <Zap className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-slate-200">{TAB_DESCRIPTIONS[activeTab].title}</div>
            <p className="text-xs text-slate-400 mt-0.5">{TAB_DESCRIPTIONS[activeTab].description}</p>
          </div>
        </div>

        {/* This Cluster Tab */}
        {activeTab === 'cluster' && <ClusterKnowledge />}

        {/* Runbooks Tab */}
        {activeTab === 'runbooks' && (
          <div className="space-y-3">
            {rbLoading && <div className="text-sm text-slate-500 animate-pulse">Loading runbooks...</div>}
            {runbooksQuery.isError && (
              <LoadError title="Learned runbooks could not be loaded" error={runbooksQuery.error} onRetry={() => runbooksQuery.refetch()} />
            )}
            {!rbLoading && !runbooksQuery.isError && !memoryOff && runbooks.length === 0 && (
              <EmptyState
                icon={<BookOpen className="w-10 h-10 text-slate-600" />}
                title="No runbooks learned yet"
                description="When you give thumbs up on a helpful agent response that used 2+ tools, the tool sequence is extracted as a reusable runbook. Try asking the agent to diagnose an issue, then give it a thumbs up."
              />
            )}
            {runbooks.map((rb) => {
              const successRate = getSuccessRate(rb.success_count, rb.total_count);
              return (
                <Card key={rb.id ?? rb.name} className="p-4">
                  <div className="flex items-start gap-3">
                    <BookOpen className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-200">{rb.name}</h3>
                          <p className="text-xs text-slate-400 mt-1">{rb.description}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={cn('text-xs px-2 py-0.5 rounded-sm', getSuccessRateColor(successRate))}>
                            {successRate.toFixed(0)}% success
                          </span>
                          {forgetButton('runbooks', rb.id, `runbook ${rb.name}`)}
                        </div>
                      </div>
                      {Array.isArray(rb.trigger_keywords) && rb.trigger_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {rb.trigger_keywords.map((kw, i) => (
                            <span key={i} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-sm">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                      {Array.isArray(rb.tool_sequence) && rb.tool_sequence.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {rb.tool_sequence.map((tool, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-slate-600">→</span>}
                            <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded-sm font-mono border border-blue-800/50">
                              {tool}
                            </span>
                          </div>
                        ))}
                      </div>
                      )}
                      {expandedRunbook === rb.name && (
                        <div className="mt-3 pt-3 border-t border-slate-700">
                          <div className="text-xs text-slate-500 space-y-1">
                            <div>Success: {rb.success_count} / {rb.total_count} invocations</div>
                            <div>Tools: {Array.isArray(rb.tool_sequence) ? rb.tool_sequence.length : 0} steps</div>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => setExpandedRunbook(expandedRunbook === rb.name ? null : rb.name)}
                        className="text-xs text-blue-400 hover:text-blue-300 mt-2 flex items-center gap-1"
                      >
                        {expandedRunbook === rb.name ? (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            Hide details
                          </>
                        ) : (
                          <>
                            <ChevronRight className="w-3 h-3" />
                            Show details
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Patterns Tab */}
        {activeTab === 'patterns' && (
          <div className="space-y-3">
            {patLoading && <div className="text-sm text-slate-500 animate-pulse">Loading patterns...</div>}
            {patternsQuery.isError && (
              <LoadError title="Detected patterns could not be loaded" error={patternsQuery.error} onRetry={() => patternsQuery.refetch()} />
            )}
            {!patLoading && !patternsQuery.isError && !memoryOff && patterns.length === 0 && (
              <EmptyState
                icon={<TrendingUp className="w-10 h-10 text-slate-600" />}
                title="No patterns detected yet"
                description="Patterns are detected automatically after every 10 incidents. Keep using the agent and patterns will emerge from your interaction history."
              />
            )}
            {patterns.map((pat, i) => {
              // Clean up description - remove JSON artifacts
              const cleanDescription = pat.description
                .replace(/^["']|["']$/g, '')
                .replace(/\\n/g, ' ')
                .trim();

              return (
                <Card key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <Activity className="w-5 h-5 text-violet-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm text-slate-200">{cleanDescription}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={cn('text-xs px-2 py-0.5 rounded-sm font-medium', getPatternTypeColor(pat.pattern_type))}>
                            {pat.pattern_type}
                          </span>
                          {forgetButton('patterns', pat.id, 'this pattern')}
                        </div>
                      </div>
                      {pat.keywords && (Array.isArray(pat.keywords) ? pat.keywords : [pat.keywords]).length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(Array.isArray(pat.keywords) ? pat.keywords : [pat.keywords]).map((kw: string, j: number) => (
                            <span key={j} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-sm border border-slate-700">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                      {pat.frequency > 0 && (
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <Target className="w-3 h-3" />
                          Detected {pat.frequency}x
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Incidents Tab */}
        {activeTab === 'incidents' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search past incidents by keyword..."
                className="w-full bg-slate-900 border border-slate-700 rounded-sm px-9 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-hidden focus:border-blue-500"
                aria-label="Search incidents"
              />
            </div>
            {incLoading && <div className="text-sm text-slate-500 animate-pulse">Loading incidents...</div>}
            {incidentsQuery.isError && (
              <LoadError title="Incident history could not be loaded" error={incidentsQuery.error} onRetry={() => incidentsQuery.refetch()} />
            )}
            {!incLoading && !incidentsQuery.isError && !memoryOff && incidents.length === 0 && (
              <EmptyState
                icon={<History className="w-10 h-10 text-slate-600" />}
                title={search ? 'No matching incidents' : 'No incidents recorded yet'}
                description={search ? 'Try a different search term.' : 'Every agent interaction is automatically recorded and scored. Start chatting with the agent to build your incident history.'}
              />
            )}
            {incidents.map((inc, i) => {
              const isExpanded = expandedIncident === i;
              const scoreRaw = inc.score ?? 0;
              const scoreValue = scoreRaw <= 1 ? scoreRaw * 10 : scoreRaw; // Normalize 0-1 → 0-10
              const scorePercent = scoreValue * 10; // Convert 0-10 scale to 0-100%

              return (
                <Card key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <History className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-sm text-slate-200 flex-1 line-clamp-2">
                          {inc.query.length > 120 ? `${inc.query.slice(0, 120)}...` : inc.query}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {inc.outcome && inc.outcome !== 'unknown' && (
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-sm',
                              inc.outcome === 'resolved' ? 'bg-emerald-900/50 text-emerald-300' :
                              inc.outcome === 'unresolved' ? 'bg-red-900/50 text-red-300' :
                              'bg-slate-800 text-slate-400',
                            )}>
                              {inc.outcome}
                            </span>
                          )}
                          {forgetButton('incidents', inc.id, 'this incident')}
                        </div>
                      </div>

                      {/* Score bar */}
                      <div className="mb-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-xs text-slate-400 cursor-help border-b border-dotted border-slate-600"
                            title="Resolution (40%): Was the issue resolved? · Efficiency (30%): 2-5 tool calls is optimal · Safety (20%): No rejected actions · Speed (10%): Under 60s is full marks"
                          >Quality</span>
                          <span className={cn(
                            'text-xs font-mono font-semibold',
                            scoreValue >= 8 ? 'text-emerald-400' :
                            scoreValue >= 5 ? 'text-amber-400' :
                            'text-red-400',
                          )}>
                            {scoreValue.toFixed(1)}/10
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full transition-all',
                              scoreValue >= 8 ? 'bg-emerald-500' :
                              scoreValue >= 5 ? 'bg-amber-500' :
                              'bg-red-500',
                            )}
                            style={{ width: `${scorePercent}%` }}
                          />
                        </div>
                      </div>

                      {inc.timestamp && !isNaN(Number(inc.timestamp)) && Number(inc.timestamp) > 0 && (
                        <div className="text-xs text-slate-500 mb-2">
                          {formatRelativeTime(Number(inc.timestamp))}
                        </div>
                      )}

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
                          {inc.resolution && (
                            <div>
                              <div className="text-xs font-medium text-slate-400 mb-1">Resolution</div>
                              <p className="text-xs text-slate-300">{inc.resolution}</p>
                            </div>
                          )}
                          {inc.tools_used && inc.tools_used.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-slate-400 mb-1">Tools Used</div>
                              <div className="flex flex-wrap gap-1">
                                {inc.tools_used.map((tool, j) => (
                                  <span key={j} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-sm font-mono">
                                    {tool}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="text-xs text-slate-500">
                            Score weights: resolution 40% · efficiency 30% · safety 20% · speed 10%
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => setExpandedIncident(isExpanded ? null : i)}
                        className="text-xs text-blue-400 hover:text-blue-300 mt-2 flex items-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            Hide details
                          </>
                        ) : (
                          <>
                            <ChevronRight className="w-3 h-3" />
                            Show details
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
