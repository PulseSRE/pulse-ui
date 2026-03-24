/**
 * Timeline types for the Incident Correlation Timeline.
 * Used to normalize alerts, events, rollouts, and config changes into a single stream.
 */

export type TimelineCategory = 'alert' | 'event' | 'rollout' | 'config';
export type TimelineSeverity = 'critical' | 'warning' | 'info' | 'normal';

export interface TimelineEntry {
  id: string;
  timestamp: string;             // ISO 8601
  endTimestamp?: string;         // For alerts/rollouts with duration
  category: TimelineCategory;
  severity: TimelineSeverity;
  title: string;
  detail: string;
  namespace?: string;
  resource?: {
    apiVersion: string;
    kind: string;
    name: string;
    namespace?: string;
  };
  correlationKey?: string;       // Links related entries (e.g., "Deployment/my-app/default")
  source: {
    type: 'prometheus' | 'k8s-event' | 'replicaset' | 'clusterversion' | 'clusteroperator';
    raw?: unknown;
  };
}

export interface CorrelationGroup {
  key: string;
  entries: TimelineEntry[];
  severity: TimelineSeverity;
  timeRange: { start: string; end: string };
}
