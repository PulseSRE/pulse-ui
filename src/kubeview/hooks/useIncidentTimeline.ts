/**
 * useIncidentTimeline — aggregates alerts, events, rollouts, and config changes
 * into a unified, correlated timeline for incident analysis.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useK8sListWatch } from './useK8sListWatch';
import { k8sGet } from '../engine/query';
import { safeQuery } from '../engine/safeQuery';
import type { Event, ReplicaSet, Deployment, ClusterVersion, ClusterOperator } from '../engine/types';
import type { TimelineEntry, TimelineCategory, CorrelationGroup } from '../engine/types/timeline';
import {
  alertsToTimeline,
  eventsToTimeline,
  rolloutsToTimeline,
  configChangesToTimeline,
  correlateEntries,
  filterByTimeRange,
  resolvedAlertsToTimeline,
} from '../engine/timeline';
import { useUIStore } from '../store/uiStore';
import { useActiveClusterId } from './useClusterBase';
import { promFetch, metricsAvailableFor, queryRange } from '../components/metrics/prometheus';

export type TimeRange = '15m' | '1h' | '6h' | '24h' | '3d' | '7d';

export const TIME_RANGE_MS: Record<TimeRange, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 3600 * 1000,
  '6h': 6 * 3600 * 1000,
  '24h': 24 * 3600 * 1000,
  '3d': 3 * 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
};

interface UseIncidentTimelineOptions {
  timeRange: TimeRange;
  namespace?: string;
  categories: Set<TimelineCategory>;
}

export function useIncidentTimeline({ timeRange, namespace, categories }: UseIncidentTimelineOptions) {
  // Events: scoped to the selected namespace and filtered to the range below.
  // (The API has no time filter; a cluster-wide limit=500 dropped arbitrary
  // events, often exactly the recent ones.)
  const clusterId = useActiveClusterId();
  const eventsQuery = useK8sListWatch<Event>({
    apiPath: '/api/v1/events',
    namespace,
    enabled: categories?.has('event') ?? false,
  });
  const { data: rawEvents = [], isLoading: eventsLoading, isError: eventsError } = eventsQuery;

  // Alerts that fired and resolved within the range: ALERTS sampled over it.
  const rangeSec = Math.round(TIME_RANGE_MS[timeRange] / 1000);
  const stepSec = Math.max(30, Math.round(rangeSec / 240));
  const resolvedQuery = useQuery({
    queryKey: ['timeline', 'alerts-range', timeRange, namespace ?? '', clusterId],
    queryFn: async () => {
      const end = Math.floor(Date.now() / 1000);
      const selector = namespace ? `ALERTS{alertstate="firing",namespace="${namespace.replace(/"/g, '')}"}` : 'ALERTS{alertstate="firing"}';
      const series = await queryRange(selector, end - rangeSec, end, stepSec, clusterId);
      return resolvedAlertsToTimeline(series, end, stepSec);
    },
    refetchInterval: 60000,
    enabled: (categories?.has('alert') ?? false) && metricsAvailableFor(clusterId),
  });

  // Alerts from Prometheus
  const alertsQuery = useQuery({
    queryKey: ['timeline', 'alerts', clusterId],
    queryFn: async () => {
      const res = await promFetch('/api/v1/rules', clusterId);
      if (!res.ok) {
        // Throw: an unreachable Prometheus is "alerts unknown", not "no alerts".
        useUIStore.getState().addDegradedReason('observability_unavailable');
        throw new Error(`Prometheus returned ${res.status}`);
      }
      useUIStore.getState().removeDegradedReason('observability_unavailable');
      const json = await res.json();
      return json.data?.groups || [];
    },
    refetchInterval: 30000,
    // Local cluster only: see components/metrics/prometheus.ts.
    enabled: (categories?.has('alert') ?? false) && metricsAvailableFor(clusterId),
  });
  const { data: alertGroups = [], isLoading: alertsLoading, isError: alertsError } = alertsQuery;

  // ReplicaSets + Deployments for rollouts
  const rsQuery = useK8sListWatch<ReplicaSet>({
    apiPath: '/apis/apps/v1/replicasets',
    namespace,
    enabled: categories?.has('rollout'),
  });
  const { data: replicaSets = [], isLoading: rsLoading, isError: rsError } = rsQuery;
  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch<Deployment>({
    apiPath: '/apis/apps/v1/deployments',
    namespace,
    enabled: categories?.has('rollout'),
  });

  // ClusterVersion + ClusterOperators for config changes
  const cvQuery = useQuery({
    queryKey: ['timeline', 'clusterversion', clusterId],
    queryFn: () => safeQuery(() => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version', clusterId)),
    staleTime: 60000,
    enabled: categories?.has('config'),
  });
  const { data: clusterVersion = null, isLoading: cvLoading, isError: cvError } = cvQuery;
  const opsQuery = useK8sListWatch<ClusterOperator>({
    apiPath: '/apis/config.openshift.io/v1/clusteroperators',
    enabled: categories?.has('config'),
  });
  const { data: operators = [], isLoading: opsLoading, isError: opsError } = opsQuery;

  const isLoading = eventsLoading || alertsLoading || rsLoading || deploysLoading || cvLoading || opsLoading;

  /** Sources that were asked for and could not be read. */
  const failedSources: string[] = [
    categories?.has('alert') && (alertsError || resolvedQuery.isError) ? 'alerts (Prometheus)' : '',
    categories?.has('event') && eventsError ? 'events' : '',
    categories?.has('rollout') && rsError ? 'rollouts' : '',
    categories?.has('config') && (cvError || opsError) ? 'config changes' : '',
  ].filter(Boolean);

  // Stable string key for categories Set (React can't compare Sets in deps)
  const categoriesKey = categories instanceof Set ? [...categories].sort().join(',') : '';

  // Transform all sources into TimelineEntry[]
  const result = useMemo(() => {
    let all: TimelineEntry[] = [];

    if (categories?.has('event') && rawEvents) {
      all = all.concat(eventsToTimeline(rawEvents || []));
    }
    if (categories?.has('alert') && alertGroups) {
      all = all.concat(alertsToTimeline(alertGroups || []));
    }
    if (categories?.has('alert') && resolvedQuery.data) {
      all = all.concat(resolvedQuery.data);
    }
    if (categories?.has('rollout')) {
      all = all.concat(rolloutsToTimeline(replicaSets || [], deployments || []));
    }
    if (categories?.has('config')) {
      all = all.concat(configChangesToTimeline(clusterVersion || null, operators || []));
    }

    // Filter by namespace
    if (namespace) {
      all = all.filter(e => !e.namespace || e.namespace === namespace);
    }

    // Filter by time range
    all = filterByTimeRange(all, TIME_RANGE_MS[timeRange]);

    // Sort newest first
    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Count per category
    const counts: Record<TimelineCategory, number> = { alert: 0, event: 0, rollout: 0, config: 0 };
    for (const e of all) counts[e.category]++;

    // Correlate
    const groups = correlateEntries(all);

    return { entries: all, correlationGroups: groups, counts };
  }, [rawEvents, alertGroups, resolvedQuery.data, replicaSets, deployments, clusterVersion, operators, namespace, timeRange, categoriesKey]);

  const entries = result?.entries || [];
  const correlationGroups = result?.correlationGroups || [];
  const counts = result?.counts || { alert: 0, event: 0, rollout: 0, config: 0 };

  /** Number of categories asked for; with failedSources tells "incomplete" from "nothing could be read". */
  const requestedSources = categories instanceof Set ? categories.size : 0;
  const refetch = () => {
    for (const q of [eventsQuery, alertsQuery, resolvedQuery, rsQuery, cvQuery, opsQuery]) {
      if (q.isError) void q.refetch();
    }
  };

  return { entries, correlationGroups, counts, isLoading, failedSources, requestedSources, refetch };
}
