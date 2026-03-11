import React, { useState, useCallback } from 'react';
import {
  PageSection,
  Title,
  Card,
  CardBody,
  Button,
  Grid,
  GridItem,
} from '@patternfly/react-core';
import { PlayIcon } from '@patternfly/react-icons';
import { useUIStore } from '@/store/useUIStore';
import '@/openshift-components.css';

const PROM_BASE = '/api/prometheus';

const exampleQueries = [
  { label: 'CPU Usage', query: 'sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (namespace)' },
  { label: 'Memory Usage', query: 'sum(container_memory_working_set_bytes{container!=""}) by (namespace)' },
  { label: 'Pod Count', query: 'count(kube_pod_info) by (namespace)' },
  { label: 'Node Load', query: 'node_load1' },
  { label: 'Network Receive', query: 'sum(rate(node_network_receive_bytes_total[5m])) by (instance)' },
  { label: 'Disk Available', query: 'node_filesystem_avail_bytes{mountpoint="/"}' },
];

interface PrometheusResult {
  metric: Record<string, string>;
  values?: [number, string][];
  value?: [number, string];
}

interface QueryResult {
  query: string;
  resultType: string;
  results: PrometheusResult[];
}

function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 400;
  const h = 120;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h * 0.9 - h * 0.05;
    return `${x},${y}`;
  });
  const areaPoints = [...points, `${w},${h}`, `0,${h}`];
  const gradId = `metricGrad-${color.replace(/[^a-z0-9]/g, '')}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="os-minichart">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints.join(' ')} fill={`url(#${gradId})`} />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatMetricLabel(metric: Record<string, string>): string {
  const entries = Object.entries(metric).filter(([k]) => k !== '__name__');
  if (entries.length === 0) return metric['__name__'] ?? 'value';
  return entries.map(([k, v]) => `${k}="${v}"`).join(', ');
}

function formatValue(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} G`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} K`;
  return v.toFixed(2);
}

export default function Metrics() {
  const addToast = useUIStore((s) => s.addToast);
  const [queryValue, setQueryValue] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runQuery = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setQueryValue(q);
    setLoading(true);
    setResult(null);
    try {
      // Try range query first for chart data (last 1 hour, 30s steps)
      const end = Math.floor(Date.now() / 1000);
      const start = end - 3600;
      const rangeRes = await fetch(`${PROM_BASE}/api/v1/query_range?query=${encodeURIComponent(q)}&start=${start}&end=${end}&step=30`);
      if (rangeRes.ok) {
        const json = await rangeRes.json() as { data?: { resultType?: string; result?: PrometheusResult[] } };
        if (json.data?.result && json.data.result.length > 0) {
          setResult({ query: q, resultType: json.data.resultType ?? 'matrix', results: json.data.result });
          setLoading(false);
          return;
        }
      }
      // Fallback to instant query
      const instantRes = await fetch(`${PROM_BASE}/api/v1/query?query=${encodeURIComponent(q)}`);
      if (!instantRes.ok) throw new Error(`${instantRes.status} ${instantRes.statusText}`);
      const json = await instantRes.json() as { data?: { resultType?: string; result?: PrometheusResult[] } };
      if (json.data?.result) {
        setResult({ query: q, resultType: json.data.resultType ?? 'vector', results: json.data.result });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Query failed', description: err instanceof Error ? err.message : String(err) });
    }
    setLoading(false);
  }, [addToast]);

  const colors = ['rgba(59,130,246,0.8)', 'rgba(34,197,94,0.8)', 'rgba(251,146,60,0.8)', 'rgba(168,85,247,0.8)', 'rgba(236,72,153,0.8)', 'rgba(20,184,166,0.8)'];

  return (
    <>
      <PageSection variant="default">
        <Title headingLevel="h1" size="2xl">Metrics</Title>
        <p className="os-metrics__description">
          Query and visualize cluster metrics with PromQL
        </p>
      </PageSection>

      <PageSection>
        <Card>
          <CardBody>
            <div className="os-metrics__query-row">
              <input
                className="os-metrics__query-input"
                placeholder="Enter PromQL query..."
                value={queryValue}
                onChange={(e) => setQueryValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runQuery(queryValue)}
              />
              <Button variant="primary" icon={<PlayIcon />} onClick={() => runQuery(queryValue)} isLoading={loading}>
                Run Query
              </Button>
            </div>

            <div className="os-metrics__quick-actions">
              {exampleQueries.map((eq) => (
                <button
                  key={eq.label}
                  className="compass-quick-action os-metrics__quick-action-btn"
                  onClick={() => runQuery(eq.query)}
                >
                  {eq.label}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      </PageSection>

      {result && (
        <PageSection>
          <Title headingLevel="h3" className="os-metrics__live-title">
            Results for: <code>{result.query}</code>
          </Title>
          <p className="os-text-muted pf-v5-u-mb-md">
            {result.results.length} series returned ({result.resultType})
          </p>
          <Grid hasGutter>
            {result.results.slice(0, 12).map((series, idx) => {
              const color = colors[idx % colors.length];
              const label = formatMetricLabel(series.metric);

              if (series.values && series.values.length > 1) {
                // Range query — render chart
                const data = series.values.map(([, v]) => parseFloat(v));
                const latest = data[data.length - 1];
                return (
                  <GridItem md={6} key={idx}>
                    <Card>
                      <CardBody>
                        <div className="os-metrics__chart-title" title={label}>
                          {label.length > 80 ? label.slice(0, 80) + '...' : label}
                        </div>
                        <MiniChart data={data} color={color} />
                        <div className="os-metrics__chart-latest">
                          Latest: {formatValue(latest)}
                        </div>
                      </CardBody>
                    </Card>
                  </GridItem>
                );
              }

              // Instant query — render value
              const val = series.value ? parseFloat(series.value[1]) : NaN;
              return (
                <GridItem md={4} sm={6} key={idx}>
                  <Card>
                    <CardBody>
                      <div className="os-metrics__chart-title" title={label}>
                        {label.length > 60 ? label.slice(0, 60) + '...' : label}
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 700, padding: '16px 0' }}>
                        {isNaN(val) ? '-' : formatValue(val)}
                      </div>
                    </CardBody>
                  </Card>
                </GridItem>
              );
            })}
          </Grid>
          {result.results.length > 12 && (
            <p className="os-text-muted pf-v5-u-mt-md">
              Showing 12 of {result.results.length} series. Refine your query to see fewer results.
            </p>
          )}
        </PageSection>
      )}
    </>
  );
}
