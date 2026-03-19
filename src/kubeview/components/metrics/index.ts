/**
 * Metrics and Monitoring Components
 *
 * Export all metrics-related components for ShiftOps
 */

export { MetricsChart } from './MetricsChart';
export type { MetricsChartProps, DataPoint, ChartSeries } from './MetricsChart';


export {
  getMetricsForResource,
  resolveQuery,
  formatYAxisValue,
  formatBytes,
  formatCores,
  formatPercent,
  formatRate,
  formatDuration,
  resourceMetrics,
} from './AutoMetrics';
export type { MetricQuery, ResourceMetrics } from './AutoMetrics';

export {
  buildNarrative,
  groupEvents,
} from './Narrative';
export type { NarrativeEvent, NarrativeResult } from './Narrative';

export {
  queryRange,
  queryInstant,
  getMetricNames,
  getLabelValues,
  seriesToDataPoints,
  parseDuration,
  formatDuration as formatPrometheusDuration,
  getTimeRange,
  usePrometheusRange,
  usePrometheusInstant,
} from './prometheus';
export type {
  PrometheusDataPoint,
  PrometheusSeries,
  PrometheusRangeResult,
  PrometheusInstantResult,
  PrometheusResponse,
} from './prometheus';
