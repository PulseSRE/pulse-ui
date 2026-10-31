import React from 'react';
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Event, Condition } from '../../engine/types';
import { Card } from '../../components/primitives/Card';
import { TabsList, TabsTrigger } from '../../components/primitives/Tabs';

export const DETAIL_TABS = ['overview', 'conditions', 'events'] as const;
export type DetailTab = typeof DETAIL_TABS[number];

interface DetailViewTabsProps {
  conditions: Condition[];
  eventCount: number;
}

/** The tab bar for a resource's detail page. Render inside a `<Tabs>` root. */
export function DetailViewTabBar({ conditions, eventCount }: DetailViewTabsProps) {
  return (
    <TabsList aria-label="Detail tabs" className="flex w-fit">
      {DETAIL_TABS.map((tab) => (
        <TabsTrigger key={tab} value={tab} className="px-4 font-normal capitalize">
          {tab === 'events' ? `Events (${eventCount})` : tab === 'conditions' ? `Conditions (${conditions.length})` : tab}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

interface ConditionsTableProps {
  conditions: Condition[];
}

export function ConditionsTable({ conditions }: ConditionsTableProps) {
  return (
    <Card>
      {conditions.length === 0 ? (
        <div className="px-4 py-8 text-center text-slate-500 text-sm">No conditions reported for this resource</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 w-8"></th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Reason</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Last Transition</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {conditions.map((cond, idx) => {
                const isGood = (cond.type === 'Ready' || cond.type === 'Available' || cond.type === 'Initialized' || cond.type === 'PodScheduled' || cond.type === 'ContainersReady') ? cond.status === 'True' : cond.type.includes('Pressure') || cond.type === 'Degraded' ? cond.status !== 'True' : cond.status === 'True';
                return (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">
                      {isGood ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                    </td>
                    <td className="px-4 py-2.5 text-slate-200 font-medium">{cond.type}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('text-xs px-2 py-0.5 rounded-sm', isGood ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>
                        {cond.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{cond.reason || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {cond.lastTransitionTime ? new Date(cond.lastTransitionTime).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400 max-w-xs truncate" title={cond.message}>
                      {cond.message || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface EventsListProps {
  events: Event[];
}

export function EventsList({ events }: EventsListProps) {
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Events ({events.length})
        </h2>
      </div>
      <div className="divide-y divide-slate-800 max-h-[500px] overflow-auto">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 text-xs">No events found</div>
        ) : (
          events.map((event, idx) => {
            const timestamp = event.lastTimestamp || event.firstTimestamp || '';
            const type = event.type || 'Normal';
            return (
              <div key={idx} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  {type === 'Warning' ? <AlertCircle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className="text-xs text-slate-500 mb-0.5">{timestamp ? new Date(timestamp).toLocaleString() : ''}</div>
                    <div className="text-xs font-medium text-slate-200">{event.reason}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{event.message}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
