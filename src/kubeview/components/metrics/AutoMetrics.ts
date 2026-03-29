/**
 * AutoMetrics - Mapping from resource types to Prometheus queries
 *
 * Provides automatic metric queries for different Kubernetes resource types.
 * All queries use real Prometheus/Thanos metrics available via the /api/prometheus proxy.
 */

interface MinimalResource {
  metadata: { name: string; namespace?: string };
}

export interface MetricQuery {
  id: string;
  title: string;
  query: string;           // PromQL query template with ${namespace}, ${name}, ${pod} placeholders
  yAxisLabel: string;
  yAxisFormat: 'bytes' | 'percent' | 'cores' | 'count' | 'duration' | 'rate';
  series?: string;         // Legend label template
  thresholds?: Array<{ query: string; label: string; color: string }>;  // e.g., request/limit lines
}

export interface ResourceMetrics {
  resourceType: string;    // GVR pattern
  queries: MetricQuery[];
}

export const resourceMetrics: ResourceMetrics[] = [
  // Pods
  {
    resourceType: 'v1/pods',
    queries: [
      {
        id: 'pod-cpu',
        title: 'CPU Usage',
        query: 'rate(container_cpu_usage_seconds_total{pod="${name}",namespace="${namespace}",container!="",container!="POD"}[5m])',
        yAxisLabel: 'CPU Cores',
        yAxisFormat: 'cores',
        series: '${container}',
        thresholds: [
          {
            query: 'kube_pod_container_resource_requests{resource="cpu",pod="${name}",namespace="${namespace}"}',
            label: 'Request',
            color: '#f59e0b',
          },
          {
            query: 'kube_pod_container_resource_limits{resource="cpu",pod="${name}",namespace="${namespace}"}',
            label: 'Limit',
            color: '#ef4444',
          },
        ],
      },
      {
        id: 'pod-memory',
        title: 'Memory Usage',
        query: 'container_memory_working_set_bytes{pod="${name}",namespace="${namespace}",container!="",container!="POD"}',
        yAxisLabel: 'Memory',
        yAxisFormat: 'bytes',
        series: '${container}',
        thresholds: [
          {
            query: 'kube_pod_container_resource_requests{resource="memory",pod="${name}",namespace="${namespace}"}',
            label: 'Request',
            color: '#f59e0b',
          },
          {
            query: 'kube_pod_container_resource_limits{resource="memory",pod="${name}",namespace="${namespace}"}',
            label: 'Limit',
            color: '#ef4444',
          },
        ],
      },
      {
        id: 'pod-network',
        title: 'Network I/O',
        query: 'rate(container_network_receive_bytes_total{pod="${name}",namespace="${namespace}"}[5m])',
        yAxisLabel: 'Bytes/sec',
        yAxisFormat: 'rate',
        series: 'Receive',
      },
      {
        id: 'pod-network-tx',
        title: 'Network Transmit',
        query: 'rate(container_network_transmit_bytes_total{pod="${name}",namespace="${namespace}"}[5m])',
        yAxisLabel: 'Bytes/sec',
        yAxisFormat: 'rate',
        series: 'Transmit',
      },
      {
        id: 'pod-restarts',
        title: 'Container Restarts',
        query: 'kube_pod_container_status_restarts_total{pod="${name}",namespace="${namespace}"}',
        yAxisLabel: 'Restart Count',
        yAxisFormat: 'count',
        series: '${container}',
      },
    ],
  },

  // Deployments
  {
    resourceType: 'apps/v1/deployments',
    queries: [
      {
        id: 'deployment-cpu',
        title: 'CPU Usage (All Pods)',
        query: 'sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod=~"${name}-.*",container!="",container!="POD"}[5m]))',
        yAxisLabel: 'CPU Cores',
        yAxisFormat: 'cores',
        series: 'Total CPU',
      },
      {
        id: 'deployment-memory',
        title: 'Memory Usage (All Pods)',
        query: 'sum(container_memory_working_set_bytes{namespace="${namespace}",pod=~"${name}-.*",container!="",container!="POD"})',
        yAxisLabel: 'Memory',
        yAxisFormat: 'bytes',
        series: 'Total Memory',
      },
      {
        id: 'deployment-replicas',
        title: 'Replica Count',
        query: 'kube_deployment_status_replicas{deployment="${name}",namespace="${namespace}"}',
        yAxisLabel: 'Replicas',
        yAxisFormat: 'count',
        series: 'Total',
      },
      {
        id: 'deployment-available',
        title: 'Available Replicas',
        query: 'kube_deployment_status_replicas_available{deployment="${name}",namespace="${namespace}"}',
        yAxisLabel: 'Available',
        yAxisFormat: 'count',
        series: 'Available',
      },
    ],
  },

  // Nodes
  {
    resourceType: 'v1/nodes',
    queries: [
      {
        id: 'node-cpu',
        title: 'CPU Utilization',
        query: '1 - avg(rate(node_cpu_seconds_total{mode="idle",instance="${name}"}[5m]))',
        yAxisLabel: 'CPU %',
        yAxisFormat: 'percent',
        series: 'CPU',
      },
      {
        id: 'node-memory',
        title: 'Memory Usage',
        query: 'node_memory_MemTotal_bytes{instance="${name}"} - node_memory_MemAvailable_bytes{instance="${name}"}',
        yAxisLabel: 'Memory',
        yAxisFormat: 'bytes',
        series: 'Used Memory',
      },
      {
        id: 'node-disk',
        title: 'Filesystem Usage',
        query: 'sum(node_filesystem_size_bytes{instance="${name}"} - node_filesystem_avail_bytes{instance="${name}"})',
        yAxisLabel: 'Disk Used',
        yAxisFormat: 'bytes',
        series: 'Used',
      },
      {
        id: 'node-pods',
        title: 'Running Pods',
        query: 'count(kube_pod_info{node="${name}"})',
        yAxisLabel: 'Pod Count',
        yAxisFormat: 'count',
        series: 'Pods',
      },
    ],
  },

  // StatefulSets
  {
    resourceType: 'apps/v1/statefulsets',
    queries: [
      {
        id: 'statefulset-cpu',
        title: 'CPU Usage (All Pods)',
        query: 'sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod=~"${name}-.*",container!="",container!="POD"}[5m]))',
        yAxisLabel: 'CPU Cores',
        yAxisFormat: 'cores',
        series: 'Total CPU',
      },
      {
        id: 'statefulset-memory',
        title: 'Memory Usage (All Pods)',
        query: 'sum(container_memory_working_set_bytes{namespace="${namespace}",pod=~"${name}-.*",container!="",container!="POD"})',
        yAxisLabel: 'Memory',
        yAxisFormat: 'bytes',
        series: 'Total Memory',
      },
      {
        id: 'statefulset-replicas',
        title: 'Replica Count',
        query: 'kube_statefulset_status_replicas{statefulset="${name}",namespace="${namespace}"}',
        yAxisLabel: 'Replicas',
        yAxisFormat: 'count',
        series: 'Total',
      },
    ],
  },

  // DaemonSets
  {
    resourceType: 'apps/v1/daemonsets',
    queries: [
      {
        id: 'daemonset-cpu',
        title: 'CPU Usage (All Pods)',
        query: 'sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod=~"${name}-.*",container!="",container!="POD"}[5m]))',
        yAxisLabel: 'CPU Cores',
        yAxisFormat: 'cores',
        series: 'Total CPU',
      },
      {
        id: 'daemonset-memory',
        title: 'Memory Usage (All Pods)',
        query: 'sum(container_memory_working_set_bytes{namespace="${namespace}",pod=~"${name}-.*",container!="",container!="POD"})',
        yAxisLabel: 'Memory',
        yAxisFormat: 'bytes',
        series: 'Total Memory',
      },
      {
        id: 'daemonset-desired',
        title: 'Desired Pods',
        query: 'kube_daemonset_status_desired_number_scheduled{daemonset="${name}",namespace="${namespace}"}',
        yAxisLabel: 'Pods',
        yAxisFormat: 'count',
        series: 'Desired',
      },
    ],
  },
];

