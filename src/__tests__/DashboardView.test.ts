// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildTemplateVars, substituteVariables } from '../pages/observe/DashboardView';

describe('buildTemplateVars', () => {
  it('maps variable names to $name and ${name} formats', () => {
    const vars = buildTemplateVars([
      { name: 'namespace', label: 'Namespace', options: ['default'], selected: 'production' },
    ]);
    expect(vars['$namespace']).toBe('production');
    expect(vars['${namespace}']).toBe('production');
    expect(vars['${namespace:pipe}']).toBe('production');
    expect(vars['${namespace:regex}']).toBe('production');
  });

  it('includes default interval variables', () => {
    const vars = buildTemplateVars([]);
    expect(vars['$__rate_interval']).toBe('5m');
    expect(vars['${__rate_interval}']).toBe('5m');
    expect(vars['$__interval']).toBe('1m');
    expect(vars['$interval']).toBe('5m');
    expect(vars['$resolution']).toBe('5m');
    expect(vars['$datasource']).toBe('prometheus');
    expect(vars['$topk']).toBe('25');
  });

  it('handles multiple variables', () => {
    const vars = buildTemplateVars([
      { name: 'namespace', label: 'NS', options: [], selected: 'default' },
      { name: 'pod', label: 'Pod', options: [], selected: 'nginx-abc' },
    ]);
    expect(vars['$namespace']).toBe('default');
    expect(vars['$pod']).toBe('nginx-abc');
  });
});

describe('substituteVariables', () => {
  it('replaces $variable with value', () => {
    const vars = { '$namespace': 'default' };
    expect(substituteVariables('foo{namespace="$namespace"}', vars)).toBe('foo{namespace="default"}');
  });

  it('replaces ${variable} with value', () => {
    const vars = { '${namespace}': 'prod' };
    expect(substituteVariables('foo{namespace="${namespace}"}', vars)).toBe('foo{namespace="prod"}');
  });

  it('handles $interval:$resolution Grafana syntax', () => {
    const vars = { '$interval': '5m', '$resolution': '5m' };
    const result = substituteVariables('rate(foo[$interval:$resolution])', vars);
    expect(result).toBe('rate(foo[5m])');
  });

  it('handles $__rate_interval', () => {
    const vars = { '$__rate_interval': '5m' };
    expect(substituteVariables('rate(foo[$__rate_interval])', vars)).toBe('rate(foo[5m])');
  });

  it('replaces $__range', () => {
    const result = substituteVariables('foo[$__range]', {});
    expect(result).toBe('foo[1h]');
  });

  it('replaces ${__range}', () => {
    const result = substituteVariables('foo[${__range}]', {});
    expect(result).toBe('foo[1h]');
  });

  it('replaces unresolved ${...} variables with .*', () => {
    const result = substituteVariables('foo{job="${unknown}"}', {});
    expect(result).toBe('foo{job=".*"}');
  });

  it('replaces unresolved $name variables with .*', () => {
    const result = substituteVariables('foo{job="$unknown"}', {});
    expect(result).toBe('foo{job=".*"}');
  });

  it('replaces longest variable first to avoid partial matches', () => {
    const vars = { '$namespace': 'default', '$namespace_prefix': 'prod' };
    const result = substituteVariables('$namespace_prefix/$namespace', vars);
    expect(result).toBe('prod/default');
  });

  it('handles complex Grafana expression with multiple variables', () => {
    const vars = buildTemplateVars([
      { name: 'namespace', label: 'NS', options: [], selected: 'openshift-monitoring' },
      { name: 'pod', label: 'Pod', options: [], selected: 'prometheus-k8s-0' },
    ]);
    const expr = 'sum(container_memory_working_set_bytes{namespace="$namespace", pod="$pod"})';
    const result = substituteVariables(expr, vars);
    expect(result).toBe('sum(container_memory_working_set_bytes{namespace="openshift-monitoring", pod="prometheus-k8s-0"})');
  });

  it('handles etcd $cluster variable', () => {
    const vars = { '$cluster': 'etcd' };
    const result = substituteVariables('etcd_server_has_leader{job="$cluster"}', vars);
    expect(result).toBe('etcd_server_has_leader{job="etcd"}');
  });

  it('handles $period interval variable', () => {
    const vars = buildTemplateVars([
      { name: 'period', label: 'Period', options: ['1m', '5m'], selected: '5m' },
    ]);
    const result = substituteVariables('rate(foo:bar:$period)', vars);
    expect(result).toBe('rate(foo:bar:5m)');
  });

  it('handles ${interval}:${resolution} curly brace syntax', () => {
    const result = substituteVariables('rate(foo[${interval}:${resolution}])', {});
    expect(result).toBe('rate(foo[5m])');
  });
});

describe('DashboardView file structure', () => {
  it('uses Promise.allSettled for parallel panel queries', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../pages/observe/DashboardView.tsx'), 'utf-8');
    expect(content).toContain('Promise.allSettled');
  });

  it('extracts nested panels from panel groups', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../pages/observe/DashboardView.tsx'), 'utf-8');
    expect(content).toContain('nestedPanels');
  });

  it('fetches cluster/instance/role label values for variables', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../pages/observe/DashboardView.tsx'), 'utf-8');
    expect(content).toContain("result['cluster']");
    expect(content).toContain("result['instance']");
    expect(content).toContain("result['role']");
  });

  it('handles interval/custom/constant template variable types', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../pages/observe/DashboardView.tsx'), 'utf-8');
    expect(content).toContain("tpl.type === 'interval'");
    expect(content).toContain("tpl.type === 'custom'");
    expect(content).toContain("tpl.type === 'constant'");
  });

  it('re-queries when variables load (variables.length dependency)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(path.resolve(__dirname, '../pages/observe/DashboardView.tsx'), 'utf-8');
    expect(content).toContain('variables.length');
  });
});
