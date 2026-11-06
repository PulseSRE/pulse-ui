import { describe, it, expect } from 'vitest';
import { navMatchRank, NAV_ITEMS, PALETTE_SHORTCUTS, getNavByPath, type NavItem } from '../navRegistry';

const item = (label: string, keywords: string[] = [], subtitle?: string): NavItem =>
  ({ id: label, label, icon: 'X', path: `/${label}`, group: 'cluster', keywords, subtitle } as NavItem);

describe('navMatchRank', () => {
  it('orders exact label, label prefix, label substring, exact keyword, other match', () => {
    expect(navMatchRank(item('Builds'), 'builds')).toBe(0);
    expect(navMatchRank(item('Builds'), 'bui')).toBe(1);
    expect(navMatchRank(item('GitOps Builds'), 'builds')).toBe(2);
    expect(navMatchRank(item('Workloads', ['builds']), 'builds')).toBe(3);
    expect(navMatchRank(item('Workloads', ['buildconfigs']), 'builds')).toBe(-1);
    expect(navMatchRank(item('Workloads', [], 'pods and builds'), 'builds')).toBe(4);
    expect(navMatchRank(item('Workloads'), 'nothing')).toBe(-1);
  });

  it('every item matches an empty query equally', () => {
    expect(navMatchRank(item('Builds'), '')).toBe(0);
  });

  it('puts the Builds shortcut above Workloads for "builds"', () => {
    const all = [...NAV_ITEMS, ...PALETTE_SHORTCUTS];
    const ranked = all
      .map((nav) => ({ nav, rank: navMatchRank(nav, 'builds') }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map(({ nav }) => nav.id);
    expect(ranked[0]).toBe('builds');
    expect(ranked.indexOf('builds')).toBeLessThan(ranked.indexOf('workloads'));
  });
});

describe('getNavByPath', () => {
  it('ignores the query, so a ?tab= link gets its page icon', () => {
    expect(getNavByPath('/workloads?tab=builds')?.id).toBe('workloads');
  });
});
