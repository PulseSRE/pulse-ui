// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../engine/fleetDrift', () => ({
  fleetCompareResource: vi.fn(),
}));

vi.mock('../../../store/fleetStore', () => ({
  useFleetStore: vi.fn((selector: any) =>
    selector({
      clusters: [
        { id: 'c1', name: 'cluster-1', status: 'connected' },
        { id: 'c2', name: 'cluster-2', status: 'connected' },
      ],
    }),
  ),
}));

vi.mock('../../../store/clusterStore', () => ({
  useClusterStore: vi.fn((selector: any) =>
    selector({
      resourceRegistry: new Map([
        ['apps/v1/deployments', {
          kind: 'Deployment',
          group: 'apps',
          version: 'v1',
          plural: 'deployments',
          namespaced: true,
        }],
        ['core/v1/services', {
          kind: 'Service',
          group: '',
          version: 'v1',
          plural: 'services',
          namespaced: true,
        }],
        ['config.openshift.io/v1/apiservers', {
          kind: 'APIServer',
          group: 'config.openshift.io',
          version: 'v1',
          plural: 'apiservers',
          namespaced: false,
        }],
      ]),
    }),
  ),
}));

import { DriftDetectorView } from '../DriftDetectorView';
import { fleetCompareResource } from '../../../engine/fleetDrift';

const mockCompare = vi.mocked(fleetCompareResource);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('DriftDetectorView', () => {
  it('renders resource selector inputs', () => {
    render(<DriftDetectorView />);

    expect(screen.getByLabelText('Resource type')).toBeTruthy();
    expect(screen.getByLabelText('Namespace')).toBeTruthy();
    expect(screen.getByLabelText('Resource name')).toBeTruthy();
  });

  it('shows compare button', () => {
    render(<DriftDetectorView />);

    const buttons = screen.getAllByRole('button', { name: /compare/i });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('shows drift results after comparison', async () => {
    mockCompare.mockResolvedValue({
      resource: { apiPath: '/apis/apps/v1/deployments', name: 'my-app', namespace: 'default' },
      clusters: ['c1', 'c2'],
      totalClusters: 2,
      absentClusters: [],
      failedClusters: [],
      diffs: [
        { field: 'spec.replicas', values: { c1: 3, c2: 5 }, drifted: true },
        { field: 'spec.strategy.type', values: { c1: 'RollingUpdate', c2: 'RollingUpdate' }, drifted: false },
      ],
      identicalFields: 1,
      driftedFields: 1,
    });

    render(<DriftDetectorView />);

    // Fill in inputs
    const selects = screen.getAllByLabelText('Resource type');
    const names = screen.getAllByLabelText('Resource name');
    const namespaces = screen.getAllByLabelText('Namespace');
    fireEvent.change(selects[0], { target: { value: 'apps/v1/deployments' } });
    fireEvent.change(names[0], { target: { value: 'my-app' } });
    fireEvent.change(namespaces[0], { target: { value: 'default' } });

    const buttons = screen.getAllByRole('button', { name: /compare/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/1 of 2 fields match/).length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('spec.replicas').length).toBeGreaterThan(0);
  });

  it('shows identical message when no drift', async () => {
    mockCompare.mockResolvedValue({
      resource: { apiPath: '/apis/apps/v1/deployments', name: 'my-app', namespace: 'default' },
      clusters: ['c1', 'c2'],
      totalClusters: 2,
      absentClusters: [],
      failedClusters: [],
      diffs: [
        { field: 'spec.replicas', values: { c1: 3, c2: 3 }, drifted: false },
      ],
      identicalFields: 1,
      driftedFields: 0,
    });

    render(<DriftDetectorView />);

    const selects = screen.getAllByLabelText('Resource type');
    const names = screen.getAllByLabelText('Resource name');
    fireEvent.change(selects[0], { target: { value: 'apps/v1/deployments' } });
    fireEvent.change(names[0], { target: { value: 'my-app' } });
    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'default' } });

    const buttons = screen.getAllByRole('button', { name: /compare/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/Resources are identical across all 2 clusters/).length).toBeGreaterThan(0);
    });
  });

  it('requires a namespace for a namespaced type instead of guessing', () => {
    render(<DriftDetectorView />);
    fireEvent.change(screen.getByLabelText('Resource type'), { target: { value: 'apps/v1/deployments' } });
    fireEvent.change(screen.getByLabelText('Resource name'), { target: { value: 'my-app' } });
    const compare = screen.getByRole('button', { name: /compare/i }) as HTMLButtonElement;
    expect(compare.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'shop' } });
    expect(compare.disabled).toBe(false);
  });

  it('compares cluster-scoped config such as the APIServer', async () => {
    mockCompare.mockResolvedValue({
      resource: { apiPath: '/apis/config.openshift.io/v1/apiservers', name: 'cluster' },
      clusters: ['c1', 'c2'], diffs: [], identicalFields: 0, driftedFields: 0,
    });
    render(<DriftDetectorView />);
    fireEvent.change(screen.getByLabelText('Resource type'), { target: { value: 'config.openshift.io/v1/apiservers' } });
    expect((screen.getByLabelText('Namespace') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Resource name'), { target: { value: 'cluster' } });
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    await waitFor(() => expect(mockCompare).toHaveBeenCalledWith('/apis/config.openshift.io/v1/apiservers', 'cluster', undefined, ['c1', 'c2']));
  });

  it('shows the error when the comparison fails', async () => {
    mockCompare.mockRejectedValue(new Error('403 Forbidden'));
    render(<DriftDetectorView />);
    fireEvent.change(screen.getByLabelText('Resource type'), { target: { value: 'config.openshift.io/v1/apiservers' } });
    fireEvent.change(screen.getByLabelText('Resource name'), { target: { value: 'cluster' } });
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    expect(await screen.findByText('403 Forbidden')).toBeDefined();
  });

  it('never says "identical" when a cluster could not be read, and lists absent clusters as drift', async () => {
    // Before: failed and missing clusters were dropped, and one successful read
    // reported "Resources are identical across all clusters".
    mockCompare.mockResolvedValue({
      resource: { apiPath: '/apis/apps/v1/deployments', name: 'my-app', namespace: 'default' },
      clusters: ['c1'],
      totalClusters: 3,
      absentClusters: ['c2'],
      failedClusters: [{ id: 'c3', reason: 'Permission denied (403)' }],
      diffs: [{ field: 'spec.replicas', values: { c1: 3 }, drifted: false }],
      identicalFields: 1,
      driftedFields: 0,
    });

    render(<DriftDetectorView />);
    fireEvent.change(screen.getAllByLabelText('Resource type')[0], { target: { value: 'apps/v1/deployments' } });
    fireEvent.change(screen.getAllByLabelText('Resource name')[0], { target: { value: 'my-app' } });
    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'default' } });
    fireEvent.click(screen.getAllByRole('button', { name: /compare/i })[0]);

    await waitFor(() => expect(screen.getByText(/1 of 3 clusters compared/)).toBeTruthy());
    expect(screen.getByText(/Drift: the resource is absent on cluster-2/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('c3: Permission denied (403)');
    expect(document.body.textContent).not.toMatch(/identical across/);
  });
});
