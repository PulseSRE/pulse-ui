/**
 * useIncidentTimeline — aggregates alerts, events, rollouts, and config changes
 * into a unified, correlated timeline for incident analysis.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useK8sListWatch } from './useK8sListWatch';
import { k8sGet } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
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
  const { data: rawEvents = [], isLoading: eventsLoading } = useK8sListWatch<K8sResource>({
    apiPath: '/api/v1/events?limit=500',
    enabled: categories.has('event'),
  });

  // Alerts from Prometheus
  const { data: alertGroups = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['timeline', 'alerts'],
    queryFn: async () => {
      const res = await fetch('/api/prometheus/api/v1/rules');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.groups || [];
    },
    refetchInterval: 30000,
    enabled: categories.has('alert'),
  });

  // ReplicaSets + Deployments for rollouts
  const { data: replicaSets = [], isLoading: rsLoading } = useK8sListWatch<K8sResource>({
    apiPath: '/apis/apps/v1/replicasets',
    namespace,
    enabled: categories.has('rollout'),
  });
  const { data: deployments = [], isLoading: deploysLoading } = useK8sListWatch<K8sResource>({
    apiPath: '/apis/apps/v1/deployments',
    namespace,
    enabled: categories.has('rollout'),
  });

  // ClusterVersion + ClusterOperators for config changes
  const { data: clusterVersion = null, isLoading: cvLoading } = useQuery({
    queryKey: ['timeline', 'clusterversion'],
    queryFn: () => k8sGet<ClusterVersion>('/apis/config.openshift.io/v1/clusterversions/version').catch(() => null),
    staleTime: 60000,
    enabled: categories.has('config'),
  });
  const { data: operators = [], isLoading: opsLoading } = useK8sListWatch<K8sResource>({
    apiPath: '/apis/config.openshift.io/v1/clusteroperators',
    enabled: categories.has('config'),
  });

  const isLoading = eventsLoading || alertsLoading || rsLoading || deploysLoading || cvLoading || opsLoading;

  // Transform all sources into TimelineEntry[]
  const { entries, correlationGroups, counts } = useMemo(() => {
    let all: TimelineEntry[] = [];

    if (categories.has('event')) {
      all = all.concat(eventsToTimeline(rawEvents as unknown as Event[]));
    }
    if (categories.has('alert')) {
      all = all.concat(alertsToTimeline(alertGroups));
    }
    if (categories.has('rollout')) {
      all = all.concat(rolloutsToTimeline(replicaSets as unknown as ReplicaSet[], deployments as unknown as Deployment[]));
    }
    if (categories.has('config')) {
      all = all.concat(configChangesToTimeline(clusterVersion, operators as unknown as ClusterOperator[]));
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
  }, [rawEvents, alertGroups, replicaSets, deployments, clusterVersion, operators, namespace, timeRange, categories]);

  return { entries, correlationGroups, counts, isLoading };
}
