// @vitest-environment jsdom
/**
 * Shell links: the logo and "Getting Started" pointed at /welcome, which has no
 * page; "Session expired — click to log in again" reloaded '/', which re-serves
 * the same stale oauth-proxy session (see Shell.tsx).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';

const performLogout = vi.fn();
vi.mock('../../engine/auth', () => ({ performLogout: () => performLogout() }));
vi.mock('../../hooks/usePulseStatus', () => ({ usePulseUpgrade: () => ({ phase: '', upgrading: false }) }));
vi.mock('../../engine/safeQuery', async (orig) => ({ ...(await orig<object>()), agentFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) }));

import { CommandBar } from '../CommandBar';
import { StatusBar } from '../StatusBar';
import { useUIStore } from '../../store/uiStore';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}

function renderShell(ui: React.ReactElement, at = '/r/v1~pods') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as any;
});
afterEach(() => { cleanup(); performLogout.mockReset(); });

describe('CommandBar links', () => {
  it('the logo goes to /pulse', () => {
    renderShell(<CommandBar />);
    fireEvent.click(screen.getByTitle('Home'));
    expect(screen.getByTestId('where').textContent).toBe('/pulse');
  });

  it('"Getting Started" opens the readiness page', () => {
    renderShell(<CommandBar />);
    fireEvent.click(screen.getByLabelText('User menu'));
    fireEvent.click(screen.getByText('Getting Started'));
    expect(screen.getByTestId('where').textContent).toBe('/readiness');
  });
});

describe('StatusBar session expiry', () => {
  it('"click to log in again" signs out through oauth-proxy', () => {
    useUIStore.setState({ degradedReasons: new Set(['session_expired']) as never });
    renderShell(<StatusBar />);
    fireEvent.click(screen.getByText(/Session expired — click to log in again/));
    expect(performLogout).toHaveBeenCalledTimes(1);
    useUIStore.setState({ degradedReasons: new Set() as never });
  });
});
