// @vitest-environment jsdom
/**
 * useTabParam keeps a page's tab in `?tab=` through the router, so the URL is
 * the only state: deep links, Back/Forward and links to another tab of the
 * same page all switch the tab, and an unknown value is corrected.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Link, useLocation } from 'react-router-dom';
import { useTabParam } from '../Tabs';

const TABS = ['overview', 'builds', 'history'] as const;

function Page() {
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const [sev, setSev] = useTabParam(['all', 'critical'] as const, 'all', 'severity');
  const loc = useLocation();
  return (
    <div>
      <div data-testid="tab">{tab}</div>
      <div data-testid="url">{loc.pathname + loc.search}</div>
      <div data-testid="sev">{sev}</div>
      <button onClick={() => setTab('history')}>History</button>
      <button onClick={() => setSev('critical')}>Critical</button>
      <button onClick={() => { setTab('builds'); setSev('critical'); }}>Critical builds</button>
      <Link to="/page?tab=builds">See builds</Link>
      <Link to="/page">Overview link</Link>
    </div>
  );
}

function setup(initial: string[], index?: number) {
  const router = createMemoryRouter(
    [{ path: '/page', element: <Page /> }, { path: '/other', element: <div>other page</div> }],
    { initialEntries: initial, initialIndex: index },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const tab = () => screen.getByTestId('tab').textContent;
const url = () => screen.getByTestId('url').textContent;

describe('useTabParam', () => {
  afterEach(cleanup);

  it('opens the tab a deep link names, keeping other params', () => {
    setup(['/page?ns=shop&tab=builds']);
    expect(tab()).toBe('builds');
    expect(url()).toBe('/page?ns=shop&tab=builds');
  });

  it('opens the default tab with no ?tab=', () => {
    setup(['/page']);
    expect(tab()).toBe('overview');
  });

  it('switches when a link on the same page changes only ?tab=', () => {
    setup(['/page']);
    fireEvent.click(screen.getByText('See builds'));
    expect(tab()).toBe('builds');
    fireEvent.click(screen.getByText('Overview link'));
    expect(tab()).toBe('overview');
  });

  it('follows Back and Forward between tab URLs', async () => {
    const router = setup(['/page']);
    await act(() => router.navigate('/page?tab=builds'));
    await act(() => router.navigate('/page?tab=history'));
    expect(tab()).toBe('history');
    await act(() => router.navigate(-1));
    expect(tab()).toBe('builds');
    await act(() => router.navigate(-1));
    expect(tab()).toBe('overview');
    await act(() => router.navigate(1));
    expect(tab()).toBe('builds');
  });

  it('a tab click replaces the entry, so Back leaves the page', async () => {
    const router = setup(['/other', '/page'], 1);
    fireEvent.click(screen.getByText('History'));
    expect(url()).toBe('/page?tab=history');
    await act(() => router.navigate(-1));
    expect(screen.getByText('other page')).toBeTruthy();
  });

  it('falls back to the default for an unknown value and removes it from the URL by replace', async () => {
    const router = setup(['/other', '/page?tab=bogus&ns=shop'], 1);
    expect(tab()).toBe('overview');
    expect(url()).toBe('/page?ns=shop');
    // Replaced, not pushed: one Back returns to the previous page.
    await act(() => router.navigate(-1));
    expect(screen.getByText('other page')).toBeTruthy();
  });
  it('a tab click keeps the other params, including another hook\'s', () => {
    setup(['/page?q=web']);
    fireEvent.click(screen.getByText('Critical'));
    fireEvent.click(screen.getByText('History'));
    expect(url()).toBe('/page?q=web&severity=critical&tab=history');
  });

  it('two writes in one handler both land', () => {
    setup(['/page']);
    fireEvent.click(screen.getByText('Critical builds'));
    expect(tab()).toBe('builds');
    expect(screen.getByTestId('sev').textContent).toBe('critical');
    expect(url()).toBe('/page?tab=builds&severity=critical');
  });
});
