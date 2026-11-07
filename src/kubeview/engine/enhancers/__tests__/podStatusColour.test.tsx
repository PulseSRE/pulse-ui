// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { podEnhancer } from '../pods';

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
