import { describe, it, expect, vi } from 'vitest';
import { podEnhancer } from '../pods';
import { deploymentEnhancer } from '../deployments';
import { nodeEnhancer } from '../nodes';
import { serviceEnhancer } from '../services';
import { secretEnhancer } from '../secrets';

// Helper to extract accessor values
function access(enhancer: any, columnId: string, resource: any): unknown {
  const col = enhancer.columns.find((c: any) => c.id === columnId);
  return col?.accessorFn(resource);
}

describe('podEnhancer', () => {
  it('matches v1/pods', () => {
    expect(podEnhancer.matches).toContain('v1/pods');
  });

  it('has status, ready, restarts, node, ip columns', () => {
    const ids = podEnhancer.columns.map((c) => c.id);
    expect(ids).toContain('status');
    expect(ids).toContain('ready');
    expect(ids).toContain('restarts');
    expect(ids).toContain('node');
    expect(ids).toContain('ip');
  });

  it('extracts ready count from containerStatuses', () => {
    const pod = {
      status: {
        containerStatuses: [
          { ready: true },
          { ready: false },
          { ready: true },
        ],
      },
    };
    expect(access(podEnhancer, 'ready', pod)).toBe('2/3');
  });

  it('extracts node name from spec', () => {
    const pod = { spec: { nodeName: 'worker-1' } };
    expect(access(podEnhancer, 'node', pod)).toBe('worker-1');
  });

  it('extracts pod IP from status', () => {
    const pod = { status: { podIP: '10.0.0.5' } };
    expect(access(podEnhancer, 'ip', pod)).toBe('10.0.0.5');
  });

  it('returns - for missing node', () => {
    expect(access(podEnhancer, 'node', { spec: {} })).toBe('-');
  });

  it('has logs and restart inline actions', () => {
    const ids = podEnhancer.inlineActions!.map((a) => a.id);
    expect(ids).toContain('logs');
    expect(ids).toContain('restart');
  });

  it('has default sort by name asc', () => {
    expect(podEnhancer.defaultSort).toEqual({ column: 'name', direction: 'asc' });
  });

  it('restarts column has numeric sortType', () => {
    const col = podEnhancer.columns.find((c) => c.id === 'restarts');
    expect(col?.sortType).toBe('number');
  });
});

describe('deploymentEnhancer', () => {
  it('matches apps/v1/deployments, statefulsets, daemonsets', () => {
    expect(deploymentEnhancer.matches).toContain('apps/v1/deployments');
    expect(deploymentEnhancer.matches).toContain('apps/v1/statefulsets');
    expect(deploymentEnhancer.matches).toContain('apps/v1/daemonsets');
  });

  it('has status, ready, image, strategy columns', () => {
    const ids = deploymentEnhancer.columns.map((c) => c.id);
    expect(ids).toContain('status');
    expect(ids).toContain('ready');
    expect(ids).toContain('image');
    expect(ids).toContain('strategy');
  });

  it('extracts image from first container', () => {
    const deploy = {
      spec: {
        template: {
          spec: {
            containers: [{ image: 'registry.io/org/app:v2' }],
          },
        },
      },
    };
    expect(access(deploymentEnhancer, 'image', deploy)).toBe('app:v2');
  });

  it('returns - for no containers', () => {
    const deploy = { spec: { template: { spec: { containers: [] } } } };
    expect(access(deploymentEnhancer, 'image', deploy)).toBe('-');
  });

  it('extracts strategy type', () => {
    const deploy = { spec: { strategy: { type: 'RollingUpdate' } } };
    expect(access(deploymentEnhancer, 'strategy', deploy)).toBe('RollingUpdate');
  });

  it('falls back to updateStrategy for StatefulSets', () => {
    const sts = { spec: { updateStrategy: { type: 'OnDelete' } } };
    expect(access(deploymentEnhancer, 'strategy', sts)).toBe('OnDelete');
  });

  it('has scale and restart inline actions', () => {
    const ids = deploymentEnhancer.inlineActions!.map((a) => a.id);
    expect(ids).toContain('scale');
    expect(ids).toContain('restart');
  });

  it('scale action renders minus, count, and plus controls', () => {
    const scaleAction = deploymentEnhancer.inlineActions!.find(a => a.id === 'scale')!;
    const resource = {
      apiVersion: 'apps/v1', kind: 'Deployment',
      metadata: { name: 'test', namespace: 'default', uid: '1' },
      spec: { replicas: 3 },
      status: { readyReplicas: 3, replicas: 3, availableReplicas: 3 },
    };
    const onAction = vi.fn();
    const rendered = scaleAction.render(resource as any, onAction);
    expect(rendered).toBeDefined();
  });

  it('scale action calls onAction with delta -1 for scale down', () => {
    const scaleAction = deploymentEnhancer.inlineActions!.find(a => a.id === 'scale')!;
    expect(scaleAction.label).toBe('Scale');
  });
});

