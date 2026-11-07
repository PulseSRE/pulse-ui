// @vitest-environment jsdom
/**
 * The namespace scope lives in `?ns=`: reload, links and Back/Forward restore
 * it, the old `?namespace=` still works, a scope never crosses a cluster
 * switch, and a page that shows every namespace says so.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import {
  useNamespaceScope, useSetNamespaceScope, useNamespaceScopeApplies, resetNamespaceScopeSync,
  readNamespaceParam, withNamespaceScope,
} from '../useNamespaceScope';
import { useTabParam } from '../../components/primitives/Tabs';
import { useUIStore } from '../../store/uiStore';
import { useFleetStore } from '../../store/fleetStore';
import { registerCluster, resetConnections } from '../../engine/clusterConnection';
import { useInitialNamespace } from '../../views/create/NamespacePicker';
import React from 'react';

function Where() {
  const l = useLocation();
  return <div data-testid="url">{l.pathname + l.search}</div>;
}

function ScopedPage() {
  const { namespace, setNamespace } = useNamespaceScope();
  const [tab, setTab] = useTabParam(['overview', 'pods'] as const, 'overview');
  return (
    <>
      <Where />
      <div data-testid="scope">{namespace}</div>
      <div data-testid="tab">{tab}</div>
      <button onClick={() => setNamespace('payments')}>payments</button>
      {/* One click that switches the tab and the scope: neither write may be lost. */}
      <button onClick={() => { setTab('pods'); setNamespace('billing'); }}>both</button>
    </>
  );
}

function UnscopedPage() {
  const { namespace } = useNamespaceScope({ applies: false });
  return <><Where /><div data-testid="scope">{namespace}</div></>;
}

/** A list before discovery says whether its kind is namespaced. */
function PendingPage() {
  const { namespace } = useNamespaceScope({ ready: false });
  return <><Where /><div data-testid="scope">{namespace}</div></>;
}

/** Stands in for the command bar's picker. */
function Picker() {
  const set = useSetNamespaceScope();
  const applies = useNamespaceScopeApplies();
  return <button disabled={!applies} onClick={() => set('team-x')}>{applies ? 'pick' : 'All namespaces on this page'}</button>;
}

function setup(entries: string[], index = entries.length - 1) {
  const router = createMemoryRouter(
    [
      { path: '/scoped/*', element: <><Picker /><ScopedPage /></> },
      { path: '/unscoped', element: <><Picker /><UnscopedPage /></> },
      { path: '/pending', element: <><Picker /><PendingPage /></> },
    ],
    { initialEntries: entries, initialIndex: index },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const url = () => screen.getByTestId('url').textContent;
const scope = () => screen.getByTestId('scope').textContent;
const stored = () => useUIStore.getState().selectedNamespace;

beforeEach(() => {
  resetNamespaceScopeSync();
  useUIStore.setState({ selectedNamespace: '*', scopeClusterId: 'local', namespaceScopeUsers: 0, namespaceScopeOptOuts: 0 });
  useFleetStore.setState({ activeClusterId: 'local' });
});
afterEach(() => {
  cleanup();
  useUIStore.setState({ selectedNamespace: '*' });
});

describe('reading the scope', () => {
  it('?ns= sets the scope and the picker follows it', () => {
    setup(['/scoped?ns=payments']);
    expect(scope()).toBe('payments');
    expect(stored()).toBe('payments');
    expect(url()).toBe('/scoped?ns=payments');
  });

  it('the old ?namespace= is read and rewritten to ?ns=', () => {
    setup(['/scoped?namespace=shop&focus=x']);
    expect(scope()).toBe('shop');
    expect(stored()).toBe('shop');
    expect(url()).toBe('/scoped?focus=x&ns=shop');
  });

  it('?ns=* is all namespaces and leaves no param', () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    setup(['/scoped?ns=*']);
    expect(scope()).toBe('*');
    expect(stored()).toBe('*');
    expect(url()).toBe('/scoped');
  });

  it('a malformed ?ns= is dropped and the current scope applies', () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    setup(['/scoped?ns=Bad_NS']);
    expect(scope()).toBe('payments');
    expect(url()).toBe('/scoped?ns=payments');
  });

  it('a page opened without ?ns= inherits the scope and writes it into its URL', () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    setup(['/scoped']);
    expect(scope()).toBe('payments');
    expect(url()).toBe('/scoped?ns=payments');
  });

  it('helpers: readNamespaceParam prefers ns, withNamespaceScope builds links', () => {
    expect(readNamespaceParam(new URLSearchParams('ns=a&namespace=b'))).toBe('a');
    expect(readNamespaceParam(new URLSearchParams('namespace=b'))).toBe('b');
    expect(readNamespaceParam(new URLSearchParams('ns=NOPE'))).toBeNull();
    // An invalid ns does not hide a valid old-style namespace.
    expect(readNamespaceParam(new URLSearchParams('ns=NOPE&namespace=shop'))).toBe('shop');
    expect(withNamespaceScope('/create/v1~pods?namespace=old&x=1', 'shop')).toBe('/create/v1~pods?x=1&ns=shop');
    expect(withNamespaceScope('/workloads', '*')).toBe('/workloads');
  });
});

