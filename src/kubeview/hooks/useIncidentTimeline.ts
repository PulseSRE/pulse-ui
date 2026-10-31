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
} from '../engine/timeline';
import { useUIStore } from '../store/uiStore';
import { useActiveClusterId } from './useClusterBase';
import { promFetch, metricsAvailableFor } from '../components/metrics/prometheus';

export type TimeRange = '15m' | '1h' | '6h' | '24h' | '3d' | '7d';

const TIME_RANGE_MS: Record<TimeRange, number> = {
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
  // Events
  const clusterId = useActiveClusterId();
  const { data: rawEvents = [], isLoading: eventsLoading, isError: eventsError } = useK8sListWatch<Event>({
    apiPath: '/api/v1/events?limit=500',
    enabled: categories?.has('event') ?? false,
  });

  // Alerts from Prometheus
  const { data: alertGroups = [], isLoading: alertsLoading, isError: alertsError } = useQuery({
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

  // ReplicaSets + Deployments for rollouts
  const { data: replicaSets = [], isLoading: rsLoading, isError: rsError } = useK8sListWatch<ReplicaSet>({
    apiPath: '/apis/apps/v1/replicasets',
    namespace,
    enabled: categories?.has('rollout'),
  });
  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch<Deployment>({
    apiPath: '/apis/apps/v1/deployments',
    namespace,
    enabled: categories?.has('rollout'),
  });

  // ClusterVersion + ClusterOperators for config changes
  const { data: clusterVersion = null, isLoading: cvLoading, isError: cvError } = useQuery({
    queryKey: ['timeline', 'clusterversion', clusterId],
    queryFn: () => safeQuery(() => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version', clusterId)),
    staleTime: 60000,
    enabled: categories?.has('config'),
  });
  const { data: operators = [], isLoading: opsLoading, isError: opsError } = useK8sListWatch<ClusterOperator>({
    apiPath: '/apis/config.openshift.io/v1/clusteroperators',
    enabled: categories?.has('config'),
  });

  const isLoading = eventsLoading || alertsLoading || rsLoading || deploysLoading || cvLoading || opsLoading;

  /** Sources that were asked for and could not be read. */
  const failedSources: string[] = [
    categories?.has('alert') && alertsError ? 'alerts (Prometheus)' : '',
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
  }, [rawEvents, alertGroups, replicaSets, deployments, clusterVersion, operators, namespace, timeRange, categoriesKey]);

  const entries = result?.entries || [];
  const correlationGroups = result?.correlationGroups || [];
  const counts = result?.counts || { alert: 0, event: 0, rollout: 0, config: 0 };

  return { entries, correlationGroups, counts, isLoading, failedSources };
}