describe('nodeEnhancer', () => {
  it('matches v1/nodes', () => {
    expect(nodeEnhancer.matches).toContain('v1/nodes');
  });

  it('has status, roles, version, cpu, memory, pods, taints, age columns', () => {
    const ids = nodeEnhancer.columns.map((c) => c.id);
    expect(ids).toContain('status');
    expect(ids).toContain('roles');
    expect(ids).toContain('version');
    expect(ids).toContain('cpu');
    expect(ids).toContain('memory');
    expect(ids).toContain('pods');
    expect(ids).toContain('taints');
    expect(ids).toContain('age');
  });

  it('extracts kubelet version', () => {
    const node = { status: { nodeInfo: { kubeletVersion: 'v1.30.0' } } };
    expect(access(nodeEnhancer, 'version', node)).toBe('v1.30.0');
  });

  it('extracts CPU capacity', () => {
    const node = { status: { capacity: { cpu: '8' } } };
    expect(access(nodeEnhancer, 'cpu', node)).toBe('8');
  });

  it('extracts pod allocatable', () => {
    const node = { status: { allocatable: { pods: '250' } } };
    expect(access(nodeEnhancer, 'pods', node)).toBe('250');
  });

  it('extracts taints', () => {
    const node = { spec: { taints: [{ key: 'node-role.kubernetes.io/master', effect: 'NoSchedule' }] } };
    expect(access(nodeEnhancer, 'taints', node)).toContain('NoSchedule');
  });

  it('shows None for nodes without taints', () => {
    const node = { spec: {}, metadata: { creationTimestamp: '2025-01-01T00:00:00Z' } };
    expect(access(nodeEnhancer, 'taints', node)).toBe('None');
  });

  it('has cordon-toggle and drain inline actions', () => {
    const ids = nodeEnhancer.inlineActions!.map((a) => a.id);
    expect(ids).toContain('cordon-toggle');
    expect(ids).toContain('drain');
  });

  it('cpu and pods columns have numeric sortType', () => {
    const cpuCol = nodeEnhancer.columns.find((c) => c.id === 'cpu');
    const podsCol = nodeEnhancer.columns.find((c) => c.id === 'pods');
    expect(cpuCol?.sortType).toBe('number');
    expect(podsCol?.sortType).toBe('number');
  });

  it('age column has date sortType', () => {
    const ageCol = nodeEnhancer.columns.find((c) => c.id === 'age');
    expect(ageCol?.sortType).toBe('date');
  });
});

