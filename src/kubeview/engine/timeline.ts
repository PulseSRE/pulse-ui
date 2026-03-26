/**
 * Timeline Engine — transforms K8s resources into unified TimelineEntry objects
 * and correlates related entries for incident analysis.
 */

import type { Event, ReplicaSet, Deployment, ClusterVersion, ClusterOperator, Condition } from './types';
import type { TimelineEntry, TimelineSeverity, CorrelationGroup } from './types/timeline';

// ── Alert types (from Prometheus API, not K8s resources) ──

interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt?: string;
}

interface AlertRule {
  name: string;
  query: string;
  state: string;
  alerts: PrometheusAlert[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

interface AlertGroup {
  name: string;
  rules: AlertRule[];
}

// ── Transform functions ──

export function alertsToTimeline(alertGroups: AlertGroup[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const group of alertGroups) {
    for (const rule of group.rules || []) {
      for (const alert of rule.alerts || []) {
        if (alert.state === 'inactive') continue;
        const severity = mapAlertSeverity(alert.labels.severity || rule.labels?.severity);
        const ns = alert.labels.namespace;
        const resourceName = alert.labels.deployment || alert.labels.pod || alert.labels.statefulset || alert.labels.node || '';
        const resourceKind = alert.labels.deployment ? 'Deployment' :
          alert.labels.pod ? 'Pod' :
          alert.labels.statefulset ? 'StatefulSet' :
          alert.labels.node ? 'Node' : '';

        entries.push({
          id: `alert-${rule.name}-${alert.activeAt || ''}-${ns || ''}`,
          timestamp: alert.activeAt || new Date().toISOString(),
          category: 'alert',
          severity,
          title: rule.name,
          detail: alert.annotations?.description || alert.annotations?.message || rule.annotations?.description || rule.query,
          namespace: ns,
          resource: resourceName && resourceKind ? {
            apiVersion: resourceKind === 'Node' ? 'v1' : resourceKind === 'Pod' ? 'v1' : 'apps/v1',
            kind: resourceKind,
            name: resourceName,
            namespace: ns,
          } : undefined,
          correlationKey: ns ? `${resourceKind || 'Alert'}/${resourceName || rule.name}/${ns}` : `Alert/${rule.name}`,
          source: { type: 'prometheus', raw: { rule, alert } },
        });
      }
    }
  }

  return entries;
}

export function eventsToTimeline(events: Event[]): TimelineEntry[] {
  return events
    .filter(ev => ev.lastTimestamp || ev.firstTimestamp || ev.metadata.creationTimestamp)
    .map(ev => {
      const timestamp = ev.lastTimestamp || ev.firstTimestamp || ev.metadata.creationTimestamp || '';
      const involved = ev.involvedObject || { kind: '', name: '', apiVersion: 'v1' };
      const isWarning = ev.type === 'Warning';
      const isFailed = (ev.reason || '').includes('Failed') || (ev.reason || '').includes('Error') || (ev.reason || '').includes('Kill');

      return {
        id: `event-${ev.metadata.uid || ev.metadata.name || timestamp}`,
        timestamp,
        category: 'event' as const,
        severity: (isFailed ? 'warning' : isWarning ? 'warning' : 'normal') as TimelineSeverity,
        title: ev.reason || 'Event',
        detail: ev.message || '',
        namespace: ev.metadata.namespace || involved.namespace,
        resource: involved.name ? {
          apiVersion: involved.apiVersion || 'v1',
          kind: involved.kind,
          name: involved.name,
          namespace: involved.namespace,
        } : undefined,
        correlationKey: involved.name
          ? `${involved.kind}/${involved.name}/${involved.namespace || '_'}`
          : undefined,
        source: { type: 'k8s-event' as const, raw: ev },
      };
    });
}

export function rolloutsToTimeline(replicaSets: ReplicaSet[], deployments: Deployment[]): TimelineEntry[] {
  const deployMap = new Map<string, Deployment>();
  for (const d of deployments) {
    deployMap.set(`${d.metadata.namespace}/${d.metadata.name}`, d);
  }

  return replicaSets
    .filter(rs => {
      // Only include ReplicaSets owned by Deployments (have owner reference)
      const owners = rs.metadata.ownerReferences || [];
      return owners.some(o => o.kind === 'Deployment');
    })
    .map(rs => {
      const owner = (rs.metadata.ownerReferences || []).find(o => o.kind === 'Deployment');
      const deployName = owner?.name || '';
      const ns = rs.metadata.namespace || '';
      const revision = rs.metadata.annotations?.['deployment.kubernetes.io/revision'] || '?';
      const replicas = rs.spec?.replicas ?? 0;
      const readyReplicas = rs.status?.readyReplicas ?? 0;
      const deploy = deployMap.get(`${ns}/${deployName}`);
      const image = rs.spec?.template?.spec?.containers?.[0]?.image || '';
      const shortImage = image.split('/').pop() || image;

      return {
        id: `rollout-${rs.metadata.uid || rs.metadata.name}`,
        timestamp: rs.metadata.creationTimestamp || '',
        category: 'rollout' as const,
        severity: (replicas > 0 && readyReplicas === 0 ? 'warning' : 'info') as TimelineSeverity,
        title: `${deployName} revision ${revision}`,
        detail: shortImage ? `Image: ${shortImage} (${readyReplicas}/${replicas} ready)` : `${readyReplicas}/${replicas} ready`,
        namespace: ns,
        resource: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: deployName,
          namespace: ns,
        },
        correlationKey: `Deployment/${deployName}/${ns}`,
        source: { type: 'replicaset' as const, raw: rs },
      };
    });
}

export function configChangesToTimeline(
  clusterVersion: ClusterVersion | null,
  operators: ClusterOperator[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // ClusterVersion history
  if (clusterVersion?.status?.history) {
    for (const h of clusterVersion.status.history) {
      entries.push({
        id: `cv-${h.version}-${h.startedTime || ''}`,
        timestamp: h.startedTime || '',
        endTimestamp: h.completionTime,
        category: 'config',
        severity: h.state === 'Completed' ? 'info' : h.state === 'Partial' ? 'warning' : 'info',
        title: `Cluster update to ${h.version}`,
        detail: `State: ${h.state}${h.completionTime ? ` (completed ${new Date(h.completionTime).toLocaleString()})` : ''}`,
        correlationKey: 'cluster/version',
        source: { type: 'clusterversion', raw: h },
      });
    }
  }

  // Operator condition transitions
  for (const op of operators) {
    const conditions = op.status?.conditions || [];
    for (const cond of conditions) {
      if (cond.status !== 'True') continue;
      // Only include Degraded or Progressing transitions (Available=True is normal)
      if (cond.type !== 'Degraded' && cond.type !== 'Progressing') continue;
      if (!cond.lastTransitionTime) continue;

      entries.push({
        id: `op-${op.metadata.name}-${cond.type}-${cond.lastTransitionTime}`,
        timestamp: cond.lastTransitionTime,
        category: 'config',
        severity: cond.type === 'Degraded' ? 'critical' : 'info',
        title: `${op.metadata.name}: ${cond.type}`,
        detail: cond.message || cond.reason || '',
        correlationKey: `ClusterOperator/${op.metadata.name}`,
        source: { type: 'clusteroperator', raw: { operator: op.metadata.name, condition: cond } },
      });
    }
  }

  return entries;
}

// ── Correlation ──

const SEVERITY_ORDER: Record<TimelineSeverity, number> = { critical: 0, warning: 1, info: 2, normal: 3 };

export function correlateEntries(entries: TimelineEntry[]): CorrelationGroup[] {
  const groups = new Map<string, TimelineEntry[]>();

  for (const entry of entries) {
    if (!entry.correlationKey) continue;
    const existing = groups.get(entry.correlationKey) || [];
    existing.push(entry);
    groups.set(entry.correlationKey, existing);
  }

  return Array.from(groups.entries())
    .filter(([, items]) => items.length >= 2) // Only groups with multiple entries
    .map(([key, items]) => {
      const sorted = items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const worstSeverity = sorted.reduce<TimelineSeverity>(
        (worst, e) => SEVERITY_ORDER[e.severity] < SEVERITY_ORDER[worst] ? e.severity : worst,
        'normal',
      );
      return {
        key,
        entries: sorted,
        severity: worstSeverity,
        timeRange: {
          start: sorted[0].timestamp,
          end: sorted[sorted.length - 1].timestamp,
        },
      };
    })
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ── Filtering ──

export function filterByTimeRange(entries: TimelineEntry[], cutoffMs: number): TimelineEntry[] {
  const cutoff = Date.now() - cutoffMs;
  return entries.filter(e => new Date(e.timestamp).getTime() >= cutoff);
}

// ── Helpers ──

function mapAlertSeverity(severity: string | undefined): TimelineSeverity {
  switch (severity) {
    case 'critical': return 'critical';
    case 'warning': return 'warning';
    case 'info': return 'info';
    default: return 'warning';
  }
}
