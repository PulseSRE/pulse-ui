/**
 * Shared harness for admin-action behaviour tests: a stubbed fetch that
 * records every request (method, URL, parsed body), answers permission
 * checks from a table, and renders a view with a fresh QueryClient. Two
 * clusters are registered so tests can switch the active one between
 * opening a dialog and confirming it.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { getAllConnections, getClusterBase, registerCluster, resetConnections } from '../engine/clusterConnection';
import { useFleetStore } from '../store/fleetStore';
import { useUIStore } from '../store/uiStore';

export const SSAR = '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews';
export const REMOTE = 'prod-east';

export interface Recorded { url: string; path: string; method: string; body: any; headers: Record<string, string> }
export type Handler = (req: Recorded) => Response | Promise<Response> | undefined;

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function k8sStatus(code: number, message: string) {
  return json({ kind: 'Status', apiVersion: 'v1', status: 'Failure', message, code }, code);
}

export function createHarness() {
  const state = {
    handler: (() => json({})) as Handler,
    /** Permission answers by "verb resource[/subresource]"; anything unlisted is allowed. */
    denied: new Set<string>(),
    requests: [] as Recorded[],
    localBase: '',
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    let body: any = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* raw */ } }
    if (url.endsWith(SSAR)) {
      const ra = body?.spec?.resourceAttributes ?? {};
      const key = `${ra.verb} ${ra.resource}${ra.subresource ? `/${ra.subresource}` : ''}`;
      return json({ status: { allowed: !state.denied.has(key) } });
    }
    const path = state.localBase && url.startsWith(state.localBase) ? url.slice(state.localBase.length) : url;
    const req: Recorded = { url, path, method: (init.method ?? 'GET').toUpperCase(), body, headers: (init.headers ?? {}) as Record<string, string> };
    state.requests.push(req);
    return (await state.handler(req)) ?? json({ items: [] });
  });

  function setup() {
    resetConnections();
    registerCluster({ id: REMOTE, name: 'Prod East', connectionType: 'acm-proxy', target: 'prod-east' });
    state.localBase = getClusterBase('local');
    useFleetStore.setState({ activeClusterId: 'local', clusters: getAllConnections() });
    useUIStore.setState({ impersonateUser: '', impersonateGroups: [], selectedNamespace: '*' } as never);
    state.requests.length = 0;
    state.denied.clear();
    state.handler = () => json({ items: [] });
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  }

  function teardown() {
    vi.unstubAllGlobals();
    resetConnections();
  }

  /** Requests that change something (not GET), in order. */
  const writes = () => state.requests.filter((r) => r.method !== 'GET');

  function setActive(id: string) {
    act(() => { useFleetStore.getState().setActiveCluster(id); });
  }

  function renderUi(ui: React.ReactElement, path = '/') {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );
  }

  return { state, fetchMock, setup, teardown, writes, setActive, renderUi };
}

/** Permission checks resolve asynchronously; click a button once it is enabled. */
export async function clickWhenEnabled(name: string | RegExp) {
  const btn = await screen.findByRole('button', { name });
  await waitFor(() => { if ((btn as HTMLButtonElement).disabled) throw new Error(`${String(name)} is still disabled`); });
  fireEvent.click(btn);
}
