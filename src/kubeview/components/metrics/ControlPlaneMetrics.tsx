import React from 'react';
import { MetricCard } from './Sparkline';
import { CHART_COLORS } from '../../engine/colors';
import { useClusterStore } from '../../store/clusterStore';
import { useMetricsAvailable } from '../../hooks/useClusterBase';
import { RemoteMetricsNotice } from './RemoteMetricsNotice';

export function ControlPlaneMetrics() {
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const metricsAvailable = useMetricsAvailable();
  if (!metricsAvailable) return <RemoteMetricsNotice compact what="Control plane metrics" />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        title="API Latency (p99)"
        query='histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!~"WATCH|CONNECT"}[5m])) by (le))'
        unit="s"
        color={CHART_COLORS.blue}
        thresholds={{ warning: 1, critical: 5 }}
      />
      <MetricCard
        title="API Error Rate"
        query='sum(rate(apiserver_request_total{code=~"5.."}[5m])) / sum(rate(apiserver_request_total[5m])) * 100'
        unit="%"
        color={CHART_COLORS.red}
        thresholds={{ warning: 1, critical: 5 }}
      />
      <MetricCard
        title="API Request Rate"
        query='sum(rate(apiserver_request_total[5m]))'
        unit="/s"
        color={CHART_COLORS.cyan}
      />
      {!isHyperShift && (
        <>
          <MetricCard
            title="etcd Leader"
            query="max(etcd_server_has_leader)"
            unit=""
            color={CHART_COLORS.emerald}
          />
          <MetricCard
            title="etcd WAL Fsync"
            query="histogram_quantile(0.99, sum(rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m])) by (le))"
            unit="s"
            color={CHART_COLORS.amber}
            thresholds={{ warning: 0.01, critical: 0.1 }}
          />
          <MetricCard
            title="etcd DB Size"
            query="max(etcd_mvcc_db_total_size_in_bytes) / 1024 / 1024"
            unit=" MB"
            color={CHART_COLORS.violet}
            thresholds={{ warning: 4096, critical: 6144 }}
          />
        </>
      )}
      {isHyperShift && (
        <MetricCard
          title="Hosted CP Requests"
          query='sum(rate(apiserver_request_total{verb!~"WATCH|CONNECT"}[5m]))'
          unit="/s"
          color={CHART_COLORS.emerald}
        />
      )}
    </div>
  );
}
