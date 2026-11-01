import { describe, it, expect } from 'vitest';
import { buildUpgradeModel, channelOptions, desiredUpdatePatch, parseCvoProgress, compareVersions } from '../upgradeGraph';
import { idleClusterVersion, inFlightClusterVersion, operatorsMidUpdate, poolsMidUpdate, OVN_RISK, DNS_RISK } from '../../__fixtures__/clusterVersionUpdates';

describe('buildUpgradeModel', () => {
  it('classifies targets by what the cluster says, newest first', () => {
    const m = buildUpgradeModel({ clusterVersion: idleClusterVersion() });
    expect(m.current).toEqual({ version: '4.16.3', image: 'quay.io/ocp@sha256:aaa', channel: 'stable-4.16' });
    expect(m.nodes.map((n) => [n.version, n.state])).toEqual([
      ['4.17.2', 'recommended'], ['4.17.1', 'conditional'], ['4.16.8', 'recommended'],
    ]);
    const cond = m.nodes.find((n) => n.version === '4.17.1')!;
    expect(cond.risks.map((r) => r.name)).toEqual(['OVNInterconnectMigration', 'AROBrokenDNSMasq']);
    expect(cond.recommendation).toBe('Two risks apply to this cluster');
    expect(m.progress.phase).toBe('idle');
    expect(m.edges!.every((e) => e.from === '4.16.3')).toBe(true);
  });

  it('blocks only minor-version targets while Upgradeable=False', () => {
    const m = buildUpgradeModel({ clusterVersion: idleClusterVersion({ upgradeableFalse: true }) });
    expect(Object.fromEntries(m.nodes.map((n) => [n.version, n.state]))).toEqual({ '4.17.2': 'blocked', '4.17.1': 'blocked', '4.16.8': 'recommended' });
    expect(m.blockers[0]).toMatchObject({ type: 'upgradeable', reason: 'AdminAckRequired' });
  });

  it('in flight: targets come from the release being reconciled, with progress parsed', () => {
    const m = buildUpgradeModel({ clusterVersion: inFlightClusterVersion(), operators: operatorsMidUpdate, pools: poolsMidUpdate });
    expect(m.current.version).toBe('4.16.3');
    expect(m.updatesFrom).toBe('4.16.8');
    expect(m.edges).toEqual([{ from: '4.16.8', to: '4.16.10' }]);
    expect(m.progress).toMatchObject({ phase: 'progressing', done: 512, total: 863, percent: 59 });
    expect(m.progress.clusterOperators).toEqual({ updated: 2, total: 3, degraded: ['network'] });
    expect(m.progress.pools).toEqual([
      { name: 'master', updated: 3, total: 3, degraded: false, updating: false, paused: false },
      { name: 'worker', updated: 2, total: 5, degraded: false, updating: true, paused: true },
    ]);
    // Last completed update took 80 min; 41% remains.
    expect(m.progress.etaMinutes).toBe(33);
    expect(m.blockers).toEqual([{ type: 'pool', reason: 'Paused', message: 'MachineConfigPool worker is paused; its nodes will not update', link: '/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/worker' }]);
  });

  it('reports unreadable operators and pools as unknown, not zero', () => {
    const m = buildUpgradeModel({ clusterVersion: inFlightClusterVersion(), operators: null, pools: null });
    expect(m.progress.clusterOperators).toBeNull();
    expect(m.progress.pools).toBeNull();
  });
});

describe('desiredUpdatePatch', () => {
  it('sends version and image together for a recommended target', () => {
    expect(desiredUpdatePatch({ version: '4.16.8', image: 'quay.io/ocp@sha256:bbb', state: 'recommended', risks: [] }))
      .toEqual({ spec: { desiredUpdate: { version: '4.16.8', image: 'quay.io/ocp@sha256:bbb' } } });
  });

  it('accepts every risk of a conditional target and keeps risks accepted before', () => {
    const patch = desiredUpdatePatch(
      { version: '4.17.1', image: 'quay.io/ocp@sha256:ccc', state: 'conditional', risks: [OVN_RISK, DNS_RISK] },
      [{ name: 'OlderRisk' }, { name: 'AROBrokenDNSMasq' }],
    );
    expect(patch).toEqual({ spec: { desiredUpdate: {
      version: '4.17.1', image: 'quay.io/ocp@sha256:ccc',
      acceptRisks: [{ name: 'OlderRisk' }, { name: 'AROBrokenDNSMasq' }, { name: 'OVNInterconnectMigration' }],
    } } });
  });

  it('refuses a target without an image', () => {
    expect(() => desiredUpdatePatch({ version: '4.16.8', state: 'recommended', risks: [] })).toThrow(/No image digest/);
  });
});

describe('channelOptions', () => {
  it('offers the current and next minor, eus only for even minors', () => {
    expect(channelOptions('4.16.3', 'stable-4.16')).toEqual([
      'stable-4.16', 'fast-4.16', 'candidate-4.16', 'eus-4.16', 'stable-4.17', 'fast-4.17', 'candidate-4.17',
    ]);
  });
  it('uses the release channels when ClusterVersion lists them', () => {
    expect(channelOptions('4.16.3', 'stable-4.16', ['fast-4.16', 'stable-4.16', 'stable-4.17'])).toEqual(['fast-4.16', 'stable-4.16', 'stable-4.17']);
    expect(channelOptions('4.16.3', 'custom', ['stable-4.16'])).toEqual(['custom', 'stable-4.16']);
  });
});

describe('helpers', () => {
  it('parses CVO progress and computes a missing percent', () => {
    expect(parseCvoProgress('Working towards 4.16.8: 1 of 4 done')).toEqual({ done: 1, total: 4, percent: 25 });
    expect(parseCvoProgress('Cluster version is 4.16.3')).toBeNull();
  });
  it('sorts pre-releases before their release', () => {
    expect(['4.17.0', '4.17.0-rc.1', '4.16.10', '4.16.9'].sort(compareVersions)).toEqual(['4.16.9', '4.16.10', '4.17.0-rc.1', '4.17.0']);
  });
});
