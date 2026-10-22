// @vitest-environment jsdom
/**
 * "Restart" on a pod deletes it. It used to do so on one click, and for a pod
 * no controller owns that is a permanent delete. It now waits for a
 * confirmation that says which of the two it is, and deletes only that object.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const k8sDelete = vi.fn(() => Promise.resolve());
const k8sPatch = vi.fn(() => Promise.resolve({}));
vi.mock('../../../engine/query', () => ({ k8sDelete: (...a: unknown[]) => k8sDelete(...(a as [])), k8sPatch: (...a: unknown[]) => k8sPatch(...(a as [])) }));
vi.mock('../../../engine/errorToast', () => ({ showErrorToast: vi.fn() }));

import { useTableActions } from '../TableActions';
import type { K8sResource } from '../../../engine/renderers';

const pod: K8sResource = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name: 'web-1', namespace: 'shop', uid: 'u1', resourceVersion: '42' },
};

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useTableActions({
    apiPath: '/api/v1/pods',
    gvrKey: 'v1/pods',
    sortedResources: [pod],
    stampedResources: [pod],
    visibleColumns: [],
    resourceKind: 'Pod',
    selectedRows: new Set(),
    setSelectedRows: vi.fn(),
  }), { wrapper });
}

describe('pod restart', () => {
  beforeEach(() => { k8sDelete.mockClear(); k8sPatch.mockClear(); });

  it('asks before deleting anything', async () => {
    const { result } = setup();
    await act(() => result.current.handleAction('restart', { resource: pod }));
    expect(k8sDelete).not.toHaveBeenCalled();
    expect(result.current.pendingRestart?.resource).toBe(pod);
  });

  it('on confirmation deletes exactly the object that was shown', async () => {
    const { result } = setup();
    await act(() => result.current.handleAction('restart', { resource: pod }));
    await act(() => result.current.executeRestart());
    expect(k8sDelete).toHaveBeenCalledWith('/api/v1/namespaces/shop/pods/web-1', 'local', { uid: 'u1', resourceVersion: '42' });
    expect(result.current.pendingRestart).toBeNull();
  });

  it('scaling from the table only applies to the version it was computed from', async () => {
    const dep = { ...pod, kind: 'Deployment', apiVersion: 'apps/v1', spec: { replicas: 2 } } as K8sResource;
    const { result } = setup();
    await act(() => result.current.handleAction('scale', { resource: dep, delta: 1 }));
    expect(k8sPatch.mock.calls[0][1]).toEqual({ metadata: { resourceVersion: '42' }, spec: { replicas: 3 } });
  });
});
