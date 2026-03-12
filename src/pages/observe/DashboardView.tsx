import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PageSection,
  Title,
  Card,
  CardBody,
  Breadcrumb,
  BreadcrumbItem,
  Grid,
  GridItem,
  Label,
  Select,
  SelectOption,
  MenuToggle,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import '@/openshift-components.css';

const K8S_BASE = '/api/kubernetes';
const PROM_BASE = '/api/prometheus';

interface GrafanaPanel {
  title: string;
  type: string;
  targets?: { expr: string; legendFormat?: string }[];
}

interface GrafanaTemplate {
  name: string;
  query?: string;
  current?: { value?: string };
  type?: string;
  label?: string;
}

interface PromResult {
  metric: Record<string, string>;
  values: [number, string][];
}

interface ChartData {
  title: string;
  series: { label: string; values: [number, string][] }[];
}

interface VariableOption {
  name: string;
  label: string;
  options: string[];
  selected: string;
}

async function fetchVariableOptions(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};

  try {
    const [nodesRes, nsRes] = await Promise.all([
      fetch(`${K8S_BASE}/api/v1/nodes`),
      fetch(`${K8S_BASE}/api/v1/namespaces`),
    ]);

    if (nodesRes.ok) {
      const data = await nodesRes.json() as { items: { metadata: { name: string } }[] };
      result['node'] = data.items.map((n) => n.metadata.name);
      result['instance'] = data.items.map((n) => n.metadata.name);
    }

    if (nsRes.ok) {
      const data = await nsRes.json() as { items: { metadata: { name: string } }[] };
      result['namespace'] = data.items.map((n) => n.metadata.name);
    }
  } catch {
    // ignore
  }

  // Try to get workload names from Prometheus label values
  try {
    const res = await fetch(`${PROM_BASE}/api/v1/label/workload/values`);
    if (res.ok) {
      const data = await res.json() as { data?: string[] };
      result['workload'] = (data.data ?? []).slice(0, 50);
    }
  } catch {
    // ignore
  }

  try {
    const res = await fetch(`${PROM_BASE}/api/v1/label/pod/values`);
    if (res.ok) {
      const data = await res.json() as { data?: string[] };
      result['pod'] = (data.data ?? []).slice(0, 100);
    }
  } catch {
    // ignore
  }

  try {
    const res = await fetch(`${PROM_BASE}/api/v1/label/job/values`);
    if (res.ok) {
      const data = await res.json() as { data?: string[] };
      result['job'] = (data.data ?? []).slice(0, 50);
    }
  } catch {
    // ignore
  }

  return result;
}

function buildTemplateVars(variables: VariableOption[]): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const v of variables) {
    vars[`$${v.name}`] = v.selected;
    vars[`\${${v.name}}`] = v.selected;
    vars[`\${${v.name}:pipe}`] = v.selected;
    vars[`\${${v.name}:regex}`] = v.selected;
  }

  // Always set interval/rate defaults
  vars['$__rate_interval'] = '5m';
  vars['${__rate_interval}'] = '5m';
  vars['$__interval'] = '1m';
  vars['${__interval}'] = '1m';
  vars['$resolution'] = '5m';
  vars['${resolution}'] = '5m';
  vars['$datasource'] = 'prometheus';
  vars['${datasource}'] = 'prometheus';
  vars['$topk'] = '25';
  vars['${topk}'] = '25';
  vars['$interval'] = '5m';
  vars['${interval}'] = '5m';

  return vars;
}

function substituteVariables(expr: string, vars: Record<string, string>): string {
  let result = expr;
  // Handle Grafana $interval:$resolution syntax → replace with just the resolution
  result = result.replace(/\$interval:\$resolution/g, '5m');
  result = result.replace(/\$\{interval\}:\$\{resolution\}/g, '5m');
  // Handle $__range, $__from, $__to
  result = result.replace(/\$__range/g, '1h');
  result = result.replace(/\$\{__range\}/g, '1h');
  // Substitute all known variables (longest first to avoid partial matches)
  const sortedKeys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const value = vars[key];
    if (value !== undefined) {
      result = result.split(key).join(value);
    }
  }
  // Replace any remaining unresolved variables with wildcards
  result = result.replace(/\$\{[^}]+\}/g, '.*');
  result = result.replace(/\$[a-zA-Z_]\w*/g, '.*');
  return result;
}

