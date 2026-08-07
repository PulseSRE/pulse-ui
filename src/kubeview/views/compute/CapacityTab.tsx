/**
 * CapacityTab — capacity planning with predict_linear() projections.
 * Shows days-until-exhaustion, trend charts, and per-resource breakdowns.
 */

import React from 'react';
import { AlertTriangle, TrendingUp, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '../../components/metrics/Sparkline';
import { MetricGrid } from '../../components/primitives/MetricGrid';
import { Panel } from '../../components/primitives/Panel';
import { Card } from '../../components/primitives/Card';
import { CHART_COLORS } from '../../engine/colors';
import { useClusterStore } from '../../store/clusterStore';
import { useCapacityProjections, type Lookback } from './useCapacityProjections';
import { ExhaustionCard } from './ExhaustionCard';

const LOOKBACK_OPTIONS: Lookback[] = ['7d', '30d', '90d'];

export function CapacityTab() {
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const [lookback, setLookback] = React.useState<Lookback>('30d');
  const { projections, isLoading, criticalCount, warningCount } = useCapacityProjections(lookback);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Capacity Planning
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Projected resource exhaustion based on {lookback} trend analysis
          </p>
        </div>
        <Card className="flex gap-1 p-1">
          {LOOKBACK_OPTIONS.map((lb) => (
            <button
              key={lb}
              onClick={() => setLookback(lb)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-sm transition-colors',
                lookback === lb ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {lb}
            </button>
          ))}
        </Card>
      </div>

      {/* Warning banners */}
      {criticalCount > 0 && (
        <div className="bg-red-950/30 border border-red-800 rounded-lg px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <span className="text-sm font-medium text-red-300">
              {criticalCount} resource{criticalCount > 1 ? 's' : ''} projected to exhaust within 14 days
            </span>
            <p className="text-xs text-red-400/70 mt-0.5">Scale your cluster or reduce workload resource consumption.</p>
          </div>
        </div>
      )}
      {warningCount > 0 && criticalCount === 0 && (
        <div className="bg-amber-950/30 border border-amber-800 rounded-lg px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <span className="text-sm text-amber-300">
            {warningCount} resource{warningCount > 1 ? 's' : ''} projected to exhaust within 30 days
          </span>
        </div>
      )}

      {/* Exhaustion cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
      ) : (
        <>
          <MetricGrid>
            {projections.map((p) => (
              <ExhaustionCard key={p.resource} projection={p} />
            ))}
          </MetricGrid>

          {/* Trend charts */}
          <Panel title="Resource Trends" icon={<TrendingUp className="w-4 h-4 text-blue-400" />}>
            <MetricGrid>
              <MetricCard
                title="CPU Utilization"
                query={isHyperShift
                  ? "sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / count(count by (cpu) (node_cpu_seconds_total)) * 100"
                  : "sum(rate(node_cpu_seconds_total{mode!='idle'}[5m])) / sum(machine_cpu_cores) * 100"}
                unit="%"
                color={CHART_COLORS.blue}
                thresholds={{ warning: 70, critical: 90 }}
              />
              <MetricCard
                title="Memory Utilization"
                query="(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) * 100"
                unit="%"
                color={CHART_COLORS.violet}
                thresholds={{ warning: 75, critical: 90 }}
              />
              <MetricCard
                title="Disk Utilization"
                query='(1 - sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})) * 100'
                unit="%"
                color={CHART_COLORS.amber}
                thresholds={{ warning: 80, critical: 95 }}
              />
              <MetricCard
                title="Pod Utilization"
                query="sum(kubelet_running_pods) / sum(kube_node_status_allocatable{resource='pods'}) * 100"
                unit="%"
                color={CHART_COLORS.emerald}
                thresholds={{ warning: 70, critical: 90 }}
              />
            </MetricGrid>
          </Panel>

          {/* Disclaimer */}
          <div className="flex items-start gap-2 text-xs text-slate-600">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Projections are estimates based on linear regression over the selected lookback period. Actual growth may vary due to seasonal patterns, deployments, or scaling events. Longer lookback periods produce more stable estimates.</span>
          </div>
        </>
      )}
    </div>
  );
}
