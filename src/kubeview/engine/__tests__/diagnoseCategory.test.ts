/**
 * The category hint page Diagnose sends: the agent's plan categories, read from
 * pod and node state, and nothing when the state is unclear.
 */
import { describe, it, expect } from 'vitest';
import {
  PLAN_CATEGORIES, isPlanCategory, inferPodCategory, inferPodsCategory, inferNodeCategory, categoryFromFinding,
} from '../diagnoseCategory';
import type { ContainerStatus } from '../types';

const cs = (state: ContainerStatus['state'], lastState?: ContainerStatus['state'], name = 'app'): ContainerStatus =>
  ({ name, ready: false, restartCount: 3, state, lastState });
const pod = (containers: ContainerStatus[], extra: Record<string, unknown> = {}) =>
  ({ status: { phase: 'Running', containerStatuses: containers, ...extra } });
const unschedulable = { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }] };

describe('plan categories', () => {
  it('are exactly the agent\'s scanner categories that have a plan template', () => {
    // pulse-agent inbox_investigation.PLAN_CATEGORY_HINTS / plan_templates/*.yaml incident_type
    expect([...PLAN_CATEGORIES].sort()).toEqual(['crashloop', 'image_pull', 'nodes', 'oom', 'scheduling']);
    expect(isPlanCategory('crashloop')).toBe(true);
    for (const v of ['node_pressure', 'alerts', 'Crashloop', '', null, undefined, 3]) expect(isPlanCategory(v)).toBe(false);
  });
});

describe('inferPodCategory', () => {
  it.each([
    ['CrashLoopBackOff', cs({ waiting: { reason: 'CrashLoopBackOff' } }, { terminated: { reason: 'Error', exitCode: 1 } }), 'crashloop'],
    ['CrashLoopBackOff after an OOM kill', cs({ waiting: { reason: 'CrashLoopBackOff' } }, { terminated: { reason: 'OOMKilled', exitCode: 137 } }), 'oom'],
    ['terminated OOMKilled', cs({ terminated: { reason: 'OOMKilled', exitCode: 137 } }), 'oom'],
    ['ImagePullBackOff', cs({ waiting: { reason: 'ImagePullBackOff' } }), 'image_pull'],
    ['ErrImagePull', cs({ waiting: { reason: 'ErrImagePull' } }), 'image_pull'],
  ])('%s → its category', (_label, status, expected) => {
    expect(inferPodCategory(pod([status]))).toBe(expected);
  });

  it('Pending and unschedulable → scheduling', () => {
    expect(inferPodCategory({ status: unschedulable })).toBe('scheduling');
  });

  it('an init container counts', () => {
    expect(inferPodCategory({ status: { phase: 'Pending', initContainerStatuses: [cs({ waiting: { reason: 'ImagePullBackOff' } })] } })).toBe('image_pull');
  });

  it.each([
    ['a healthy pod', pod([{ name: 'app', ready: true, restartCount: 0, state: { running: {} } }])],
    ['a running pod whose last run was OOM-killed long ago', pod([{ ...cs({ running: {} }, { terminated: { reason: 'OOMKilled' } }), ready: true }])],
    ['Pending but not unschedulable (still pulling)', { status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'True' }] } }],
    ['Pending, unscheduled for another reason', { status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'SchedulingGated' }] } }],
    ['a config error (no plan for it)', pod([cs({ waiting: { reason: 'CreateContainerConfigError' } })])],
    ['containers that disagree', pod([cs({ waiting: { reason: 'ImagePullBackOff' } }, undefined, 'a'), cs({ waiting: { reason: 'CrashLoopBackOff' } }, undefined, 'b')])],
    ['no status', {}],
    ['nothing', undefined],
  ])('no hint when unsure: %s', (_label, p) => {
    expect(inferPodCategory(p as never)).toBeUndefined();
  });
});

describe('inferPodsCategory (a workload page)', () => {
  const crash = pod([cs({ waiting: { reason: 'CrashLoopBackOff' } })]);
  const healthy = pod([{ name: 'app', ready: true, restartCount: 0, state: { running: {} } }]);
  const pull = pod([cs({ waiting: { reason: 'ErrImagePull' } })]);

  it('the problem the failing pods share; healthy pods do not count against it', () => {
    expect(inferPodsCategory([healthy, crash, crash])).toBe('crashloop');
  });

  it('no hint when pods disagree, none fails, or there are no pods', () => {
    expect(inferPodsCategory([crash, pull])).toBeUndefined();
    expect(inferPodsCategory([healthy])).toBeUndefined();
    expect(inferPodsCategory([])).toBeUndefined();
  });

  it('a pod whose own containers disagree makes the workload unsure', () => {
    const mixed = pod([cs({ waiting: { reason: 'ImagePullBackOff' } }, undefined, 'a'), cs({ waiting: { reason: 'CrashLoopBackOff' } }, undefined, 'b')]);
    expect(inferPodsCategory([crash, mixed])).toBeUndefined();
  });
});

describe('inferNodeCategory', () => {
  it.each(['MemoryPressure', 'DiskPressure', 'PIDPressure'])('%s=True → nodes', (type) => {
    expect(inferNodeCategory({ status: { conditions: [{ type: 'Ready', status: 'True' }, { type, status: 'True' }] } })).toBe('nodes');
  });

  it('no pressure, or NotReady alone → no hint', () => {
    expect(inferNodeCategory({ status: { conditions: [{ type: 'MemoryPressure', status: 'False' }, { type: 'Ready', status: 'True' }] } })).toBeUndefined();
    expect(inferNodeCategory({ status: { conditions: [{ type: 'Ready', status: 'False' }] } })).toBeUndefined();
    expect(inferNodeCategory(undefined)).toBeUndefined();
  });
});

describe('categoryFromFinding', () => {
  it('a finding\'s category when a plan exists for it, else none', () => {
    expect(categoryFromFinding({ category: 'oom' })).toBe('oom');
    expect(categoryFromFinding({ category: 'nodes' })).toBe('nodes');
    expect(categoryFromFinding({ category: 'alerts' })).toBeUndefined();
    expect(categoryFromFinding({ category: 'workloads' })).toBeUndefined();
    expect(categoryFromFinding(null)).toBeUndefined();
  });
});
