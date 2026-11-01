// @vitest-environment jsdom
/**
 * Resource pages show each fact once: pod CPU/memory sparklines live in the
 * incident context (not PodSummary too), limits/probes in the Workload Audit
 * (not the Deployment's image rows too), and metadata as a key/value summary
 * instead of a JSON dump that repeated labels and annotations.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div> }));

import { PodSummary } from '../PodSummary';
import { DeploymentSummary } from '../DeploymentSummary';
import { MetadataSummary } from '../GenericDetailLayout';

afterEach(cleanup);

const pod = {
  apiVersion: 'v1', kind: 'Pod',
  metadata: { name: 'web-1', namespace: 'shop', uid: 'u1', creationTimestamp: '2026-01-01T00:00:00Z' },
  spec: { containers: [{ name: 'app', image: 'quay.io/x/app:1' }] },
  status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, ready: true }] },
};

describe('detail pages', () => {
  it('PodSummary has no CPU/memory sparklines of its own', () => {
    render(<MemoryRouter><PodSummary resource={pod as never} go={vi.fn()} /></MemoryRouter>);
    expect(screen.queryAllByTestId('metric-card')).toHaveLength(0);
  });

  it('DeploymentSummary leaves limits and probes to the Workload Audit', () => {
    const dep = {
      apiVersion: 'apps/v1', kind: 'Deployment',
      metadata: { name: 'web', namespace: 'shop', uid: 'd1', creationTimestamp: '2026-01-01T00:00:00Z', generation: 1 },
      spec: { replicas: 1, selector: { matchLabels: { app: 'web' } }, template: { spec: { containers: [{ name: 'app', image: 'quay.io/x/app:1' }] } } },
      status: { replicas: 1, readyReplicas: 1, availableReplicas: 1, observedGeneration: 1 },
    };
    render(<MemoryRouter><DeploymentSummary resource={dep as never} managedPods={[]} go={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('quay.io/x/app:1')).toBeDefined();
    expect(screen.queryByText('no limits')).toBeNull();
    expect(screen.queryByLabelText('No probes')).toBeNull();
  });

  it('MetadataSummary lists identity fields once and leaves labels/annotations to their sections', () => {
    render(<MetadataSummary metadata={{
      name: 'web', namespace: 'shop', uid: 'abc-123', creationTimestamp: '2026-01-01T00:00:00Z',
      labels: { app: 'web' }, annotations: { note: 'hello' },
      ownerReferences: [{ kind: 'ReplicaSet', name: 'web-1' }], finalizers: ['x/y'],
    } as never} />);
    const dl = screen.getByTestId('metadata-summary');
    expect(dl.textContent).toContain('abc-123');
    expect(dl.textContent).toContain('ReplicaSet/web-1');
    expect(dl.textContent).toContain('x/y');
    expect(dl.textContent).not.toContain('hello');
    expect(dl.textContent).not.toContain('{');
  });
});
