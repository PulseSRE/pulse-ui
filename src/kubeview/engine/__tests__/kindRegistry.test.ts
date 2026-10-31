import { describe, it, expect, afterEach } from 'vitest';
import { resolveKind, setKindRegistry, gvrSegment } from '../kindRegistry';
import { resourceDetailUrl } from '../gvr';
import { kindToPlural } from '../renderers/index';
import { alertResource } from '../alertResource';
import { alertsToTimeline } from '../timeline';
import type { ResourceRegistry, ResourceType } from '../discovery';

function rt(group: string, version: string, kind: string, plural: string, namespaced: boolean): ResourceType {
  return { group, version, kind, plural, singularName: kind.toLowerCase(), namespaced, verbs: [], shortNames: [], categories: [] };
}

function registry(...types: ResourceType[]): ResourceRegistry {
  return new Map(types.map((t) => [`${t.group || 'core'}/${t.version}/${t.plural}`, t]));
}

afterEach(() => setKindRegistry(null));

describe('resolveKind without discovery (well-known kinds)', () => {
  it.each([
    ['Deployment', undefined, '/r/apps~v1~deployments/ns/x'],
    // ActivityTab used to hardcode 'v1' for every kind
    ['Deployment', 'v1', '/r/apps~v1~deployments/ns/x'],
    ['Ingress', 'networking.k8s.io/v1', '/r/networking.k8s.io~v1~ingresses/ns/x'],
    ['NetworkPolicy', undefined, '/r/networking.k8s.io~v1~networkpolicies/ns/x'],
    ['HPA', undefined, '/r/autoscaling~v2~horizontalpodautoscalers/ns/x'],
    ['PDB', undefined, '/r/policy~v1~poddisruptionbudgets/ns/x'],
    ['IngressController', 'operator.openshift.io/v1', '/r/operator.openshift.io~v1~ingresscontrollers/ns/x'],
    ['Prometheus', 'monitoring.coreos.com/v1', '/r/monitoring.coreos.com~v1~prometheuses/ns/x'],
  ])('%s (%s) → %s', (kind, apiVersion, url) => {
    expect(resourceDetailUrl({ apiVersion, kind, metadata: { name: 'x', namespace: 'ns' } })).toBe(url);
  });

  it('never gives a cluster-scoped kind a namespace segment', () => {
    // Node alerts carry the scraping namespace (openshift-monitoring)
    expect(resourceDetailUrl({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'w1', namespace: 'openshift-monitoring' } }))
      .toBe('/r/v1~nodes/_/w1');
    expect(resourceDetailUrl({ kind: 'ClusterOperator', metadata: { name: 'dns', namespace: 'x' } }))
      .toBe('/r/config.openshift.io~v1~clusteroperators/_/dns');
  });

  it('keeps an explicit group/version and guesses only the plural for unknown kinds', () => {
    expect(resolveKind('Widget', 'example.com/v1beta1')).toEqual({ group: 'example.com', version: 'v1beta1', plural: 'widgets', namespaced: undefined });
    expect(kindToPlural('Policy')).toBe('policies');
  });
});

describe('resolveKind with discovery', () => {
  it('uses discovered plural, version and scope first', () => {
    setKindRegistry(registry(
      rt('example.com', 'v2', 'Octopus', 'octopi', false),
      rt('', 'v1', 'Pod', 'pods', true),
    ));
    expect(kindToPlural('Octopus')).toBe('octopi');
    expect(resourceDetailUrl({ kind: 'Octopus', metadata: { name: 'o', namespace: 'sea' } })).toBe('/r/example.com~v2~octopi/_/o');
  });

  it('finds the real group when the caller only knew a bare v1', () => {
    setKindRegistry(registry(rt('apps', 'v1', 'Deployment', 'deployments', true)));
    expect(gvrSegment(resolveKind('Deployment', 'v1'))).toBe('apps~v1~deployments');
  });

  it('keeps the caller version within the same group', () => {
    setKindRegistry(registry(rt('autoscaling', 'v2', 'HorizontalPodAutoscaler', 'horizontalpodautoscalers', true)));
    expect(gvrSegment(resolveKind('HorizontalPodAutoscaler', 'autoscaling/v1'))).toBe('autoscaling~v1~horizontalpodautoscalers');
  });
});

describe('alert → resource', () => {
  it('does not treat the scrape job label as a batch Job', () => {
    expect(alertResource({ alertname: 'TargetDown', job: 'kube-state-metrics', namespace: 'openshift-monitoring' })).toBeUndefined();
    expect(alertResource({ job_name: 'backup-123', namespace: 'ops' })).toEqual({ apiVersion: 'batch/v1', kind: 'Job', name: 'backup-123', namespace: 'ops' });
  });

  it('drops the namespace for Nodes', () => {
    expect(alertResource({ node: 'w1', namespace: 'openshift-monitoring' })).toEqual({ apiVersion: 'v1', kind: 'Node', name: 'w1', namespace: undefined });
  });

  it('prefers the most specific object, and the timeline agrees with the Alerts page', () => {
    const labels = { pod: 'web-1', deployment: 'web', node: 'w1', namespace: 'shop' };
    expect(alertResource(labels)?.kind).toBe('Pod');
    const [entry] = alertsToTimeline([{ name: 'g', rules: [{ name: 'R', query: 'q', state: 'firing', labels: {}, annotations: {}, alerts: [{ labels, annotations: {}, state: 'firing', activeAt: '2026-01-01T00:00:00Z' }] as never }] }]);
    expect(entry.resource).toEqual(alertResource(labels));
  });

  it('links timeline Node alerts without a namespace', () => {
    const [entry] = alertsToTimeline([{ name: 'g', rules: [{ name: 'NodeDown', query: 'q', state: 'firing', labels: {}, annotations: {}, alerts: [{ labels: { node: 'w1', namespace: 'openshift-monitoring' }, annotations: {}, state: 'firing', activeAt: '2026-01-01T00:00:00Z' }] as never }] }]);
    expect(resourceDetailUrl({ apiVersion: entry.resource!.apiVersion, kind: entry.resource!.kind, metadata: { name: entry.resource!.name, namespace: entry.resource!.namespace } }))
      .toBe('/r/v1~nodes/_/w1');
  });
});
