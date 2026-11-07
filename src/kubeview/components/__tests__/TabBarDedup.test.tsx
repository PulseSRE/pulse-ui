// @vitest-environment jsdom
/**
 * The shell's tab bar keeps one tab per page path: moving between
 * `/workloads` and `/workloads?tab=builds` (a page tab, a palette entry, a
 * link) updates that tab instead of opening another, and clicking the tab
 * later returns to the page's last URL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom';
import { TabBar } from '../TabBar';
import { useUIStore, MAX_UNPINNED_TABS } from '../../store/uiStore';
import { resetNamespaceScopeSync } from '../../hooks/useNamespaceScope';

function Layout() {
  const loc = useLocation();
  return (
    <>
      <TabBar />
      <div data-testid="url">{loc.pathname + loc.search}</div>
      <Outlet />
    </>
  );
}

function setup(initial: string) {
  const router = createMemoryRouter(
    [{ path: '/', element: <Layout />, children: [{ path: '*', element: <div /> }] }],
    { initialEntries: [initial] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const shellTabs = () => screen.getAllByRole('tab').map((t) => t.textContent);

beforeEach(() => {
  useUIStore.setState({
    tabs: [{ id: 'pulse', title: 'Pulse', icon: 'HeartPulse', path: '/pulse', pinned: true, closable: false }],
    activeTabId: 'pulse',
    _pendingNavigate: null,
  });
});
afterEach(() => { cleanup(); resetNamespaceScopeSync(); });

describe('TabBar: one tab per page', () => {
  it('a query change on the same page updates its tab instead of adding one', async () => {
    const router = setup('/workloads');
    expect(shellTabs()).toEqual(['Pulse', 'Workloads']);
    await act(() => router.navigate('/workloads?tab=builds'));
    expect(shellTabs()).toEqual(['Pulse', 'Workloads']);
    const tab = useUIStore.getState().tabs.find((t) => t.title === 'Workloads')!;
    expect(tab.path).toBe('/workloads?tab=builds');
    expect(useUIStore.getState().activeTabId).toBe(tab.id);
  });

  it('clicking the tab later returns to the page with its last query', async () => {
    const router = setup('/workloads?tab=builds');
    await act(() => router.navigate('/compute'));
    expect(shellTabs()).toEqual(['Pulse', 'Workloads', 'Compute']);
    fireEvent.click(screen.getByRole('tab', { name: /Workloads/ }));
    expect(screen.getByTestId('url').textContent).toBe('/workloads?tab=builds');
    expect(shellTabs()).toEqual(['Pulse', 'Workloads', 'Compute']);
  });

  it('closing the active tab lands on a neighbour with a query, and finishes the navigation', async () => {
    const router = setup('/workloads?tab=builds');
    await act(() => router.navigate('/compute'));
    const close = screen.getAllByRole('button', { name: 'Close tab' }).pop()!;
    fireEvent.click(close);
    await act(async () => {});
    expect(screen.getByTestId('url').textContent).toBe('/workloads?tab=builds');
    expect(shellTabs()).toEqual(['Pulse', 'Workloads']);
    // The pending navigation is cleared, so later route changes make tabs again.
    expect(useUIStore.getState()._pendingNavigate).toBeNull();
    await act(() => router.navigate('/compute'));
    expect(shellTabs()).toEqual(['Pulse', 'Workloads', 'Compute']);
  });
  it('a query change retitles the tab from the URL; an explicit title from go() wins', async () => {
    const router = setup('/workloads');
    // go('/workloads?tab=builds', 'Builds'): addTab, then navigate.
    act(() => { useUIStore.getState().addTab({ title: 'Builds', path: '/workloads?tab=builds', pinned: false, closable: true }); });
    await act(() => router.navigate('/workloads?tab=builds'));
    expect(shellTabs()).toEqual(['Pulse', 'Builds']);
    // Switching back to the page's default view in-page: the title follows the URL.
    await act(() => router.navigate('/workloads', { replace: true }));
    expect(shellTabs()).toEqual(['Pulse', 'Workloads']);
  });

  it('re-scoping a list in place (the picker) keeps its tab, which follows ?ns=', async () => {
    const router = setup('/r/v1~pods?ns=team-a');
    expect(shellTabs()).toEqual(['Pulse', 'Pods (team-a)']);
    // The picker rewrites the page's ?ns= in place.
    await act(() => router.navigate('/r/v1~pods?ns=team-b', { replace: true }));
    expect(shellTabs()).toEqual(['Pulse', 'Pods (team-b)']);
    // Picking "All namespaces" drops the param; the tab follows that too.
    await act(() => router.navigate('/r/v1~pods', { replace: true }));
    expect(shellTabs()).toEqual(['Pulse', 'Pods']);
    await act(() => router.navigate('/r/v1~pods?ns=team-b', { replace: true }));
    // A link to another namespace's list is still its own tab.
    await act(() => router.navigate('/r/v1~pods?ns=team-c'));
    expect(shellTabs()).toEqual(['Pulse', 'Pods (team-b)', 'Pods (team-c)']);
    // Clicking the first tab returns to the scope it was left with.
    fireEvent.click(screen.getByRole('tab', { name: /team-b/ }));
    expect(screen.getByTestId('url').textContent).toBe('/r/v1~pods?ns=team-b');
  });

  it('route-driven navigation past the cap closes the least recently used tab', async () => {
    const router = setup('/r/v1~pods/ns/p0');
    for (let i = 1; i < MAX_UNPINNED_TABS; i++) await act(() => router.navigate(`/r/v1~pods/ns/p${i}`));
    // Revisit p0 so p1 is now the least recently used.
    await act(() => router.navigate('/r/v1~pods/ns/p0'));
    await act(() => router.navigate('/r/v1~pods/ns/new'));
    const titles = shellTabs();
    expect(titles.filter((t) => t !== 'Pulse')).toHaveLength(MAX_UNPINNED_TABS);
    expect(titles).toContain('P0 (Pod)');
    expect(titles).not.toContain('P1 (Pod)');
    expect(titles).toContain('New (Pod)');
  });
});