/**
 * Get metric queries for a given resource type and instance
 */
export function getMetricsForResource(gvrKey: string, _resource?: MinimalResource): MetricQuery[] {
  const config = resourceMetrics.find((r) => gvrKey.includes(r.resourceType));
  if (!config) return [];

  return config.queries;
}

/**
 * Resolve query template with actual resource values
 */
export function resolveQuery(query: string, vars: Record<string, string>): string {
  let resolved = query;
  for (const [key, value] of Object.entries(vars)) {
    resolved = resolved.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
  }
  return resolved;
}

/**
 * Format Y-axis values based on format type
 */
export function formatYAxisValue(value: number, format: string): string {
  switch (format) {
    case 'bytes':
      return formatBytes(value);
    case 'cores':
      return formatCores(value);
    case 'percent':
      return formatPercent(value);
    case 'rate':
      return formatRate(value);
    case 'duration':
      return formatDuration(value);
    case 'count':
      return value.toFixed(0);
    default:
      return value.toFixed(2);
  }
}

// Format helpers
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;

  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  if (value >= 100) return `${value.toFixed(0)} ${sizes[i]}`;
  if (value >= 10) return `${value.toFixed(1)} ${sizes[i]}`;
  return `${value.toFixed(2)} ${sizes[i]}`;
}

export function formatCores(cores: number): string {
  if (cores === 0) return '0';
  if (cores < 0.001) return `${(cores * 1000000).toFixed(0)}n`;
  if (cores < 1) return `${(cores * 1000).toFixed(0)}m`;
  if (cores >= 10) return cores.toFixed(1);
  return cores.toFixed(2);
}

export function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  if (percent >= 100) return `${percent.toFixed(0)}%`;
  if (percent >= 10) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(2)}%`;
}

export function formatRate(rate: number): string {
  if (rate === 0) return '0 B/s';
  if (rate < 1024) return `${rate.toFixed(0)} B/s`;
  if (rate < 1024 * 1024) return `${(rate / 1024).toFixed(1)} KiB/s`;
  if (rate < 1024 * 1024 * 1024) return `${(rate / (1024 * 1024)).toFixed(1)} MiB/s`;
  return `${(rate / (1024 * 1024 * 1024)).toFixed(1)} GiB/s`;
}

export function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  if (seconds < 0.001) return `${(seconds * 1000000).toFixed(0)}µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
