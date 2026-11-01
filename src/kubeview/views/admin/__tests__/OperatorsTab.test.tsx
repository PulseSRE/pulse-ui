// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import type { K8sResource } from '../../../engine/renderers';
import { OperatorsTab } from '../OperatorsTab';

// --- Fixtures ---

function makeOperator(overrides: {
  name: string;
  available?: boolean;
  degraded?: boolean;
  progressing?: boolean;
  version?: string;
  message?: string;
}): K8sResource {
  const conditions = [];
  if (overrides.available !== false) {
    conditions.push({ type: 'Available', status: overrides.available === false ? 'False' : 'True' });
  }
  if (overrides.degraded) {
    conditions.push({ type: 'Degraded', status: 'True', message: overrides.message || '' });
  } else {
    conditions.push({ type: 'Degraded', status: 'False' });
  }
  if (overrides.progressing) {
    conditions.push({ type: 'Progressing', status: 'True', message: overrides.message || '' });
  } else {
    conditions.push({ type: 'Progressing', status: 'False' });
  }

  return {
    apiVersion: 'config.openshift.io/v1',
    kind: 'ClusterOperator',
    metadata: {
      name: overrides.name,
      uid: `co-${overrides.name}`,
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    status: {
      conditions,
      versions: overrides.version
        ? [{ name: 'operator', version: overrides.version }]
        : [],
    },
  } as unknown as K8sResource;
}

describe('OperatorsTab', () => {
  const goMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders summary cards with correct counts', () => {
    const operators = [
      makeOperator({ name: 'console', available: true }),
      makeOperator({ name: 'dns', available: true }),
      makeOperator({ name: 'etcd', degraded: true, message: 'etcd is unhealthy' }),
      makeOperator({ name: 'ingress', progressing: true, message: 'updating to 4.15' }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);

    expect(screen.getByText('Available')).toBeDefined();
    expect(screen.getByText('Degraded')).toBeDefined();
    expect(screen.getByText('Progressing')).toBeDefined();

    // Available count: console + dns + ingress = 3 (ingress is available even though progressing)
    expect(screen.getByText('3')).toBeDefined();
  });

  it('renders operator names in the list', () => {
    const operators = [
      makeOperator({ name: 'console', available: true, version: '4.15.3' }),
      makeOperator({ name: 'dns', available: true, version: '4.15.3' }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);

    expect(screen.getByText('console')).toBeDefined();
    expect(screen.getByText('dns')).toBeDefined();
  });

  it('shows version number when available', () => {
    const operators = [
      makeOperator({ name: 'console', available: true, version: '4.15.3' }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);
    expect(screen.getByText('4.15.3')).toBeDefined();
  });

  it('shows degraded message for degraded operators', () => {
    const operators = [
      makeOperator({ name: 'etcd', degraded: true, message: 'EtcdMembersDown' }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);
    expect(screen.getByText('EtcdMembersDown')).toBeDefined();
  });

  it('shows progressing message for progressing operators', () => {
    const operators = [
      makeOperator({ name: 'kube-apiserver', progressing: true, message: 'updating to 4.16.0' }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);
    expect(screen.getByText('updating to 4.16.0')).toBeDefined();
  });

  it('sorts degraded operators first, then progressing, then by name', () => {
    const operators = [
      makeOperator({ name: 'dns', available: true }),
      makeOperator({ name: 'console', available: true }),
      makeOperator({ name: 'etcd', degraded: true }),
      makeOperator({ name: 'ingress', progressing: true }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);

    const names = screen.getAllByText(/^(etcd|ingress|console|dns)$/);
    expect(names[0].textContent).toBe('etcd');       // degraded first
    expect(names[1].textContent).toBe('ingress');    // progressing next
    expect(names[2].textContent).toBe('console');    // alphabetical
    expect(names[3].textContent).toBe('dns');        // alphabetical
  });

  it('navigates to operator detail on row click', () => {
    const operators = [
      makeOperator({ name: 'console', available: true }),
    ];

    render(<OperatorsTab operators={operators} go={goMock} />);

    fireEvent.click(screen.getByText('console'));
    expect(goMock).toHaveBeenCalledWith(
      '/r/config.openshift.io~v1~clusteroperators/_/console',
      'console',
    );
  });

  it('renders empty list with zero counts when no operators', () => {
    render(<OperatorsTab operators={[]} go={goMock} />);

    // All three summary cards should show 0
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(3);
  });
});
