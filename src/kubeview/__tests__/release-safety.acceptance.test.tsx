// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmationCard } from '../components/agent/ConfirmationCard';
import { useTrustStore } from '../store/trustStore';
import { useUIStore } from '../store/uiStore';
import { useFleetStore } from '../store/fleetStore';
import { resetConnections } from '../engine/clusterConnection';
import { useTableActions } from '../views/table/TableActions';

beforeEach(() => {
  resetConnections();
  useFleetStore.setState({ activeClusterId: 'local' });
  useTrustStore.setState({ trustLevel: 0, autoFixCategories: [], history: [] });
  useUIStore.setState({ toasts: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const confirm = { tool: 'scale_deployment', input: { name: 'web', namespace: 'prod', replicas: 4 }, nonce: 'request-123' };

describe('release approval acceptance with the real trust policy', () => {
  it('Observe never approves through a button or keyboard shortcut', () => {
    const sendConfirmation = vi.fn();
    render(<ConfirmationCard confirm={confirm} onConfirm={sendConfirmation} />);
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'y' });
    expect(sendConfirmation).not.toHaveBeenCalled();
    expect(useTrustStore.getState().history).toEqual([]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sendConfirmation).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('Bounded requires explicit approval when the request has no verified category', () => {
    useTrustStore.setState({ trustLevel: 3, autoFixCategories: ['workloads'] });
    const sendConfirmation = vi.fn();
    render(<ConfirmationCard confirm={confirm} onConfirm={sendConfirmation} />);
    expect(sendConfirmation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve operation (Y)' }));
    expect(sendConfirmation).toHaveBeenCalledExactlyOnceWith(true);
    expect(useTrustStore.getState().history).toHaveLength(1);
    expect(useTrustStore.getState().history[0].approved).toBe(true);
  });
});

it('a denied bulk delete preserves the running workload, cached row and failed selection', async () => {
  const resource = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web', namespace: 'prod', uid: 'web-uid', resourceVersion: '42' }, spec: { replicas: 3 } };
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', text: async () => JSON.stringify({ message: 'delete forbidden' }) });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = ['k8s', 'list', '/apis/apps/v1/deployments', 'prod', 'local'];
  const setSelectedRows = vi.fn();
  client.setQueryData(key, [resource]);
  const { result } = renderHook(() => useTableActions({ apiPath: '/apis/apps/v1/deployments', gvrKey: 'apps/v1/deployments', sortedResources: [resource], stampedResources: [resource], visibleColumns: [], resourceKind: 'Deployment', selectedRows: new Set(['web-uid']), setSelectedRows }), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await act(async () => { await result.current.handleBulkDelete(); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/kubernetes/apis/apps/v1/namespaces/prod/deployments/web');
  expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).preconditions).toEqual({ uid: 'web-uid' });
  expect(client.getQueryData(key)).toEqual([resource]);
  expect(resource.spec.replicas).toBe(3);
  expect(setSelectedRows).toHaveBeenCalledExactlyOnceWith(new Set(['web-uid']));
  expect(result.current.deleteProgress[0].status).toBe('error');
  expect(result.current.deleteProgress[0].error).toContain('Forbidden');
  client.clear();
});
