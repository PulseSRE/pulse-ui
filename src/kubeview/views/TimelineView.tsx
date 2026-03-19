import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { K8sResource } from '../engine/renderers';
import { resourceDetailUrl } from '../engine/gvr';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useUIStore } from '../store/uiStore';
import { useK8sListWatch } from '../hooks/useK8sListWatch';

type TimeRange = '1h' | '6h' | '24h';
type EventFilter = 'all' | 'warnings' | 'normal';

export default function TimelineView() {
  const navigate = useNavigate();
  const go = useNavigateTab();
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const [timeRange, setTimeRange] = React.useState<TimeRange>('6h');
  const [eventFilter, setEventFilter] = React.useState<EventFilter>('all');

  // Watch all events (initial fetch is limited, watch streams updates)
  const { data: allEvents = [], isLoading } = useK8sListWatch<K8sResource>({
    apiPath: '/api/v1/events?limit=500',
  });

  // Apply namespace filter
  const events = React.useMemo(() => {
    if (selectedNamespace === '*') return allEvents;
    return allEvents.filter((e) => (e as any).metadata?.namespace === selectedNamespace);
  }, [allEvents, selectedNamespace]);

  // Filter events by time range and type
  const filteredEvents = React.useMemo(() => {
    const now = Date.now();
    const ranges: Record<TimeRange, number> = {
      '1h': 3600000,
      '6h': 21600000,
      '24h': 86400000,
    };
    const cutoff = now - ranges[timeRange];

    let filtered = events.filter((event) => {
      const timestamp = (event as any).lastTimestamp || (event as any).firstTimestamp;
      if (!timestamp) return false;
      return new Date(timestamp).getTime() >= cutoff;
    });

    // Apply event type filter
    if (eventFilter === 'warnings') {
      filtered = filtered.filter((e) => (e as any).type === 'Warning');
    } else if (eventFilter === 'normal') {
      filtered = filtered.filter((e) => (e as any).type === 'Normal');
    }

    // Sort by timestamp descending
    return filtered.sort((a, b) => {
      const aTime = (a as any).lastTimestamp || (a as any).firstTimestamp || '';
      const bTime = (b as any).lastTimestamp || (b as any).firstTimestamp || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [events, timeRange, eventFilter]);

  // Group events by date
  const groupedEvents = React.useMemo(() => {
    const groups: Record<string, K8sResource[]> = {};

    for (const event of filteredEvents) {
      const timestamp = (event as any).lastTimestamp || (event as any).firstTimestamp;
      if (!timestamp) continue;

      const date = new Date(timestamp);
      const dateKey = getDateKey(date);

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(event);
    }

    return groups;
  }, [filteredEvents]);

  const handleEventClick = (event: K8sResource) => {
    const eventAny = event as any;
    const involvedObject = eventAny.involvedObject || {};
    const name = involvedObject.name;
    const kind = involvedObject.kind;
    const namespace = involvedObject.namespace;
    const apiVersion = involvedObject.apiVersion || 'v1';

    if (!name || !kind) return;

    const path = resourceDetailUrl({ apiVersion, kind, metadata: { name, namespace } });
    go(path, name);
  };

  return (
    <div className="h-full overflow-auto bg-slate-950">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-500" />
              Cluster Timeline
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Chronological event feed ({filteredEvents.length} events)
            </p>
          </div>
          <div className="flex gap-2">
            {/* Time Range */}
            <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1">
              {(['1h', '6h', '24h'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded transition-colors',
                    timeRange === range
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {range}
                </button>
              ))}
            </div>
            {/* Event Filter */}
            <div className="flex gap-1 bg-slate-900 rounded-lg border border-slate-800 p-1">
              {(['all', 'warnings', 'normal'] as EventFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setEventFilter(filter)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded transition-colors capitalize',
                    eventFilter === filter
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-slate-500 text-sm">Loading events...</div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Info className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No events found</p>
              <p className="text-slate-500 text-xs mt-1">
                Try adjusting the time range or filters
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedEvents).map(([dateKey, dateEvents]) => (
              <div key={dateKey}>
                {/* Date header */}
                <div className="sticky top-0 z-10 bg-slate-950 py-2 mb-3">
                  <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
                    {dateKey}
                  </h2>
                </div>

                {/* Events for this date */}
                <div className="space-y-3">
                  {dateEvents.map((event, idx) => {
                    const eventAny = event as any;
                    const timestamp =
                      eventAny.lastTimestamp || eventAny.firstTimestamp || '';
                    const type = eventAny.type || 'Normal';
                    const reason = eventAny.reason || '';
                    const message = eventAny.message || '';
                    const involvedObject = eventAny.involvedObject || {};
                    const namespace = involvedObject.namespace;
                    const objectName = involvedObject.name || '';
                    const objectKind = involvedObject.kind || '';

                    const hasObject = objectName && objectKind;

                    return (
                      <div
                        key={idx}
                        className={cn(
                          'bg-slate-900 rounded-lg border border-slate-800 p-4',
                          hasObject && 'cursor-pointer hover:border-slate-700 transition-colors'
                        )}
                        onClick={() => hasObject && handleEventClick(event)}
                      >
                        <div className="flex items-start gap-3">
                          {/* Icon */}
                          <div className="flex-shrink-0 mt-0.5">
                            {type === 'Warning' ? (
                              <AlertCircle className="w-5 h-5 text-yellow-500" />
                            ) : reason.includes('Failed') || reason.includes('Error') ? (
                              <XCircle className="w-5 h-5 text-red-500" />
                            ) : (
                              <CheckCircle className="w-5 h-5 text-green-500" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            {/* Timestamp */}
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs text-slate-500">
                                {timestamp
                                  ? new Date(timestamp).toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    })
                                  : 'Unknown time'}
                              </span>
                              {type === 'Warning' && (
                                <span className="px-1.5 py-0.5 text-xs bg-yellow-900/50 text-yellow-300 rounded">
                                  Warning
                                </span>
                              )}
                            </div>

                            {/* Involved Object */}
                            {hasObject && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs text-slate-400">{objectKind}</span>
                                <span className="text-sm font-semibold text-blue-400">
                                  {objectName}
                                </span>
                                {namespace && (
                                  <span className="text-xs text-slate-500">
                                    in {namespace}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Reason */}
                            <div className="text-sm font-medium text-slate-200 mb-1">
                              {reason}
                            </div>

                            {/* Message */}
                            <div className="text-sm text-slate-400">{message}</div>
                          </div>

                          {/* Type badge */}
                          <div className="flex-shrink-0">
                            <span
                              className={cn(
                                'text-xs px-2 py-1 rounded',
                                type === 'Warning'
                                  ? 'bg-yellow-900/30 text-yellow-400'
                                  : 'bg-slate-800 text-slate-400'
                              )}
                            >
                              {type}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more indicator (simple version) */}
        {filteredEvents.length >= 500 && (
          <div className="text-center py-4">
            <p className="text-xs text-slate-500">
              Showing first 500 events. Adjust time range to see more.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper: Get date key for grouping
function getDateKey(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDate.getTime() === today.getTime()) {
    return 'Today';
  }
  if (eventDate.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  }

  // Format as "Month Day, Year"
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
