// @vitest-environment jsdom
/**
 * Networking: one network-policy banner, not-admitted routes counted once,
 * and the audits use the shared platform-namespace rule.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const ui = { selectedNamespace: '*' };
vi.mock('../../store/uiStore', () => ({ useUIStore: (s: any) => s({ ...ui, addTab: vi.fn() }) }));
const lists: Record<string, any[]> = {};
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: lists[apiPath] ?? [], isLoading: false }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null) }));
vi.mock('../../components/metrics/Sparkline', () => ({ MetricCard: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../../components/metrics/prometheus', () => ({ queryInstant: vi.fn().mockResolvedValue([]) }));

import NetworkingView from '../NetworkingView';
import { isPlatformNamespace } from '../../engine/platformNamespaces';

function renderView() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><NetworkingView /></MemoryRouter></QueryClientProvider>);
}

const route = (name: string, ns: string, opts: { tls?: boolean; admitted?: boolean } = {}) => ({
  metadata: { name, namespace: ns, uid: `${ns}/${name}` },
  spec: { host: `${name}.apps.example.com`, ...(opts.tls ? { tls: { termination: 'edge' } } : {}) },
  status: { ingress: [{ conditions: [{ type: 'Admitted', status: opts.admitted === false ? 'False' : 'True' }] }] },
});

afterEach(() => { cleanup(); for (const k of Object.keys(lists)) delete lists[k]; ui.selectedNamespace = '*'; });

describe('Networking shows each fact once', () => {
  it('one network-policy banner when a namespace is selected', () => {
    ui.selectedNamespace = 'shop';
    renderView();
    expect(screen.getAllByText(/No network policies/)).toHaveLength(1);
    expect(screen.getByText(/No network policies in shop/)).toBeDefined();
  });

  it('counts not-admitted routes once (the banner), not also in a panel title', () => {
    lists['/apis/route.openshift.io/v1/routes'] = [route('a', 'shop', { admitted: false }), route('b', 'shop', { tls: true })];
    renderView();
    expect(screen.getAllByText(/1 route not admitted/)).toHaveLength(1);
    expect(screen.queryByText(/Not Admitted Routes \(/)).toBeNull();
    expect(screen.queryByText(/exposed without TLS/)).toBeNull();
    expect(screen.queryByText(/no TLS$/)).toBeNull();
  });

  it('leaves platform routes out of the TLS audit, like the other audits', () => {
    lists['/apis/route.openshift.io/v1/routes'] = [route('console', 'openshift-console'), route('app', 'shop')];
    renderView();
    const tls = screen.getByText('TLS on Routes').closest('div')!.parentElement!;
    expect(within(tls).queryByText(/console/)).toBeNull();
  });
});

describe('isPlatformNamespace', () => {
  it.each([
    ['openshift-console', true], ['openshift', true], ['kube-system', true], ['kube-public', true],
    ['default', false], ['shop', false], ['openshiftish', false], [undefined, false],
  ])('%s → %s', (ns, want) => expect(isPlatformNamespace(ns as string | undefined)).toBe(want));
});
