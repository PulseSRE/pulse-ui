import React, { useState } from 'react';
import {
  Link2, ChevronRight, ChevronDown, Search, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { EmptyState } from '../../components/primitives/EmptyState';
import { useIncidentTimeline, type TimeRange } from '../../hooks/useIncidentTimeline';
import { useUIStore } from '../../store/uiStore';
import { useMonitorStore } from '../../store/monitorStore';
import type { InvestigationReport } from '../../engine/monitorClient';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { resourceDetailUrl } from '../../engine/gvr';
import type { TimelineEntry, TimelineCategory, CorrelationGroup } from '../../engine/types/timeline';

const TIME_RANGES: TimeRange[] = ['15m', '1h', '6h', '24h', '3d', '7d'];

const CATEGORY_LABELS: Record<TimelineCategory, string> = {
  alert: 'Alerts',
  event: 'Events',
  rollout: 'Rollouts',
  config: 'Config',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  normal: 'bg-slate-500',
};

function InvestigationCard({ report }: { report: InvestigationReport }) {
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = (report.evidence && report.evidence.length > 0) || (report.alternativesConsidered && report.alternativesConsidered.length > 0);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        <span className={cn('px-1.5 py-0.5 rounded', report.status === 'completed' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300')}>
          {report.status}
        </span>
        <span>{report.category}</span>
        {report.confidence != null && report.confidence > 0 && (
          <span
            className={cn(
              'font-mono',
              report.confidence >= 0.8 ? 'text-green-400' : report.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400',
            )}
            title={`Agent confidence in this diagnosis: ${Math.round(report.confidence * 100)}%`}
            aria-label={`Agent confidence: ${Math.round(report.confidence * 100)}%`}
          >
            {Math.round(report.confidence * 100)}% confidence
          </span>
        )}
        <span>-</span>
        <span>{new Date(report.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="text-sm text-slate-200">{report.summary || 'Investigation completed'}</div>
      {report.suspectedCause && (
        <div className="text-xs text-slate-400 mt-1">Cause: {report.suspectedCause}</div>
      )}
      {report.recommendedFix && (
        <div className="text-xs text-slate-400 mt-1">Suggested fix: {report.recommendedFix}</div>
      )}
      {hasReasoning && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2 transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Show reasoning
        </button>
      )}
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-slate-700 space-y-2">
          {report.evidence && report.evidence.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-400 mb-1">Evidence</div>
              <ul className="space-y-0.5">
                {report.evidence.map((e, i) => (
                  <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                    <span className="text-emerald-500 shrink-0">+</span>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.alternativesConsidered && report.alternativesConsidered.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-400 mb-1">Alternatives ruled out</div>
              <ul className="space-y-0.5">
                {report.alternativesConsidered.map((a, i) => (
                  <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                    <span className="text-slate-600 shrink-0">-</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InvestigateTab() {
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  const [timeRange, setTimeRange] = useState<TimeRange>('6h');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const categories = React.useMemo(
    () => new Set<TimelineCategory>(['alert', 'event', 'rollout', 'config']),
    [],
  );

  const timeline = useIncidentTimeline({ timeRange, namespace: nsFilter, categories });
  const correlationGroups = timeline.correlationGroups || [];
  const investigations = useMonitorStore((s) => s.investigations);
  const findings = useMonitorStore((s) => s.findings);
  const latestInvestigations = React.useMemo(
    () => [...investigations]
      .filter((report) => {
        if (!nsFilter) return true;
        const finding = findings.find((item) => item.id === report.findingId);
        return Boolean(finding?.resources?.some((resource) => resource.namespace === nsFilter));
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5),
    [findings, investigations, nsFilter],
  );

  const filteredGroups = React.useMemo(() => {
    if (!searchQuery) return correlationGroups;
    const q = searchQuery.toLowerCase();
    return correlationGroups.filter(
      (g) =>
        g.key.toLowerCase().includes(q) ||
        g.entries.some(
          (e) => e.title.toLowerCase().includes(q) || (e.detail || '').toLowerCase().includes(q),
        ),
    );
  }, [correlationGroups, searchQuery]);

  const handleEntryClick = (entry: TimelineEntry) => {
    if (entry.resource) {
      const path = resourceDetailUrl({
        apiVersion: entry.resource.apiVersion,
        kind: entry.resource.kind,
        metadata: { name: entry.resource.name, namespace: entry.resource.namespace },
      });
      go(path, entry.resource.name);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-100">AI Root Cause Investigations</h2>
        </div>
        {latestInvestigations.length > 0 ? (
          <div className="divide-y divide-slate-800">
            {latestInvestigations.map((report) => (
              <InvestigationCard key={report.id} report={report} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <div className="text-sm text-slate-400 font-medium">No investigations yet</div>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              When the monitor detects a critical finding (crashlooping pods, OOM kills, failed deployments),
              the AI automatically investigates the root cause. Results appear here with evidence,
              suspected cause, and recommended fix.
            </p>
          </div>
        )}
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Card className="flex gap-1 p-1">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn(
                'px-3 py-1.5 text-xs rounded transition-colors',
                timeRange === range ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {range}
            </button>
          ))}
        </Card>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search correlation groups..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>{filteredGroups.length} correlated incidents</span>
        <span>-</span>
        <span>{timeline.entries?.length || 0} total entries</span>
        {filteredGroups.filter((g) => g.severity === 'critical').length > 0 && (
          <>
            <span>-</span>
            <span className="text-red-400">
              {filteredGroups.filter((g) => g.severity === 'critical').length} critical
            </span>
          </>
        )}
      </div>

      {/* Correlation groups */}
      {timeline.isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="text-slate-500 text-sm">Loading correlation data...</span>
        </div>
      ) : filteredGroups.length === 0 ? (
        <EmptyState
          icon={<Info className="w-8 h-8" />}
          title="No correlated incidents"
          description="No correlation patterns detected in this time window. Adjust the time range or wait for more events."
        />
      ) : (
        <Card>
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-violet-400" />
              Correlation Groups ({filteredGroups.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-800">
            {filteredGroups.map((group) => (
              <CorrelationGroupRow
                key={group.key}
                group={group}
                expanded={expandedGroup === group.key}
                onToggle={() => setExpandedGroup(expandedGroup === group.key ? null : group.key)}
                onEntryClick={handleEntryClick}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function CorrelationGroupRow({
  group,
  expanded,
  onToggle,
  onEntryClick,
}: {
  group: CorrelationGroup;
  expanded: boolean;
  onToggle: () => void;
  onEntryClick: (entry: TimelineEntry) => void;
}) {
  const categoryCounts = new Map<TimelineCategory, number>();
  for (const e of group.entries || []) {
    categoryCounts.set(e.category, (categoryCounts.get(e.category) || 0) + 1);
  }
  const label = (group.key || '').split('/').slice(0, 2).join(' / ');
  const ns = (group.key || '').split('/')[2];

  const severityColor: Record<string, string> = {
    critical: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-blue-400',
    normal: 'text-slate-400',
  };

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              group.severity === 'critical' ? 'bg-red-500' : group.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500',
            )}
          />
          <span className={cn('text-sm font-medium', severityColor[group.severity] || 'text-slate-400')}>
            {label}
          </span>
          {ns && ns !== '_' && <span className="text-xs text-slate-600">{ns}</span>}
        </div>
        <div className="flex items-center gap-2">
          {Array.from(categoryCounts.entries()).map(([cat, count]) => (
            <span key={cat} className="flex items-center gap-1 text-xs text-slate-500">
              {CATEGORY_LABELS[cat]} {count}
            </span>
          ))}
          <span className="text-xs text-slate-600">{group.entries.length} entries</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 ml-7">
          {group.entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-3 p-2 rounded text-sm',
                entry.resource && 'cursor-pointer hover:bg-slate-800/50',
              )}
              role={entry.resource ? 'button' : undefined}
              tabIndex={entry.resource ? 0 : undefined}
              onClick={() => entry.resource && onEntryClick(entry)}
              onKeyDown={entry.resource ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEntryClick(entry); } } : undefined}
            >
              <span className="text-xs text-slate-600 w-16 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', SEVERITY_DOT[entry.severity] || 'bg-slate-500')} />
              <span className="text-slate-300 truncate">{entry.title}</span>
              <span className="text-xs text-slate-600 shrink-0">{CATEGORY_LABELS[entry.category]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
