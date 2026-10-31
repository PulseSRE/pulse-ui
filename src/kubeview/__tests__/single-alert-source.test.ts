import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Firing Prometheus alerts must be fetched in exactly one place.
 *
 * They were fetched twice: useIncidentFeed read /api/prometheus/api/v1/rules
 * while ReportTab independently ran ALERTS{alertstate="firing"} through the
 * query API. Two endpoints, two caches, two classifications of the same
 * alerts — and they disagreed in front of users. The posture bar reported
 * "1 critical — SearchPVCNotPresent" while the report tab, on the same page
 * at the same moment, correctly reported 0 critical. SearchPVCNotPresent's
 * severity is `info`.
 *
 * Two numbers for one question is worse than either number alone, and the
 * duplication is invisible in review because the two call sites are in
 * different files and look individually reasonable. This test is a source
 * scan rather than a behavioural test for that reason: the property worth
 * protecting is "there is one of these", which no amount of rendering can
 * show.
 */

const SRC = path.resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => path.relative(SRC, f);

/**
 * Allowed to fetch alert rules directly.
 *
 * useIncidentFeed is the aggregate every surface should prefer.
 * useIncidentTimeline builds a time series rather than a current-state list,
 * and AlertsView is the dedicated alerts page. Both predate this test and are
 * defensible; what is not defensible is a *fourth* surface quietly adding its
 * own and disagreeing with the other three.
 */
const RULES_API_ALLOWLIST = [
  'kubeview/hooks/useIncidentFeed.ts',
  'kubeview/hooks/useIncidentTimeline.ts',
  'kubeview/views/AlertsView.tsx',
];

describe('firing alerts have a single source', () => {
  it('no new surface fetches the Prometheus rules API directly', () => {
    const offenders = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes('/api/prometheus/api/v1/rules'))
      .map(rel)
      .filter((f) => !RULES_API_ALLOWLIST.includes(f));
    expect(
      offenders,
      'prefer useIncidentFeed — independent alert fetches drift apart and ' +
        'produced two different critical counts on one page',
    ).toEqual([]);
  });

  it('nothing queries ALERTS{alertstate="firing"} directly', () => {
    const offenders = files
      .filter((f) => /ALERTS\{alertstate=/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(
      offenders,
      'route firing alerts through useIncidentFeed instead of a second query — ' +
        'two sources produced two different critical counts on one page',
    ).toEqual([]);
  });
});
