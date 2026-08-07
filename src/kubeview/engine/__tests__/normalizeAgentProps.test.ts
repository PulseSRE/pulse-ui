import { describe, it, expect } from 'vitest';
import { normalizeAgentProps } from '../normalizeAgentProps';
import type { ComponentSpec } from '../agentComponents';

describe('normalizeAgentProps', () => {
  it('flattens props wrapper', () => {
    const spec = { kind: 'metric_card', title: 'CPU', props: { value: '72%', status: 'warning' } } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    expect(result.value).toBe('72%');
    expect(result.status).toBe('warning');
    expect(result.props).toBeUndefined();
  });

  it('yaml_viewer: yaml → content', () => {
    const spec = { kind: 'yaml_viewer', yaml: 'key: val' } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    expect(result.content).toBe('key: val');
  });

  it('stat_card: label → title', () => {
    const spec = { kind: 'stat_card', label: 'Errors', value: '3' } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    expect(result.title).toBe('Errors');
  });

  it('info_card_grid: card title→label, text→value', () => {
    const spec = { kind: 'info_card_grid', cards: [{ title: 'Nodes', text: '5' }] } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    const cards = result.cards as Array<Record<string, string>>;
    expect(cards[0].label).toBe('Nodes');
    expect(cards[0].value).toBe('5');
  });

  it('status_list: label → name, info → unknown', () => {
    const spec = { kind: 'status_list', items: [{ label: 'Alert', status: 'info' }] } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    const items = result.items as Array<Record<string, string>>;
    expect(items[0].name).toBe('Alert');
    expect(items[0].status).toBe('unknown');
  });

  it('status_list: preserves existing name field', () => {
    const spec = { kind: 'status_list', items: [{ name: 'Alert', status: 'warning' }] } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    const items = result.items as Array<Record<string, string>>;
    expect(items[0].name).toBe('Alert');
    expect(items[0].status).toBe('warning');
  });

  it('badge_list: label → text', () => {
    const spec = { kind: 'badge_list', badges: [{ label: 'v1', variant: 'info' }] } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    const badges = result.badges as Array<Record<string, string>>;
    expect(badges[0].text).toBe('v1');
  });

  it('log_viewer: warning → warn', () => {
    const spec = { kind: 'log_viewer', lines: [{ message: 'oops', level: 'warning' }] } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    const lines = result.lines as Array<Record<string, string>>;
    expect(lines[0].level).toBe('warn');
  });

  it('chart: values → data', () => {
    const spec = { kind: 'chart', series: [{ label: 'cpu', values: [[1, 2]] }] } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec) as Record<string, unknown>;
    const series = result.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([[1, 2]]);
  });

  it('passes through already-correct specs unchanged', () => {
    const spec = { kind: 'metric_card', title: 'CPU', value: '72%' } as unknown as ComponentSpec;
    const result = normalizeAgentProps(spec);
    expect(result).toEqual(spec);
  });
});
