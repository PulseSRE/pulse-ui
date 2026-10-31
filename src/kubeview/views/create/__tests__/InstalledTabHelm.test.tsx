// @vitest-environment jsdom
/**
 * Installed → Helm listed only `default` in all-namespaces mode and kept
 * whichever revision secret came first. It now lists cluster-wide and shows
 * each release (namespace + name) at its highest revision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

let selectedNamespace = '*';
vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((sel: any) => sel({ selectedNamespace, addTab: vi.fn(), addToast: vi.fn() }), {
    getState: () => ({ impersonateUser: '', impersonateGroups: [] }),
  }),
}));
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));

import { InstalledTab } from '../InstalledTab';

const secret = (name: string, ns: string, version: string, status: string) => ({
  metadata: { name: `sh.helm.release.v1.${name}.v${version}`, namespace: ns, labels: { owner: 'helm', name, version, status } },
});

const urls: string[] = [];
let respond: () => Response;

beforeEach(() => {
  urls.length = 0;
  selectedNamespace = '*';
  respond = () => new Response(JSON.stringify({ items: [
    secret('shop', 'team-a', '1', 'superseded'),
    secret('shop', 'team-a', '3', 'deployed'),
    secret('shop', 'team-a', '2', 'superseded'),
    secret('shop', 'team-b', '1', 'failed'),
  ] }), { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return respond(); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderTab() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><InstalledTab /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InstalledTab Helm releases', () => {
  it('lists every namespace and keeps the highest revision of each release', async () => {
    renderTab();
    expect(await screen.findByText('v3')).toBeTruthy();
    expect(urls).toContain('/api/kubernetes/api/v1/secrets?labelSelector=owner%3Dhelm');
    const rows = screen.getAllByText('shop').map((el) => el.closest('div.flex.items-center.justify-between') as HTMLElement);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('team-a')).toBeTruthy();
    expect(within(rows[0]).getByText('deployed')).toBeTruthy();
    expect(within(rows[1]).getByText('team-b')).toBeTruthy();
    expect(within(rows[1]).getByText('failed')).toBeTruthy();
    expect(screen.queryByText('v1')).toBeTruthy();
    expect(screen.queryByText('v2')).toBeNull();
  });

  it('lists only the selected namespace when one is selected', async () => {
    selectedNamespace = 'team-a';
    renderTab();
    await screen.findByText('v3');
    expect(urls).toContain('/api/kubernetes/api/v1/namespaces/team-a/secrets?labelSelector=owner%3Dhelm');
  });

  it('says the list failed instead of "No Helm releases installed"', async () => {
    respond = () => new Response('{}', { status: 403 });
    renderTab();
    expect(await screen.findByText('Helm releases could not be listed')).toBeTruthy();
    expect(screen.queryByText('No Helm releases installed')).toBeNull();
  });
});
