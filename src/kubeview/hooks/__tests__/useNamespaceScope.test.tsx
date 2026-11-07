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
  useUIStore.setState({ selectedNamespace: '*', namespaceScopeUsers: 0, namespaceScopeOptOuts: 0 });
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

describe('cluster switch', () => {
  it('a ?ns= left from the old cluster is dropped, not applied to the new one', async () => {
    setup(['/scoped?ns=payments']);
    expect(stored()).toBe('payments');
    // fleetStore.setActiveCluster resets the store; the view remounts on the same entry.
    cleanup();
    act(() => { useFleetStore.setState({ activeClusterId: 'east' }); useUIStore.setState({ selectedNamespace: '*' }); });
    setup(['/scoped?ns=payments']);
    expect(scope()).toBe('*');
    expect(url()).toBe('/scoped');
    expect(stored()).toBe('*');
  });

  it('a new link after the switch scopes the new cluster', async () => {
    const router = setup(['/scoped?ns=payments']);
    act(() => { useFleetStore.setState({ activeClusterId: 'east' }); useUIStore.setState({ selectedNamespace: '*' }); });
    await act(() => router.navigate('/scoped/pods?ns=east-team'));
    expect(scope()).toBe('east-team');
    expect(stored()).toBe('east-team');
  });

  it('switching clusters resets the stored scope', () => {
    registerCluster({ id: 'east', name: 'East', connectionType: 'acm-proxy', target: 'east' });
    try {
      useUIStore.setState({ selectedNamespace: 'payments' });
      act(() => useFleetStore.getState().setActiveCluster('east'));
      expect(useFleetStore.getState().activeClusterId).toBe('east');
      expect(stored()).toBe('*');
    } finally {
      resetConnections();
      useFleetStore.setState({ activeClusterId: 'local' });
    }
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
