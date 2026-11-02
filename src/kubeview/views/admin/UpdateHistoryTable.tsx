import React from 'react';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Panel } from '../../components/primitives/Panel';
import { formatTimestamp } from '../../engine/format';
import { durationMinutes, type UpgradeHistoryEntry } from '../../engine/upgradeGraph';
import { formatMinutes, logEntryFor, type UpdateLogEntry } from '../../engine/upgradeLog';

export const HISTORY_PAGE_SIZE = 10;

/**
 * Every ClusterVersion history entry, newest first, with who started it and
 * why from the update log Pulse writes. Entries from before the log existed
 * (or started outside Pulse) say "not recorded".
 */
export function UpdateHistoryTable({ history, log, inFlight }: { history: UpgradeHistoryEntry[]; log: UpdateLogEntry[]; inFlight: boolean }) {
  const [page, setPage] = React.useState(0);
  const pages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = history.slice(current * HISTORY_PAGE_SIZE, (current + 1) * HISTORY_PAGE_SIZE);
  if (history.length === 0) return null;
  const notRecorded = <span className="text-slate-500">not recorded</span>;
  return (
    <Panel title="Update history" icon={<History className="w-4 h-4 text-slate-400" />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs" aria-label="Update history">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800">
              <th className="py-1.5 pr-3 font-medium">Version</th>
              <th className="py-1.5 pr-3 font-medium">Started</th>
              <th className="py-1.5 pr-3 font-medium">Took</th>
              <th className="py-1.5 pr-3 font-medium">Started by</th>
              <th className="py-1.5 pr-3 font-medium">Reason</th>
              <th className="py-1.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((h, i) => {
              const idx = current * HISTORY_PAGE_SIZE + i;
              const running = idx === 0 && h.state === 'Partial' && !h.completionTime && inFlight;
              const mins = durationMinutes(h.startedTime, h.completionTime);
              const entry = logEntryFor(log, h);
              return (
                <tr key={`${h.version}-${idx}`} className="align-top">
                  <td className="py-1.5 pr-3 font-mono text-slate-200">{h.version}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{formatTimestamp(h.startedTime)}</td>
                  <td className="py-1.5 pr-3 font-mono text-slate-300">{mins != null ? formatMinutes(mins) : running ? '…' : '—'}</td>
                  <td className="py-1.5 pr-3 text-slate-200">{entry ? (entry.by ?? <span className="text-slate-400">unknown user</span>) : notRecorded}</td>
                  <td className="py-1.5 pr-3 text-slate-200 break-words max-w-xs">{entry ? entry.reason : notRecorded}</td>
                  <td className={cn('py-1.5', running ? 'text-blue-300' : h.state === 'Completed' ? 'text-emerald-400' : 'text-amber-400')}>
                    {running ? 'In progress' : h.state}{h.verified === false ? ' · unverified' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-slate-400" role="navigation" aria-label="Update history pages">
          <span>{current * HISTORY_PAGE_SIZE + 1}{'–'}{current * HISTORY_PAGE_SIZE + rows.length} of {history.length}</span>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} className="px-2 py-1 rounded-sm border border-slate-700 disabled:opacity-40">Previous</button>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="px-2 py-1 rounded-sm border border-slate-700 disabled:opacity-40">Next</button>
        </div>
      )}
    </Panel>
  );
}
