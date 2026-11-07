// @vitest-environment jsdom
/**
 * Below `sm` the command bar's right-hand controls fold into "More". The
 * controls stay in the DOM; these tests drive the disclosure itself: it opens
 * from the keyboard, arrows move between its controls, Escape closes it and
 * gives focus back, and every shell control is reachable from it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const fetchInboxStats = vi.fn();
vi.mock('../../engine/inboxApi', async (orig) => ({ ...(await orig<object>()), fetchInboxStats: () => fetchInboxStats() }));
vi.mock('../../hooks/usePulseStatus', () => ({ usePulseUpgrade: () => ({ phase: '', upgrading: false, moves: [] }) }));

import { CommandBar } from '../CommandBar';
import { useInboxStore } from '../../store/inboxStore';
import { useUIStore } from '../../store/uiStore';

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}</span>;
}

let qc: QueryClient | undefined;
function renderBar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/workloads']}>
        <Routes><Route path="*" element={<><CommandBar /><Where /><button>outside</button></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const trigger = () => screen.getByRole('button', { name: /^More: cluster, namespace, account/ });
const panel = () => screen.getByRole('group', { name: 'Cluster, namespace and account' });

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never;
  fetchInboxStats.mockResolvedValue({});
  useInboxStore.setState({ stats: {} });
  useUIStore.setState({ selectedNamespace: '*', aiSidebarExpanded: false, aiSidebarMode: 'dashboard' });
});
afterEach(() => { cleanup(); qc?.clear(); fetchInboxStats.mockReset(); });

describe('command bar "More" panel', () => {
  it('is a disclosure: closed by default, aria-controls names the panel', () => {
    renderBar();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBe(panel().id);
    expect(panel().className).toContain('max-sm:hidden');
  });

  it('opens on click and focuses its first control', () => {
    renderBar();
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(panel().className).not.toContain('max-sm:hidden');
    expect(document.activeElement?.textContent).toBe('Ask Pulse');
  });

  it('opens with ArrowDown on the trigger', () => {
    renderBar();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('arrows, Home and End move between the panel controls, wrapping', () => {
    renderBar();
    fireEvent.click(trigger());
    const first = document.activeElement as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(first);
    expect(panel().contains(second)).toBe(true);
    fireEvent.keyDown(second, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'User menu' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'User menu' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('Escape closes it and returns focus to the trigger', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('reaches every shell control: Ask Pulse, cluster, namespace, inbox and user; search stays in the bar', () => {
    renderBar();
    fireEvent.click(trigger());
    const p = within(panel());
    expect(p.getByRole('button', { name: 'Ask Pulse' })).toBeDefined();
    expect(p.getByText('cluster')).toBeDefined();
    expect(p.getByTitle(/Switch namespace/)).toBeDefined();
    expect(p.getByRole('button', { name: /^Inbox:/ })).toBeDefined();
    expect(p.getByRole('button', { name: 'User menu' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Search resources, views' })).toBeDefined();
  });

  it('Escape inside the namespace filter closes the filter, not the panel', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.click(within(panel()).getByTitle(/Switch namespace/));
    const filter = screen.getByPlaceholderText('Type to filter...');
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Type to filter...')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('Ask Pulse opens chat and closes the panel, leaving focus on the trigger', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.click(within(panel()).getByRole('button', { name: 'Ask Pulse' }));
    expect(useUIStore.getState().aiSidebarExpanded).toBe(true);
    expect(useUIStore.getState().aiSidebarMode).toBe('chat');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when a control navigates', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.click(within(panel()).getByRole('button', { name: /^Inbox:/ }));
    expect(screen.getByTestId('where').textContent).toBe('/inbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a click outside', () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('the trigger names the inbox count so a closed panel does not hide it', async () => {
    fetchInboxStats.mockResolvedValue({ needs_attention: 3 });
    renderBar();
    expect(await screen.findByRole('button', { name: 'More: cluster, namespace, account. 3 in the Inbox' })).toBeDefined();
  });
});
