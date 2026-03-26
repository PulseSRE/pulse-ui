import { describe, it, expect } from 'vitest';
import { getTabTitle } from '../TabBar';

describe('getTabTitle', () => {
  // Detail paths: /r/{gvr}/{namespace}/{name} → "name (Kind)"
  it('returns "name (Deployment)" for deployment detail path', () => {
    expect(getTabTitle('/r/apps~v1~deployments/default/nginx')).toBe('nginx (Deployment)');
  });

  it('returns "name (Pod)" for pod detail path', () => {
    expect(getTabTitle('/r/v1~pods/kube-system/coredns')).toBe('coredns (Pod)');
  });

  it('returns "name (Node)" for node detail path with _ namespace', () => {
    expect(getTabTitle('/r/v1~nodes/_/worker-1')).toBe('worker-1 (Node)');
  });

  it('returns "name (Service)" for service detail path', () => {
    expect(getTabTitle('/r/v1~services/default/kubernetes')).toBe('kubernetes (Service)');
  });

  it('returns "name (Statefulset)" for statefulsets', () => {
    expect(getTabTitle('/r/apps~v1~statefulsets/default/redis')).toBe('redis (Statefulset)');
  });

  it('returns "name (Ingress)" for ingresses (pluralized with -es)', () => {
    expect(getTabTitle('/r/networking.k8s.io~v1~ingresses/default/my-ingress')).toBe('my-ingress (Ingress)');
  });

  it('returns "name (Policy)" for policies (pluralized with -ies)', () => {
    expect(getTabTitle('/r/networking.k8s.io~v1~networkpolicies/default/deny-all')).toBe('deny-all (Networkpolicy)');
  });

  // List paths: /r/{gvr} → "Plural"
  it('returns "Deployments" for deployment list path', () => {
    expect(getTabTitle('/r/apps~v1~deployments')).toBe('Deployments');
  });

  it('returns "Pods" for pod list path', () => {
    expect(getTabTitle('/r/v1~pods')).toBe('Pods');
  });

  it('returns "Nodes" for node list path', () => {
    expect(getTabTitle('/r/v1~nodes')).toBe('Nodes');
  });

  // YAML paths
  it('returns "name (YAML)" for yaml path', () => {
    expect(getTabTitle('/yaml/apps~v1~deployments/default/nginx')).toBe('nginx (YAML)');
  });

  // Logs paths
  it('returns "name (Logs)" for logs path', () => {
    expect(getTabTitle('/logs/default/my-pod')).toBe('my-pod (Logs)');
  });

  // Metrics paths
  it('returns "name (Metrics)" for metrics path', () => {
    expect(getTabTitle('/metrics/apps~v1~deployments/default/nginx')).toBe('nginx (Metrics)');
  });

  // Generic paths
  it('returns capitalized last segment for generic paths', () => {
    expect(getTabTitle('/workloads')).toBe('Workloads');
  });

  it('returns "Untitled" for root path', () => {
    expect(getTabTitle('/')).toBe('Untitled');
  });
});
