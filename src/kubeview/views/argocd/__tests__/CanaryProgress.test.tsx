// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import { CanaryProgress } from '../CanaryProgress';
import type { Rollout } from '../../../engine/types/argoRollouts';

function makeCanaryRollout(overrides: Partial<Rollout> = {}): Rollout {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Rollout',
    metadata: { name: 'my-rollout', namespace: 'default', uid: 'r1', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      replicas: 3,
      strategy: {
        canary: {
          steps: [
            { setWeight: 20 },
            { pause: { duration: '30s' } },
            { setWeight: 50 },
            { pause: {} },
          ],
        },
      },
    },
    status: {
      phase: 'Progressing',
      currentStepIndex: 2,
      canaryWeight: 50,
      stableRS: 'abc123',
      availableReplicas: 3,
    },
    ...overrides,
  };
}

function makeBlueGreenRollout(): Rollout {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Rollout',
    metadata: { name: 'bg-rollout', namespace: 'default', uid: 'r2', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      replicas: 2,
      strategy: {
        blueGreen: {
          activeService: 'my-active-svc',
          previewService: 'my-preview-svc',
        },
      },
    },
    status: {
      phase: 'Healthy',
      stableRS: 'def456',
      availableReplicas: 2,
    },
  };
}

describe('CanaryProgress', () => {
  afterEach(cleanup);

  it('renders canary progress header', () => {
    render(<CanaryProgress rollout={makeCanaryRollout()} />);
    expect(screen.getByText('Canary Progress')).toBeDefined();
  });

  it('shows traffic weight split', () => {
    render(<CanaryProgress rollout={makeCanaryRollout()} />);
    expect(screen.getByText('Stable 50%')).toBeDefined();
    expect(screen.getByText('Canary 50%')).toBeDefined();
  });

  it('shows step count', () => {
    render(<CanaryProgress rollout={makeCanaryRollout()} />);
    expect(screen.getByText('Steps (2/4)')).toBeDefined();
  });

  it('shows step labels', () => {
    render(<CanaryProgress rollout={makeCanaryRollout()} />);
    expect(screen.getByText('20%')).toBeDefined();
    expect(screen.getByText('pause 30s')).toBeDefined();
    expect(screen.getByText('50%')).toBeDefined();
    expect(screen.getByText('pause')).toBeDefined();
  });

  it('shows Paused badge when rollout is paused', () => {
    const rollout = makeCanaryRollout();
    rollout.status!.phase = 'Paused';
    render(<CanaryProgress rollout={rollout} />);
    expect(screen.getByText('Paused')).toBeDefined();
  });

  it('shows replica info', () => {
    render(<CanaryProgress rollout={makeCanaryRollout()} />);
    expect(screen.getByText('Stable RS: abc123')).toBeDefined();
    expect(screen.getByText('Available: 3/3')).toBeDefined();
  });

  it('renders blue-green summary for non-canary rollout', () => {
    render(<CanaryProgress rollout={makeBlueGreenRollout()} />);
    expect(screen.getByText('Blue-Green Strategy')).toBeDefined();
    expect(screen.getByText(/Active: my-active-svc/)).toBeDefined();
    expect(screen.getByText(/Preview: my-preview-svc/)).toBeDefined();
  });

  it('handles rollout with no steps', () => {
    const rollout = makeCanaryRollout();
    rollout.spec!.strategy!.canary!.steps = [];
    render(<CanaryProgress rollout={rollout} />);
    expect(screen.getByText('Canary Progress')).toBeDefined();
    // no steps section should appear
    expect(screen.queryByText(/Steps/)).toBeNull();
  });

  it('shows analysis step label', () => {
    const rollout = makeCanaryRollout();
    rollout.spec!.strategy!.canary!.steps = [
      { analysis: { templates: [{ templateName: 'success-rate' }] } },
    ];
    rollout.status!.currentStepIndex = 0;
    render(<CanaryProgress rollout={rollout} />);
    expect(screen.getByText('analysis')).toBeDefined();
  });
});
