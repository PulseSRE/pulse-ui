// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../../components/primitives/Card', () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
}));

vi.mock('../CanaryProgress', () => ({
  CanaryProgress: ({ rollout }: any) => <div data-testid="canary-progress">{rollout.metadata.name}</div>,
}));

import { RolloutsTab } from '../RolloutsTab';
import type { Rollout } from '../../../engine/types/argoRollouts';

function makeRollout(name: string, phase: string, strategy: 'canary' | 'blueGreen' = 'canary'): Rollout {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Rollout',
    metadata: { name, namespace: 'default', uid: `rollout-${name}`, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      replicas: 3,
      strategy: strategy === 'canary'
        ? { canary: { steps: [{ setWeight: 20 }, { pause: {} }] } }
        : { blueGreen: { activeService: 'active-svc', previewService: 'preview-svc' } },
    },
    status: {
      phase: phase as any,
      readyReplicas: 3,
      currentStepIndex: 1,
      stableRS: 'abc',
      availableReplicas: 3,
      ...(strategy === 'blueGreen' ? {
        blueGreen: { activeSelector: 'abc1234567', previewSelector: 'def9876543' },
      } : {}),
    },
  } as Rollout;
}

describe('RolloutsTab', () => {
  const go = vi.fn();
  afterEach(cleanup);

  it('shows empty state when no rollouts', () => {
    render(<RolloutsTab rollouts={[]} go={go} />);
    expect(screen.getByText('No Argo Rollouts found')).toBeDefined();
    expect(screen.getByText(/Create a Rollout resource/)).toBeDefined();
  });

  it('renders rollout name and strategy', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Healthy')]} go={go} />);
    expect(screen.getByText('web')).toBeDefined();
    expect(screen.getByText('Canary')).toBeDefined();
    expect(screen.getByText('Healthy')).toBeDefined();
  });

  it('shows replica counts', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Healthy')]} go={go} />);
    expect(screen.getByText('3/3 ready')).toBeDefined();
  });

  it('shows namespace', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Healthy')]} go={go} />);
    expect(screen.getByText('default')).toBeDefined();
  });

  it('renders BlueGreen strategy label', () => {
    render(<RolloutsTab rollouts={[makeRollout('api', 'Healthy', 'blueGreen')]} go={go} />);
    expect(screen.getByText('BlueGreen')).toBeDefined();
  });

  it('shows step progress for canary', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Progressing')]} go={go} />);
    expect(screen.getByText('Step 1/2')).toBeDefined();
  });

  it('expands canary details on click', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Healthy')]} go={go} />);
    // Click the outer row button (type="button") to expand
    const buttons = screen.getAllByRole('button');
    const rowButton = buttons.find(b => b.getAttribute('type') === 'button' && b.textContent?.includes('web'));
    expect(rowButton).toBeDefined();
    fireEvent.click(rowButton!);
    expect(screen.getByTestId('canary-progress')).toBeDefined();
  });

  it('expands blue-green details on click', () => {
    render(<RolloutsTab rollouts={[makeRollout('api', 'Healthy', 'blueGreen')]} go={go} />);
    // Find and click the outer button (the row toggle)
    const buttons = screen.getAllByRole('button');
    const rowButton = buttons.find(b => b.textContent?.includes('api') && b.getAttribute('type') === 'button');
    if (rowButton) fireEvent.click(rowButton);
    expect(screen.getByText('Blue-Green Details')).toBeDefined();
    expect(screen.getByText('active-svc')).toBeDefined();
  });

  it('navigates to rollout resource on name click', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Healthy')]} go={go} />);
    fireEvent.click(screen.getByText('web'));
    expect(go).toHaveBeenCalledWith(
      '/r/argoproj.io~v1alpha1~rollouts/default/web',
      'web',
    );
  });

  it('renders multiple rollouts', () => {
    render(<RolloutsTab rollouts={[makeRollout('web', 'Healthy'), makeRollout('api', 'Paused')]} go={go} />);
    expect(screen.getByText('web')).toBeDefined();
    expect(screen.getByText('api')).toBeDefined();
    expect(screen.getByText('Paused')).toBeDefined();
  });
});