function PromChart({ chart }: { chart: ChartData }) {
  if (chart.series.length === 0 || chart.series[0]?.values.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="os-detail__section-title">{chart.title}</div>
          <p className="os-text-muted">No data</p>
        </CardBody>
      </Card>
    );
  }

  const allValues = chart.series.flatMap((s) => s.values.map((v) => parseFloat(v[1])));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const w = 500;
  const h = 120;
  const colors = ['#0066cc', '#009596', '#3e8635', '#f0ab00', '#c9190b', '#5752d1', '#ec7a08', '#2b9af3', '#a18fff', '#73bcf7'];

  return (
    <Card>
      <CardBody>
        <div className="os-detail__section-title">{chart.title}</div>
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          {chart.series.slice(0, 10).map((series, si) => {
            const points = series.values.map((v, i) => {
              const x = (i / (series.values.length - 1)) * w;
              const y = h - ((parseFloat(v[1]) - min) / range) * (h - 10) - 5;
              return `${x},${y}`;
            });
            const color = colors[si % colors.length] ?? '#0066cc';
            return (
              <polyline
                key={si}
                points={points.join(' ')}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
        <div className="os-text-muted">
          {chart.series.slice(0, 4).map((s, i) => (
            <span key={i}>
              <Label color="blue">{s.label.slice(0, 40) || `series-${i}`}</Label>{' '}
            </span>
          ))}
          {chart.series.length > 4 && <span className="os-text-muted">+{chart.series.length - 4} more</span>}
        </div>
      </CardBody>
    </Card>
  );
}

function VariablePicker({ variable, onChange }: { variable: VariableOption; onChange: (val: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <ToolbarItem>
      <Select
        isOpen={open}
        selected={variable.selected}
        onSelect={(_e, val) => { onChange(val as string); setOpen(false); }}
        onOpenChange={setOpen}
        toggle={(toggleRef) => (
          <MenuToggle ref={toggleRef} onClick={() => setOpen(!open)} className="os-masthead__ns-toggle">
            {variable.label}: {variable.selected}
          </MenuToggle>
        )}
      >
        {variable.options.map((opt) => (
          <SelectOption key={opt} value={opt}>{opt}</SelectOption>
        ))}
      </Select>
    </ToolbarItem>
  );
}

export default function DashboardView() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [panels, setPanels] = useState<ChartData[]>([]);
  const [dashTitle, setDashTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [variables, setVariables] = useState<VariableOption[]>([]);
  const [varTick, setVarTick] = useState(0);

  // Load variable options on mount
  useEffect(() => {
    async function loadVars() {
      const options = await fetchVariableOptions();

      // Fetch dashboard to find which variables it uses
      try {
        const cmRes = await fetch(`${K8S_BASE}/api/v1/namespaces/openshift-config-managed/configmaps/${name}`);
        if (!cmRes.ok) return;
        const cm = await cmRes.json() as { data?: Record<string, string> };
        const dataKeys = Object.keys(cm.data ?? {});
        const jsonKey = dataKeys.find((k) => k.endsWith('.json')) ?? dataKeys[0];
        if (!jsonKey || !cm.data) return;

        const dashJson = JSON.parse(cm.data[jsonKey] ?? '{}') as { templating?: { list?: GrafanaTemplate[] } };
        const templates = dashJson.templating?.list ?? [];

        const vars: VariableOption[] = [];
        for (const tpl of templates) {
          if (tpl.type === 'datasource' || tpl.type === 'constant' || tpl.type === 'interval' || tpl.type === 'custom') continue;
          const name = tpl.name;
          const label = tpl.label ?? tpl.name;
          const opts = options[name] ?? [];
          if (opts.length === 0) continue;

          vars.push({
            name,
            label,
            options: opts,
            selected: tpl.current?.value ?? opts[0] ?? '',
          });
        }
        setVariables(vars);
      } catch {
        // ignore
      }
    }
    loadVars();
  }, [name]);

  const handleVariableChange = useCallback((varName: string, value: string) => {
    setVariables((prev) =>
      prev.map((v) => v.name === varName ? { ...v, selected: value } : v)
    );
    setVarTick((t) => t + 1);
  }, []);

  // Query Prometheus when variables change
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const templateVars = buildTemplateVars(variables);

        const cmRes = await fetch(`${K8S_BASE}/api/v1/namespaces/openshift-config-managed/configmaps/${name}`);
        if (!cmRes.ok) { setLoading(false); return; }
        const cm = await cmRes.json() as { data?: Record<string, string> };

        const dataKeys = Object.keys(cm.data ?? {});
        const jsonKey = dataKeys.find((k) => k.endsWith('.json')) ?? dataKeys[0];
        if (!jsonKey || !cm.data) { setLoading(false); return; }

        const dashJson = JSON.parse(cm.data[jsonKey] ?? '{}') as {
          title?: string;
          panels?: GrafanaPanel[];
          rows?: { panels?: GrafanaPanel[] }[];
        };
        setDashTitle(dashJson.title ?? name ?? 'Dashboard');

        // Collect panels from all Grafana structures (flat, rows, nested)
        const topPanels = dashJson.panels ?? [];
        const rowPanels = (dashJson.rows ?? []).flatMap((r) => r.panels ?? []);
        const nestedPanels = topPanels.flatMap((p) => (p as unknown as { panels?: GrafanaPanel[] }).panels ?? []);
        const allPanels: GrafanaPanel[] = [...topPanels, ...rowPanels, ...nestedPanels];

        const queryPanels = allPanels.filter((p) =>
          p.targets && p.targets.length > 0 && p.targets[0]?.expr
        );

        const end = Math.floor(Date.now() / 1000);
        const start = end - 3600;
        const step = 60;

        const chartData: ChartData[] = [];
        for (const panel of queryPanels.slice(0, 16)) {
          const target = panel.targets?.[0];
          if (!target?.expr) continue;

          try {
            const resolvedExpr = substituteVariables(target.expr, templateVars);
            const query = encodeURIComponent(resolvedExpr);
            const promRes = await fetch(
              `${PROM_BASE}/api/v1/query_range?query=${query}&start=${start}&end=${end}&step=${step}`
            );
            if (!promRes.ok) continue;
            const promData = await promRes.json() as { data?: { result?: PromResult[] } };
            const results = promData.data?.result ?? [];

            chartData.push({
              title: panel.title || resolvedExpr.slice(0, 50),
              series: results.slice(0, 10).map((r) => ({
                label: target.legendFormat
                  ? Object.entries(r.metric).reduce(
                      (fmt, [k, v]) => fmt.replace(`{{${k}}}`, v),
                      target.legendFormat
                    )
                  : Object.values(r.metric).slice(0, 3).join(' / ') || 'value',
                values: r.values,
              })),
            });
          } catch {
            // Query may fail
          }
        }

        setPanels(chartData);
      } catch {
        // API may not be available
      }
      setLoading(false);
    }
    load();
  }, [name, varTick, variables.length]);

  return (
    <>
      <PageSection variant="default">
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={() => navigate('/observe/dashboards')}>
            Dashboards
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{dashTitle || name}</BreadcrumbItem>
        </Breadcrumb>
        <Title headingLevel="h1" size="2xl">{dashTitle || name}</Title>
        <p className="os-list__description">
          {panels.length} panels with live Prometheus data (last 1 hour)
        </p>
      </PageSection>

      {variables.length > 0 && (
        <PageSection>
          <Toolbar>
            <ToolbarContent>
              {variables.map((v) => (
                <VariablePicker
                  key={v.name}
                  variable={v}
                  onChange={(val) => handleVariableChange(v.name, val)}
                />
              ))}
            </ToolbarContent>
          </Toolbar>
        </PageSection>
      )}

      <PageSection>
        {loading ? (
          <p className="os-text-muted">Loading dashboard and querying Prometheus...</p>
        ) : panels.length === 0 ? (
          <Card>
            <CardBody>
              <p className="os-text-muted">No chart data available. Try selecting different variable values above.</p>
            </CardBody>
          </Card>
        ) : (
          <Grid hasGutter>
            {panels.map((chart, i) => (
              <GridItem key={i} md={6}>
                <PromChart chart={chart} />
              </GridItem>
            ))}
          </Grid>
        )}
      </PageSection>
    </>
  );
}
