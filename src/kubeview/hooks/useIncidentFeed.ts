/**
 * useIncidentFeed — unified hook that merges incident data from 4 sources
 * (monitor findings, tracked errors, Prometheus alerts, timeline entries)
 * into a single deduplicated, sorted IncidentItem[].
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMonitorStore } from '../store/monitorStore';
import { useErrorStore } from '../store/errorStore';
import { useUIStore } from '../store/uiStore';
import { useIncidentTimeline, type TimeRange } from './useIncidentTimeline';
import {
  type IncidentItem,
  type IncidentSeverity,
  type IncidentSource,
  findingToIncident,
  trackedErrorToIncident,
  prometheusAlertToIncident,
  timelineEntryToIncident,
  type PrometheusAlert,
} from '../engine/types/incident';
import type { TimelineEntry } from '../engine/types/timeline';

export type { IncidentItem, IncidentSeverity, IncidentSource };

export interface UseIncidentFeedOptions {
  severity?: IncidentSeverity;
  limit?: number;
  sources?: IncidentSource[];
  timelineRange?: TimeRange;
}

export interface UseIncidentFeedResult {
  incidents: IncidentItem[];
  isLoading: boolean;
  /**
   * The Prometheus alert fetch failed.
   *
   * Exposed because "no alerts" and "could not ask about alerts" look
   * identical in `counts` and must not: a caller that renders an all-clear
   * state needs to suppress it when alerting is simply unreachable.
   */
  isError: boolean;
  counts: { critical: number; warning: number; info: number; total: number };
}

const SEVERITY_ORDER: Record<IncidentSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const DEFAULT_SOURCES: IncidentSource[] = ['finding', 'tracked-error', 'prometheus-alert', 'timeline-entry'];

interface PrometheusAlertRule {
  name: string;
  type: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  alerts?: PrometheusAlert[];
}

interface PrometheusAlertGroup {
  name: string;
  rules: PrometheusAlertRule[];
}

const ALL_TIMELINE_CATEGORIES = new Set(['alert', 'event', 'rollout', 'config'] as const);

export function useIncidentFeed(
  options: UseIncidentFeedOptions = {},
): UseIncidentFeedResult {
  const {
    severity: severityFilter,
    limit,
    sources = DEFAULT_SOURCES,
    timelineRange = '1h',
  } = options;

  const findings = useMonitorStore((s) => s.findings);
  const errors = useErrorStore((s) => s.errors);

  const { data: alertGroups = [], isLoading: alertsLoading, isError: alertsError } = useQuery<
    PrometheusAlertGroup[]
  >({
    queryKey: ['incidentFeed', 'alerts'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/prometheus/api/v1/rules');
        if (!res.ok) {
          useUIStore.getState().addDegradedReason('observability_unavailable');
          return [];
        }
        useUIStore.getState().removeDegradedReason('observability_unavailable');
        const json = await res.json();
        return json.data?.groups ?? [];
      } catch {
        useUIStore.getState().addDegradedReason('observability_unavailable');
        return [];
      }
    },
    refetchInterval: 60000,
    enabled: sources.includes('prometheus-alert'),
  });

  const timelineEnabled = sources.includes('timeline-entry');
  const timeline = useIncidentTimeline({
    timeRange: timelineRange as TimeRange,
    categories: ALL_TIMELINE_CATEGORIES,
  });
  const timelineEntries: TimelineEntry[] = timelineEnabled
    ? timeline.entries ?? []
    : [];
  const timelineLoading = timelineEnabled ? timeline.isLoading : false;

  const result = useMemo(() => {
    let items: IncidentItem[] = [];

    if (sources.includes('finding')) {
      items = items.concat(findings.map((f) => findingToIncident(f)));
    }

    if (sources.includes('tracked-error')) {
      const unresolvedErrors = errors.filter((e) => !e.resolved);
      items = items.concat(unresolvedErrors.map((e) => trackedErrorToIncident(e)));
    }

    if (sources.includes('prometheus-alert')) {
      for (const group of alertGroups) {
        for (const rule of group.rules) {
          if (rule.type !== 'alerting') continue;
          for (const alert of rule.alerts ?? []) {
            if (alert.state !== 'firing') continue;
            items.push(prometheusAlertToIncident(alert));
          }
        }
      }
    }

    if (sources.includes('timeline-entry')) {
      items = items.concat(timelineEntries.map((e) => timelineEntryToIncident(e)));
    }

    if (severityFilter) {
      items = items.filter((i) => i.severity === severityFilter);
    }

    // Keep highest severity per correlationKey, break ties by newest timestamp
    const deduped = new Map<string, IncidentItem>();
    for (const item of items) {
      const existing = deduped.get(item.correlationKey);
      if (!existing) {
        deduped.set(item.correlationKey, item);
      } else {
        const existingSev = SEVERITY_ORDER[existing.severity];
        const newSev = SEVERITY_ORDER[item.severity];
        if (newSev < existingSev || (newSev === existingSev && item.timestamp > existing.timestamp)) {
          deduped.set(item.correlationKey, item);
        }
      }
    }

    let sorted = Array.from(deduped.values()).sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.timestamp - a.timestamp;
    });

    const counts = { critical: 0, warning: 0, info: 0, total: sorted.length };
    for (const item of sorted) {
      counts[item.severity]++;
    }

    if (limit !== undefined && limit > 0) {
      sorted = sorted.slice(0, limit);
    }

    return { incidents: sorted, counts };
  }, [findings, errors, alertGroups, timelineEntries, severityFilter, limit, sources]);

  const isLoading = alertsLoading || timelineLoading;

  return {
    incidents: result.incidents,
    isLoading,
    isError: alertsError,
    counts: result.counts,
  };
}
