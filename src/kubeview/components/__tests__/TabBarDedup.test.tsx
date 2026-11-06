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
import { useUIStore } from '../../store/uiStore';

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
afterEach(cleanup);

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
});
