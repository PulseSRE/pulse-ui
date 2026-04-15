import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, BookOpen, TrendingUp, Search, ChevronDown, ChevronRight, ThumbsUp, Zap, History, Target, FileText, Activity, Award, Download, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../components/primitives/Card';
import { EmptyState } from '../components/primitives/EmptyState';
import { formatRelativeTime } from '../engine/formatters';

const AGENT_BASE = '/api/agent';

interface Runbook {
  name: string;
  description: string;
  tool_sequence: string[];
  success_count: number;
  total_count: number;
  trigger_keywords?: string[];
}

interface Pattern {
  pattern_type: string;
  description: string;
  keywords: string[];
  frequency: number;
}

interface Incident {
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

async function fetchSummary(): Promise<MemorySummary> {
  const res = await fetch(`${AGENT_BASE}/memory/summary`);
  if (!res.ok) throw new Error('Failed to fetch summary');
  return await res.json();
}

async function fetchRunbooks(): Promise<Runbook[]> {
  const res = await fetch(`${AGENT_BASE}/memory/runbooks`);
  if (!res.ok) throw new Error('Failed to fetch runbooks');
  return (await res.json()).runbooks || [];
}

async function fetchPatterns(): Promise<Pattern[]> {
  const res = await fetch(`${AGENT_BASE}/memory/patterns`);
  if (!res.ok) throw new Error('Failed to fetch patterns');
  return (await res.json()).patterns || [];
}

async function fetchIncidents(search = ''): Promise<Incident[]> {
  const params = new URLSearchParams({ limit: '20' });
  if (search) params.set('search', search);
  const res = await fetch(`${AGENT_BASE}/memory/incidents?${params}`);
  if (!res.ok) throw new Error('Failed to fetch incidents');
  return (await res.json()).incidents || [];
}

type Tab = 'runbooks' | 'patterns' | 'incidents';

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

  const { data: runbooks = [], isLoading: rbLoading } = useQuery({
    queryKey: ['memory', 'runbooks'],
    queryFn: fetchRunbooks,
    staleTime: 30_000,
  });

  const { data: patterns = [], isLoading: patLoading } = useQuery({
    queryKey: ['memory', 'patterns'],
    queryFn: fetchPatterns,
    staleTime: 30_000,
  });

  const { data: incidents = [], isLoading: incLoading } = useQuery({
    queryKey: ['memory', 'incidents', search],
    queryFn: () => fetchIncidents(search),
    staleTime: 15_000,
  });

  const handleExport = async () => {
    try {
      const res = await fetch(`${AGENT_BASE}/memory/export`);
      if (!res.ok) {
        setImportStatus({ type: 'error', message: 'Export failed' });
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pulse-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportStatus({ type: 'error', message: 'Export failed' });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch(`${AGENT_BASE}/memory/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        setImportStatus({ type: 'error', message: 'Import failed' });
        return;
      }
      const result = await res.json();
      setImportStatus({
        type: 'success',
        message: `Imported ${result.runbooks_imported ?? 0} runbooks, ${result.patterns_imported ?? 0} patterns`,
      });
    } catch {
      setImportStatus({ type: 'error', message: 'Invalid JSON file' });
    }
    // Reset file input so the same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const tabs: { id: Tab; label: string; count: number; icon: typeof Brain }[] = [
    { id: 'runbooks', label: 'Learned Runbooks', count: runbooks.length, icon: BookOpen },
    { id: 'patterns', label: 'Detected Patterns', count: patterns.length, icon: TrendingUp },
    { id: 'incidents', label: 'Incident History', count: incidents.length, icon: History },
  ];

  const TAB_DESCRIPTIONS: Record<Tab, { title: string; description: string }> = {
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export Memory
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors"
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
              'text-xs px-2 py-1 rounded',
              importStatus.type === 'success' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300',
            )}>
              {importStatus.message}
            </span>
          )}
        </div>

        {/* Summary Cards */}
        {!embedded && summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
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
            <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
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
            <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
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
            <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
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

        {/* Runbooks Tab */}
        {activeTab === 'runbooks' && (
          <div className="space-y-3">
            {rbLoading && <div className="text-sm text-slate-500 animate-pulse">Loading runbooks...</div>}
            {!rbLoading && runbooks.length === 0 && (
              <EmptyState
                icon={<BookOpen className="w-10 h-10 text-slate-600" />}
                title="No runbooks learned yet"
                description="When you give thumbs up on a helpful agent response that used 2+ tools, the tool sequence is extracted as a reusable runbook. Try asking the agent to diagnose an issue, then give it a thumbs up."
              />
            )}
            {runbooks.map((rb) => {
              const successRate = getSuccessRate(rb.success_count, rb.total_count);
              return (
                <Card key={rb.name} className="p-4">
                  <div className="flex items-start gap-3">
                    <BookOpen className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-200">{rb.name}</h3>
                          <p className="text-xs text-slate-400 mt-1">{rb.description}</p>
                        </div>
                        <span className={cn('text-xs px-2 py-0.5 rounded shrink-0', getSuccessRateColor(successRate))}>
                          {successRate.toFixed(0)}% success
                        </span>
                      </div>
                      {Array.isArray(rb.trigger_keywords) && rb.trigger_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {rb.trigger_keywords.map((kw, i) => (
                            <span key={i} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {rb.tool_sequence.map((tool, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-slate-600">→</span>}
                            <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded font-mono border border-blue-800/50">
                              {tool}
                            </span>
                          </div>
                        ))}
                      </div>
                      {expandedRunbook === rb.name && (
                        <div className="mt-3 pt-3 border-t border-slate-700">
                          <div className="text-xs text-slate-500 space-y-1">
                            <div>Success: {rb.success_count} / {rb.total_count} invocations</div>
                            <div>Tools: {rb.tool_sequence.length} steps</div>
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
            {!patLoading && patterns.length === 0 && (
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
                        <span className={cn('text-xs px-2 py-0.5 rounded font-medium shrink-0', getPatternTypeColor(pat.pattern_type))}>
                          {pat.pattern_type}
                        </span>
                      </div>
                      {pat.keywords && (Array.isArray(pat.keywords) ? pat.keywords : [pat.keywords]).length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(Array.isArray(pat.keywords) ? pat.keywords : [pat.keywords]).map((kw: string, j: number) => (
                            <span key={j} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
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
                className="w-full bg-slate-900 border border-slate-700 rounded px-9 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                aria-label="Search incidents"
              />
            </div>
            {incLoading && <div className="text-sm text-slate-500 animate-pulse">Loading incidents...</div>}
            {!incLoading && incidents.length === 0 && (
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
                              'text-xs px-2 py-0.5 rounded',
                              inc.outcome === 'resolved' ? 'bg-emerald-900/50 text-emerald-300' :
                              inc.outcome === 'unresolved' ? 'bg-red-900/50 text-red-300' :
                              'bg-slate-800 text-slate-400',
                            )}>
                              {inc.outcome}
                            </span>
                          )}
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
                                  <span key={j} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
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