describe('writing the scope', () => {
  it('setNamespace writes ?ns= with replace', async () => {
    const router = setup(['/scoped']);
    fireEvent.click(screen.getByRole('button', { name: 'payments' }));
    expect(url()).toBe('/scoped?ns=payments');
    expect(stored()).toBe('payments');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('a tab change and a scope change in one click both land', () => {
    setup(['/scoped']);
    fireEvent.click(screen.getByRole('button', { name: 'both' }));
    expect(screen.getByTestId('tab').textContent).toBe('pods');
    expect(scope()).toBe('billing');
    expect(url()).toBe('/scoped?tab=pods&ns=billing');
  });

  it('the picker writes the scoped page\'s URL', () => {
    setup(['/scoped?tab=pods']);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(url()).toBe('/scoped?tab=pods&ns=team-x');
    expect(scope()).toBe('team-x');
  });
});

describe('Back and Forward', () => {
  it('restore the scope each entry had', async () => {
    // An unscoped page, then a scoped one where the user picks a namespace.
    const router = setup(['/scoped/workloads']);
    await act(() => router.navigate('/scoped/pods'));
    fireEvent.click(screen.getByRole('button', { name: 'payments' }));
    expect(url()).toBe('/scoped/pods?ns=payments');

    await act(() => router.navigate(-1));
    expect(url()).toBe('/scoped/workloads');
    expect(scope()).toBe('*');
    expect(stored()).toBe('*');

    await act(() => router.navigate(1));
    expect(url()).toBe('/scoped/pods?ns=payments');
    expect(scope()).toBe('payments');
    expect(stored()).toBe('payments');
  });

  it('a pushed navigation keeps the scope for the next page', async () => {
    const router = setup(['/scoped/pods?ns=payments']);
    await act(() => router.navigate('/scoped/deployments'));
    expect(url()).toBe('/scoped/deployments?ns=payments');
  });
});

/* ── Cluster identity ── */

/** Records every namespace each probe rendered, not just the last one. */
const seen: Record<string, string[]> = {};
function Probe({ name }: { name: string }) {
  const { namespace } = useNamespaceScope();
  (seen[name] ??= []).push(namespace);
  return null;
}
function InitialProbe() {
  // What Create's YAML prefill and the Helm/Quick deploy forms seed from.
  (seen.initial ??= []).push(useInitialNamespace());
  return null;
}
/** The app remounts its view per cluster; the router (and so the entry) stays. */
function ClusterKeyed({ children }: { children: React.ReactNode }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  return <React.Fragment key={clusterId}>{children}</React.Fragment>;
}
function setupKeyed(entries: string[], page: React.ReactNode) {
  const router = createMemoryRouter(
    [{ path: '*', element: <><Where /><ClusterKeyed>{page}</ClusterKeyed></> }],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('cluster switch', () => {
  beforeEach(() => {
    for (const k of Object.keys(seen)) delete seen[k];
    registerCluster({ id: 'east', name: 'East', connectionType: 'acm-proxy', target: 'east' });
  });
  afterEach(() => {
    resetConnections();
    useFleetStore.setState({ activeClusterId: 'local' });
  });
  const switchTo = (id: string) => act(() => useFleetStore.getState().setActiveCluster(id));

  it("no render after the switch shows the old cluster's namespace (B1)", () => {
    setupKeyed(['/scoped/pods?ns=payments'], <><Probe name="page" /><InitialProbe /></>);
    expect(seen.page.at(-1)).toBe('payments');
    expect(seen.initial.at(-1)).toBe('payments');
    const before = { page: seen.page.length, initial: seen.initial.length };
    switchTo('east');
    expect(seen.page.slice(before.page).length).toBeGreaterThan(0);
    expect(seen.page.slice(before.page)).not.toContain('payments');
    expect(seen.initial.slice(before.initial)).not.toContain('payments');
    expect(url()).toBe('/scoped/pods');
    expect(stored()).toBe('*');
  });

  it('two scoped components on one page: neither writes the old namespace back (B2)', () => {
    // e.g. /inbox?tab=activity: InboxPage and ActivityTab both use the scope.
    setupKeyed(['/inbox?tab=activity&ns=payments'], <><Probe name="a" /><Probe name="b" /></>);
    const from = { a: seen.a.length, b: seen.b.length };
    switchTo('east');
    expect(seen.a.slice(from.a)).not.toContain('payments');
    expect(seen.b.slice(from.b)).not.toContain('payments');
    expect(url()).toBe('/inbox?tab=activity');
    expect(stored()).toBe('*');
    expect(useUIStore.getState().scopeClusterId).toBe('east');
  });

  it("Back after a switch does not re-apply the old cluster's namespace (B3)", async () => {
    const router = setupKeyed(['/scoped/pods?ns=payments'], <Probe name="page" />);
    await act(() => router.navigate('/scoped/deployments'));
    expect(url()).toBe('/scoped/deployments?ns=payments');
    switchTo('east');
    expect(url()).toBe('/scoped/deployments');
    const from = seen.page.length;
    await act(() => router.navigate(-1));
    expect(seen.page.slice(from)).not.toContain('payments');
    expect(url()).toBe('/scoped/pods');
    expect(stored()).toBe('*');
  });

  it("a reload onto the local cluster ignores a remote cluster's ?ns= (B3)", () => {
    // The entry was settled on `east`; a reload starts on local with the same entry.
    useFleetStore.setState({ activeClusterId: 'east' });
    useUIStore.setState({ scopeClusterId: 'east' });
    setupKeyed(['/scoped/pods?ns=payments'], <Probe name="before" />);
    expect(seen.before.at(-1)).toBe('payments');
    cleanup();
    useFleetStore.setState({ activeClusterId: 'local' });
    setupKeyed(['/scoped/pods?ns=payments'], <Probe name="after" />);
    expect(seen.after).not.toContain('payments');
    expect(url()).toBe('/scoped/pods');
  });

  it('a new link after the switch scopes the new cluster', async () => {
    const router = setupKeyed(['/scoped?ns=payments'], <Probe name="page" />);
    switchTo('east');
    await act(() => router.navigate('/scoped/pods?ns=east-team'));
    expect(seen.page.at(-1)).toBe('east-team');
    expect(stored()).toBe('east-team');
  });

  it("the store ignores a namespace kept for another cluster", () => {
    useUIStore.setState({ selectedNamespace: 'payments', scopeClusterId: 'east' });
    setupKeyed(['/scoped'], <Probe name="page" />);
    expect(seen.page).not.toContain('payments');
    expect(url()).toBe('/scoped');
  });

  it("switching clusters strips ?ns= from every tab and folds tabs that became one page (B3)", () => {
    useUIStore.setState({
      tabs: [
        { id: 'pulse', title: 'Pulse', path: '/pulse', pinned: true, closable: false },
        { id: 'a', title: 'Pods (team-a)', path: '/r/v1~pods?ns=team-a&q=web', pinned: false, closable: true },
        { id: 'b', title: 'Pods (team-b)', path: '/r/v1~pods?ns=team-b', pinned: false, closable: true },
        { id: 'c', title: 'Topology', path: '/topology?namespace=shop&focus=x', pinned: false, closable: true },
      ],
      activeTabId: 'b',
    });
    switchTo('east');
    const tabs = useUIStore.getState().tabs.map((t) => [t.id, t.title, t.path]);
    expect(tabs).toEqual([
      ['pulse', 'Pulse', '/pulse'],
      ['b', 'Pods', '/r/v1~pods'],
      ['c', 'Topology', '/topology?focus=x'],
    ]);
  });
});

describe('reload', () => {
  it("a saved scope from another cluster is dropped, from the store and the tabs", async () => {
    window.localStorage.setItem('openshiftpulse-ui-storage', JSON.stringify({
      state: {
        selectedNamespace: 'payments', scopeClusterId: 'east', activeTabId: 'pulse',
        tabs: [
          { id: 'pulse', title: 'Pulse', path: '/pulse', pinned: true, closable: false },
          { id: 'x', title: 'Pods (payments)', path: '/r/v1~pods?ns=payments', pinned: false, closable: true },
        ],
      },
      version: 0,
    }));
    await useUIStore.persist.rehydrate();
    expect(stored()).toBe('*');
    expect(useUIStore.getState().tabs.find((t) => t.path.startsWith('/r/'))).toMatchObject({ path: '/r/v1~pods', title: 'Pods' });
    window.localStorage.removeItem('openshiftpulse-ui-storage');
  });

  it('a saved scope from this cluster is kept', async () => {
    window.localStorage.setItem('openshiftpulse-ui-storage', JSON.stringify({
      state: { selectedNamespace: 'payments', scopeClusterId: 'local', activeTabId: 'pulse', tabs: [{ id: 'pulse', title: 'Pulse', path: '/pulse', pinned: true, closable: false }] },
      version: 0,
    }));
    await useUIStore.persist.rehydrate();
    expect(stored()).toBe('payments');
    window.localStorage.removeItem('openshiftpulse-ui-storage');
  });
});

describe('applies: false', () => {
  it('shows all namespaces, keeps the choice for other pages and leaves the URL alone', async () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    const router = setup(['/unscoped']);
    expect(scope()).toBe('*');
    expect(url()).toBe('/unscoped');
    expect(stored()).toBe('payments');
    expect(screen.getByRole('button', { name: 'All namespaces on this page' })).toHaveProperty('disabled', true);

    await act(() => router.navigate('/scoped'));
    expect(scope()).toBe('payments');
    expect(url()).toBe('/scoped?ns=payments');
    expect(useUIStore.getState().namespaceScopeOptOuts).toBe(0);
    expect(screen.getByRole('button', { name: 'pick' })).toHaveProperty('disabled', false);
  });
});

describe('applies: false and ready: false', () => {
  it('a page that shows every namespace drops a ?ns= it was linked with', () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    setup(['/unscoped?ns=payments&x=1']);
    expect(scope()).toBe('*');
    expect(url()).toBe('/unscoped?x=1');
    expect(stored()).toBe('payments');
  });

  it('before it is ready a page reads the scope but writes nothing and does not grey the picker', () => {
    useUIStore.setState({ selectedNamespace: 'payments' });
    setup(['/pending']);
    expect(scope()).toBe('payments');
    expect(url()).toBe('/pending');
    expect(useUIStore.getState().namespaceScopeOptOuts).toBe(0);
    expect(useUIStore.getState().namespaceScopeUsers).toBe(0);
  });
});
