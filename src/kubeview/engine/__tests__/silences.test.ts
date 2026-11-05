/**
 * Silence matchers: the same safety rules as the agent's sre_agent/silences.py,
 * Alertmanager's matching, and the cordoned-node suggestion.
 */
import { describe, expect, it } from 'vitest';
import { formatMatchers, labelsMatch, matcherProblem, minutesToCover, parseMatchers, suggestSilences } from '../silences';

describe('silence matchers', () => {
  it('parses all four operators and round-trips', () => {
    const ms = parseMatchers('{node="worker-5", alertname=~"A|B", severity!="info", job!~"x.*"}');
    expect(ms.map((m) => [m.name, m.isRegex, m.isEqual])).toEqual([['node', false, true], ['alertname', true, true], ['severity', false, false], ['job', true, false]]);
    expect(formatMatchers(ms)).toBe('node="worker-5", alertname=~"A|B", severity!="info", job!~"x.*"');
    expect(() => parseMatchers('node=worker-5')).toThrow(/Could not read/);
  });

  it.each(['', 'alertname=~".*"', 'alertname=~".+"', 'node=""', 'severity!="info"', 'alertname="Watchdog"', 'alertname=~"Watch.*", node="x"'])(
    'refuses %s', (text) => {
      expect(matcherProblem(text ? parseMatchers(text) : [])).not.toBeNull();
    },
  );

  it('accepts a narrow set and matches like Alertmanager (absent label = "")', () => {
    const ms = parseMatchers('node="worker-5", team!="x"');
    expect(matcherProblem(ms)).toBeNull();
    expect(labelsMatch({ node: 'worker-5', alertname: 'A' }, ms)).toBe(true);
    expect(labelsMatch({ node: 'worker-6' }, ms)).toBe(false);
  });

  it('suggests one silence per cordoned node naming exactly its firing alerts', () => {
    const alerts = [
      { labels: { alertname: 'KubeletDown', node: 'w5' }, state: 'firing' },
      { labels: { alertname: 'KubeNodeUnreachable', node: 'w5' }, state: 'firing' },
      { labels: { alertname: 'KubeNodeUnreachable', node: 'w6' }, state: 'firing' },
      { labels: { alertname: 'Pending', node: 'w5' }, state: 'pending' },
    ];
    const nodes = [{ metadata: { name: 'w5' }, spec: { unschedulable: true } }, { metadata: { name: 'w6' }, spec: {} }];
    const [s, ...rest] = suggestSilences(alerts, nodes as never);
    expect(rest).toHaveLength(0);
    expect(formatMatchers(s.matchers)).toBe('node="w5", alertname=~"KubeNodeUnreachable|KubeletDown"');
  });

  it('covers a due time in 15-minute steps, else 2 hours', () => {
    const now = 1_000_000_000_000;
    expect(minutesToCover(null, now)).toBe(120);
    expect(minutesToCover((now + 110 * 60_000) / 1000, now)).toBe(120);
    expect(minutesToCover((now + 10 * 60_000) / 1000, now)).toBe(30);
    expect(minutesToCover((now - 60_000) / 1000, now)).toBe(120);
  });
});
