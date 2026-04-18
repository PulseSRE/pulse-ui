import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bot, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchFixHistorySummary,
  fetchScannerCoverage,
  fetchAgentHealth,
  fetchCapabilities,
  fetchAgentVersion,
  fetchAgentActivity,
  type ActivityEvent,
} from '../../engine/analyticsApi';
import { TrustPolicy } from '../mission-control/TrustPolicy';
import { ScannerDrawer } from '../mission-control/ScannerDrawer';

export function OverviewTab() {
  const [scannerDrawerOpen, setScannerDrawerOpen] = useState(false);

  const healthQ = useQuery({ queryKey: ['agent', 'health'], queryFn: fetchAgentHealth, refetchInterval: 30_000 });
  const fixQ = useQuery({ queryKey: ['agent', 'fix-history-summary'], queryFn: () => fetchFixHistorySummary(), staleTime: 60_000 });
  const coverageQ = useQuery({ queryKey: ['agent', 'scanner-coverage'], queryFn: () => fetchScannerCoverage(), staleTime: 60_000 });
  const capQ = useQuery({ queryKey: ['agent', 'capabilities'], queryFn: fetchCapabilities, staleTime: 60_000 });
  const versionQ = useQuery({ queryKey: ['agent', 'version'], queryFn: fetchAgentVersion, staleTime: 5 * 60_000 });
  const activityQ = useQuery({ queryKey: ['agent', 'activity'], queryFn: () => fetchAgentActivity(7), staleTime: 60_000 });

  const scannerCount = coverageQ.data?.active_scanners ?? 0;
  const totalFindings = (fixQ.data?.completed ?? 0) + (fixQ.data?.failed ?? 0) + (fixQ.data?.rolled_back ?? 0);
  const cbState = healthQ.data?.circuit_breaker?.state?.toLowerCase();
  const isDegraded = cbState === 'open';

  return (
    <div className="space-y-6">
      {/* 1. Status Sentence */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4">
        <StatusSentence
          isDegraded={isDegraded}
          scannerCount={scannerCount}
          totalFindings={totalFindings}
          fixedCount={fixQ.data?.completed ?? 0}
          needsAttention={(fixQ.data?.failed ?? 0) + (fixQ.data?.rolled_back ?? 0)}
          onScannerClick={() => setScannerDrawerOpen(true)}
        />
      </div>

      {/* 2. Recent Activity */}
      <ActivitySection events={activityQ.data?.events ?? []} isLoading={activityQ.isLoading} />

      {/* 3. Trust Controls */}
      <TrustPolicy
        maxTrustLevel={capQ.data?.max_trust_level ?? 0}
        scannerCount={scannerCount}
        fixSummary={fixQ.data ?? null}
        supportedAutoFixCategories={capQ.data?.supported_auto_fix_categories}
      />

      {/* 4. Agent Info Footer */}
      {versionQ.data && (
        <div className="text-xs text-slate-600 flex items-center gap-1.5 justify-center py-2">
          <Bot className="w-3 h-3" />
          <span>v{versionQ.data.agent}</span>
          <span>&middot;</span>
          <span>Protocol v{versionQ.data.protocol}</span>
          <span>&middot;</span>
          <Link to="/agent?tab=tools" className="text-slate-500 hover:text-slate-300">{versionQ.data.tools} tools</Link>
          <span>&middot;</span>
          <Link to="/agent?tab=skills" className="text-slate-500 hover:text-slate-300">{versionQ.data.skills} skills</Link>
        </div>
      )}

      {scannerDrawerOpen && <ScannerDrawer coverage={coverageQ.data ?? null} onClose={() => setScannerDrawerOpen(false)} />}
    </div>
  );
}

function StatusSentence({
  isDegraded, scannerCount, totalFindings, fixedCount, needsAttention, onScannerClick,
}: {
  isDegraded: boolean; scannerCount: number; totalFindings: number;
  fixedCount: number; needsAttention: number; onScannerClick: () => void;
}) {
  if (isDegraded) {
    return (
      <p className="text-sm text-red-300">
        Pulse is <span className="font-medium text-red-400">degraded</span> &mdash; circuit breaker is open. Check agent logs.
      </p>
    );
  }

  if (totalFindings > 0) {
    return (
      <p className="text-sm text-slate-300">
        Pulse detected{' '}
        <Link to="/incidents" className="text-blue-400 hover:underline">{totalFindings} issue{totalFindings !== 1 ? 's' : ''}</Link>
        {' '}this week.{' '}
        {fixedCount > 0 && (
          <><Link to="/incidents?tab=actions" className="text-emerald-400 hover:underline">{fixedCount} auto-fixed</Link>{needsAttention > 0 ? ', ' : '.'}</>
        )}
        {needsAttention > 0 && (
          <Link to="/incidents?tab=actions" className="text-amber-400 hover:underline">{needsAttention} need{needsAttention === 1 ? 's' : ''} attention</Link>
        )}
      </p>
    );
  }

  return (
    <p className="text-sm text-slate-300">
      Pulse is monitoring your cluster.{' '}
      <button onClick={onScannerClick} className="text-blue-400 hover:underline">{scannerCount} scanners</button>
      {' '}active, no issues detected.
    </p>
  );
}

const EVENT_COLORS: Record<string, string> = {
  auto_fix: 'text-emerald-400',
  fix_failed: 'text-red-400',
  rollback: 'text-amber-400',
  self_healed: 'text-blue-400',
  postmortem: 'text-teal-400',
  investigation: 'text-slate-400',
};

function ActivitySection({ events, isLoading }: { events: ActivityEvent[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h2>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-slate-800 rounded w-3/4" />
          <div className="h-4 bg-slate-800 rounded w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h2>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet. The agent is monitoring but hasn&apos;t needed to intervene.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((evt, i) => (
            <li key={i}>
              <Link
                to={evt.link}
                className={cn('text-sm hover:underline flex items-center gap-2', EVENT_COLORS[evt.type] ?? 'text-slate-300')}
              >
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                {evt.description}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
