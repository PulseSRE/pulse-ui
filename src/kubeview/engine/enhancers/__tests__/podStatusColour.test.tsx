// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { podEnhancer, podStatusLabel } from '../pods';

afterEach(cleanup);

// The Pods list status dot uses podPhaseTone, the same palette as the node map
// and the topology pod grid: Pending is amber, start-up is blue.
function dot(pod: Record<string, unknown>): string {
  const col = podEnhancer.columns.find((c) => c.id === 'status')!;
  const { container } = render(<>{col.render!(undefined, pod as never)}</>);
  return (container.querySelector('span > span') as HTMLElement).className;
}

const cs = (state: Record<string, unknown>, ready = false) => [{ name: 'c', ready, restartCount: 0, state }];

describe('Pods list status colour', () => {
  it('Pending (not scheduled) is amber', () => {
    expect(dot({ status: { phase: 'Pending' } })).toContain('bg-amber-500');
  });

  it('ContainerCreating is blue (progress), not amber', () => {
    expect(dot({ status: { phase: 'Pending', containerStatuses: cs({ waiting: { reason: 'ContainerCreating' } }) } })).toContain('bg-blue-500');
  });

  it('a crash-looping pod is red', () => {
    expect(dot({ status: { phase: 'Running', containerStatuses: cs({ waiting: { reason: 'CrashLoopBackOff' } }) } })).toContain('bg-red-500');
  });

  it('Running and ready is emerald; Running not ready is amber', () => {
    expect(dot({ status: { phase: 'Running', containerStatuses: cs({ running: {} }, true) } })).toContain('bg-emerald-500');
    expect(dot({ status: { phase: 'Running', containerStatuses: cs({ running: {} }, false) } })).toContain('bg-amber-500');
  });

  it('never yellow', () => {
    for (const phase of ['Pending', 'Running', 'Succeeded', 'Failed', 'Unknown']) {
      expect(dot({ status: { phase } })).not.toMatch(/yellow/);
    }
  });
});

// The status text said "Pending" for a pod waiting on a node and for one
// pulling its image. It now says why, and the dot keeps podPhaseTone's colour.
function cell(pod: Record<string, unknown>) {
  const col = podEnhancer.columns.find((c) => c.id === 'status')!;
  const { container } = render(<>{col.render!(undefined, pod as never)}</>);
  const outer = container.firstElementChild as HTMLElement;
  return {
    text: outer.textContent,
    title: outer.getAttribute('title'),
    dot: (outer.querySelector('span') as HTMLElement).className,
    sortValue: col.accessorFn!(pod as never),
  };
}

describe('Pods list status says why a pod is Pending', () => {
  const unscheduled = {
    status: {
      phase: 'Pending',
      conditions: [
        {
          type: 'PodScheduled',
          status: 'False',
          reason: 'Unschedulable',
          message: '0/3 nodes are available: 3 Insufficient memory.',
        },
      ],
    },
  };

  it('an unscheduled pod reads "Pending: Unschedulable" with the scheduler message on hover, amber', () => {
    const c = cell(unscheduled);
    expect(c.text).toBe('Pending: Unschedulable');
    expect(c.title).toBe('Pending: Unschedulable — 0/3 nodes are available: 3 Insufficient memory.');
    expect(c.dot).toContain('bg-amber-500');
    expect(c.sortValue).toBe('Pending: Unschedulable');
  });

  it('a pod creating its containers reads "ContainerCreating", blue', () => {
    const c = cell({ status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'True' }], containerStatuses: cs({ waiting: { reason: 'ContainerCreating' } }) } });
    expect(c.text).toBe('ContainerCreating');
    expect(c.dot).toContain('bg-blue-500');
    expect(c.sortValue).toBe('ContainerCreating');
  });

  it('PodInitializing and ImagePullBackOff show their reason; the pull message is the detail', () => {
    expect(cell({ status: { phase: 'Pending', containerStatuses: cs({ waiting: { reason: 'PodInitializing' } }) } }).text).toBe('PodInitializing');
    const pull = cell({
      status: { phase: 'Pending', containerStatuses: cs({ waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image "nope:1"' } }) },
    });
    expect(pull.text).toBe('ImagePullBackOff');
    expect(pull.title).toBe('ImagePullBackOff — Back-off pulling image "nope:1"');
    expect(pull.dot).toContain('bg-red-500');
  });

  it('CrashLoopBackOff on a Running pod is unchanged', () => {
    expect(cell({ status: { phase: 'Running', containerStatuses: cs({ waiting: { reason: 'CrashLoopBackOff' } }) } }).text).toBe('CrashLoopBackOff');
  });

  it('a Pending pod with nothing to say stays "Pending"; Running stays "Running"', () => {
    expect(podStatusLabel({ status: { phase: 'Pending' } })).toEqual({ text: 'Pending' });
    expect(podStatusLabel({ status: { phase: 'Running', containerStatuses: cs({ running: {} }, true) } })).toEqual({ text: 'Running' });
  });

  it('the column stays sortable', () => {
    expect(podEnhancer.columns.find((c) => c.id === 'status')!.sortable).toBe(true);
  });
});
