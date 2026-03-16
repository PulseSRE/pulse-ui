/**
 * Example usage of OpenShiftView metrics components
 *
 * This file demonstrates how to integrate all metrics components together
 * to create a complete monitoring view.
 */

import React, { useState, useEffect } from 'react';
import {
  MetricsChart,
  PromQLEditor,
  CorrelatedTimeline,
  getMetricsForResource,
  resolveQuery,
  formatYAxisValue,
  buildNarrative,
  groupEvents,
} from './index';
import type { ChartSeries, TimelineEvent, NarrativeEvent } from './index';

const PROM_BASE = '/api/prometheus';

interface PrometheusResult {
  metric: Record<string, string>;
  values: [number, string][];
}

/**
 * Example: Pod Metrics View
 */
export function PodMetricsExample() {
  const [query, setQuery] = useState('');
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const [timeRange, setTimeRange] = useState<[number, number]>([
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000),
  ]);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Fetch metrics from Prometheus
  const fetchMetrics = async (promQuery: string) => {
    setLoading(true);
    try {
      const [start, end] = timeRange;
      const step = Math.max(15, Math.floor((end - start) / 200));

      const url = `${PROM_BASE}/api/v1/query_range?query=${encodeURIComponent(promQuery)}&start=${start}&end=${end}&step=${step}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.status === 'success' && json.data?.result) {
        const newSeries: ChartSeries[] = json.data.result.map((result: PrometheusResult, i: number) => ({
          id: `series-${i}`,
          label: result.metric.__name__ || `Series ${i + 1}`,
          color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5],
          data: result.values.map(([timestamp, value]) => ({
            timestamp,
            value: parseFloat(value),
          })),
        }));

        setSeries(newSeries);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = (q: string) => {
    if (!q) return;
    setQueryHistory([q, ...queryHistory.filter((h) => h !== q).slice(0, 9)]);
    fetchMetrics(q);
  };

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-xl font-semibold">Pod Metrics</h2>

      {/* Query Editor */}
      <PromQLEditor
        value={query}
        onChange={setQuery}
        onExecute={handleExecute}
        history={queryHistory}
        loading={loading}
      />

      {/* Time Range Selector */}
      <div className="flex gap-2 text-sm">
        <button
          onClick={() => setTimeRange([Math.floor(Date.now() / 1000) - 3600, Math.floor(Date.now() / 1000)])}
          className="px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600"
        >
          1h
        </button>
        <button
          onClick={() => setTimeRange([Math.floor(Date.now() / 1000) - 21600, Math.floor(Date.now() / 1000)])}
          className="px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600"
        >
          6h
        </button>
        <button
          onClick={() => setTimeRange([Math.floor(Date.now() / 1000) - 86400, Math.floor(Date.now() / 1000)])}
          className="px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600"
        >
          24h
        </button>
      </div>

      {/* Metrics Chart */}
      {series.length > 0 && (
        <MetricsChart
          series={series}
          height={300}
          timeRange={timeRange}
          yAxisLabel="Value"
          yAxisFormat={(v) => formatYAxisValue(v, 'count')}
          showLegend={true}
          onHover={setHoverTime}
          hoverTimestamp={hoverTime}
        />
      )}

      {/* Example: Auto-detect metrics for a resource */}
      <AutoMetricsExample />
    </div>
  );
}

/**
 * Example: Auto Metrics for a Pod
 */
export function AutoMetricsExample() {
  const [cpuSeries, setCpuSeries] = useState<ChartSeries[]>([]);
  const [memorySeries, setMemorySeries] = useState<ChartSeries[]>([]);

  const podResource = {
    metadata: {
      name: 'nginx-deployment-abc123',
      namespace: 'default',
    },
  };

  useEffect(() => {
    // Get auto-generated queries for this pod
    const queries = getMetricsForResource('v1/pods', podResource);
    const cpuQuery = queries.find((q) => q.id === 'pod-cpu');
    const memoryQuery = queries.find((q) => q.id === 'pod-memory');

    if (cpuQuery) {
      const resolved = resolveQuery(cpuQuery.query, {
        name: podResource.metadata.name,
        namespace: podResource.metadata.namespace || '',
      });
      console.log('CPU Query:', resolved);
      // Fetch and set CPU series...
    }

    if (memoryQuery) {
      const resolved = resolveQuery(memoryQuery.query, {
        name: podResource.metadata.name,
        namespace: podResource.metadata.namespace || '',
      });
      console.log('Memory Query:', resolved);
      // Fetch and set memory series...
    }
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Auto-Generated Metrics</h3>
      <p className="text-sm text-slate-400">
        Automatically generated metrics for Pod: {podResource.metadata.namespace}/{podResource.metadata.name}
      </p>
      {/* Charts would go here */}
    </div>
  );
}

/**
 * Example: Correlation View
 */
export function CorrelationViewExample() {
  const [timeRange, setTimeRange] = useState<[number, number]>([
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000),
  ]);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const events: TimelineEvent[] = [
    {
      timestamp: timeRange[0] + 300,
      label: 'Pod Created',
      type: 'event',
      color: '#10b981',
    },
    {
      timestamp: timeRange[0] + 600,
      label: 'Image Pulled',
      type: 'change',
      color: '#f59e0b',
    },
    {
      timestamp: timeRange[0] + 900,
      label: 'High CPU Alert',
      type: 'alert',
      color: '#ef4444',
    },
  ];

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-xl font-semibold">Correlation View</h2>

      {/* Timeline */}
      <CorrelatedTimeline
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        onHoverTime={setHoverTime}
        hoverTime={hoverTime}
        events={events}
      />

      {/* Multiple charts synchronized by hover time */}
      <div className="space-y-4">
        <MetricsChart
          series={[
            {
              id: 'cpu',
              label: 'CPU',
              color: '#3b82f6',
              data: generateMockData(timeRange),
            },
          ]}
          height={200}
          timeRange={timeRange}
          yAxisLabel="CPU Cores"
          yAxisFormat={(v) => formatYAxisValue(v, 'cores')}
          hoverTimestamp={hoverTime}
          onHover={setHoverTime}
        />

        <MetricsChart
          series={[
            {
              id: 'memory',
              label: 'Memory',
              color: '#10b981',
              data: generateMockData(timeRange),
            },
          ]}
          height={200}
          timeRange={timeRange}
          yAxisLabel="Memory"
          yAxisFormat={(v) => formatYAxisValue(v, 'bytes')}
          hoverTimestamp={hoverTime}
          onHover={setHoverTime}
        />
      </div>
    </div>
  );
}

/**
 * Example: Incident Narrative
 */
export function NarrativeExample() {
  const k8sEvents = [
    {
      timestamp: '2024-01-01T10:00:00Z',
      reason: 'Pulled',
      message: 'Successfully pulled image "nginx:1.20"',
      involvedObject: { kind: 'Pod', name: 'nginx-abc123' },
    },
    {
      timestamp: '2024-01-01T10:01:00Z',
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      involvedObject: { kind: 'Pod', name: 'nginx-abc123' },
    },
    {
      timestamp: '2024-01-01T10:01:30Z',
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      involvedObject: { kind: 'Pod', name: 'nginx-abc123' },
    },
  ];

  const narrative = buildNarrative({ events: k8sEvents });
  const groups = groupEvents(narrative.events);

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-xl font-semibold">Incident Narrative</h2>

      <div className="bg-slate-800 rounded p-4">
        <h3 className="font-medium mb-2">Summary</h3>
        <p className="text-sm text-slate-300">{narrative.summary}</p>

        {narrative.rootCause && (
          <>
            <h3 className="font-medium mt-4 mb-2">Root Cause</h3>
            <p className="text-sm text-amber-400">{narrative.rootCause}</p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Timeline</h3>
        {groups.map((group, i) => (
          <div key={i} className="bg-slate-800 rounded p-3">
            <h4 className="text-sm font-medium text-slate-400 mb-2">{group.title}</h4>
            <div className="space-y-1">
              {group.events.map((event, j) => (
                <div key={j} className="text-sm flex items-start gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full mt-1 ${
                      event.type === 'action' ? 'bg-blue-500' :
                      event.type === 'symptom' ? 'bg-red-500' :
                      'bg-green-500'
                    }`}
                  />
                  <div>
                    <div className="text-slate-200">{event.description}</div>
                    {event.detail && (
                      <div className="text-xs text-slate-400">{event.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper to generate mock data for examples
function generateMockData(timeRange: [number, number]) {
  const [start, end] = timeRange;
  const points = 50;
  const step = (end - start) / points;

  return Array.from({ length: points }, (_, i) => ({
    timestamp: start + i * step,
    value: Math.random() * 100,
  }));
}