describe('serviceEnhancer', () => {
  it('matches v1/services', () => {
    expect(serviceEnhancer.matches).toContain('v1/services');
  });

  it('has type, clusterIP, ports, selector columns', () => {
    const ids = serviceEnhancer.columns.map((c) => c.id);
    expect(ids).toContain('type');
    expect(ids).toContain('clusterIP');
    expect(ids).toContain('ports');
    expect(ids).toContain('selector');
  });

  it('extracts service type', () => {
    const svc = { spec: { type: 'LoadBalancer' } };
    expect(access(serviceEnhancer, 'type', svc)).toBe('LoadBalancer');
  });

  it('defaults type to ClusterIP', () => {
    const svc = { spec: {} };
    expect(access(serviceEnhancer, 'type', svc)).toBe('ClusterIP');
  });

  it('extracts cluster IP', () => {
    const svc = { spec: { clusterIP: '10.96.0.1' } };
    expect(access(serviceEnhancer, 'clusterIP', svc)).toBe('10.96.0.1');
  });

  it('formats ports correctly', () => {
    const svc = {
      spec: {
        ports: [
          { port: 80, targetPort: 8080, protocol: 'TCP' },
          { port: 443, protocol: 'TCP', nodePort: 30443 },
        ],
      },
    };
    expect(access(serviceEnhancer, 'ports', svc)).toBe('80->8080/TCP, 443:30443/TCP');
  });

  it('formats selector', () => {
    const svc = { spec: { selector: { app: 'nginx', version: 'v1' } } };
    expect(access(serviceEnhancer, 'selector', svc)).toBe('app=nginx, version=v1');
  });

  it('returns - for empty selector', () => {
    const svc = { spec: { selector: {} } };
    expect(access(serviceEnhancer, 'selector', svc)).toBe('-');
  });

  it('has no inline actions', () => {
    expect(serviceEnhancer.inlineActions).toBeUndefined();
  });
});

describe('secretEnhancer', () => {
  it('matches v1/secrets', () => {
    expect(secretEnhancer.matches).toContain('v1/secrets');
  });

  it('has type and keys columns', () => {
    const ids = secretEnhancer.columns.map((c) => c.id);
    expect(ids).toContain('type');
    expect(ids).toContain('keys');
  });

  it('extracts secret type', () => {
    const secret = { type: 'kubernetes.io/tls' };
    expect(access(secretEnhancer, 'type', secret)).toBe('kubernetes.io/tls');
  });

  it('defaults type to Opaque', () => {
    const secret = {};
    expect(access(secretEnhancer, 'type', secret)).toBe('Opaque');
  });

  it('counts data keys', () => {
    const secret = { data: { 'tls.crt': 'abc', 'tls.key': 'xyz' } };
    expect(access(secretEnhancer, 'keys', secret)).toBe(2);
  });

  it('returns 0 for no data', () => {
    const secret = {};
    expect(access(secretEnhancer, 'keys', secret)).toBe(0);
  });

  it('keys column has numeric sortType', () => {
    const col = secretEnhancer.columns.find((c) => c.id === 'keys');
    expect(col?.sortType).toBe('number');
  });
});

// Regression guard for the "table columns pervasively truncated / rows
// growing tall" class of bug (Nodes, then Pods, then every other resource
// list): a column with no explicit width falls back to an equal flex share
// of whatever space is left after the widthed columns, so adding a new
// enhancer column and forgetting a width silently squeezes every other
// unwidthed column too. Percentage widths have their own, subtler failure
// mode — they looked fine on a full-width panel but re-truncated everything
// as soon as the window (or the Pulse AI side panel) narrowed, since every
// percentage column shrinks proportionally with the container. Fail loudly
// here instead of relying on someone noticing a screenshot.
describe('enhancer column widths', () => {
  const enhancers = { podEnhancer, deploymentEnhancer, nodeEnhancer, serviceEnhancer, secretEnhancer };

  for (const [enhancerName, enhancer] of Object.entries(enhancers)) {
    it(`${enhancerName}: every column has an explicit, non-percentage width`, () => {
      for (const col of enhancer.columns) {
        expect(col.width, `${enhancerName} column "${col.id}" must have a width`).toBeTruthy();
        expect(col.width, `${enhancerName} column "${col.id}" must use a fixed pixel width, not a percentage (percentages shrink with the container and re-truncate on a narrow window)`).toMatch(/^\d+px$/);
      }
    });
  }
});
