// @vitest-environment jsdom
/**
 * On a phone the AI sidebar is a bottom sheet: no 48px rail when collapsed,
 * and when open a modal dialog with focus trapped, Escape, a backdrop and a
 * visible Close button. Wider screens keep the rail and the sidebar.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('../DashboardMode', () => ({ DashboardMode: () => <div><button>First card</button><button>Last card</button></div> }));
vi.mock('../../agent/DockAgentPanel', () => ({ DockAgentPanel: () => <div>chat panel</div> }));
vi.mock('../CollapsedRail', () => ({ CollapsedRail: () => <div data-testid="rail" /> }));

import { AISidebar } from '../AISidebar';
import { useUIStore } from '../../../store/uiStore';
import { useMonitorStore } from '../../../store/monitorStore';

function setViewport(phone: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    // Phones are also under the sidebar's 1200px auto-collapse width.
    matches: phone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as never;
}

beforeEach(() => {
  useUIStore.setState({ aiSidebarExpanded: false, aiSidebarMode: 'dashboard' });
  useMonitorStore.setState({ activeSkill: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AI chat on a phone', () => {
  it('a saved "expanded" never mounts the sheet or moves focus, not even before the collapse effect runs', () => {
    setViewport(true);
    useUIStore.setState({ aiSidebarExpanded: true });
    // Checked while it happens, not after: the mount-time collapse would hide a
    // sheet that had already mounted and focused Close.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    let dialogSeen = false;
    const observer = new MutationObserver(() => { if (document.body.querySelector('[role="dialog"]')) dialogSeen = true; });
    observer.observe(document.body, { childList: true, subtree: true });
    render(<><button>page</button><AISidebar /></>);
    observer.takeRecords();
    if (document.body.querySelector('[role="dialog"]')) dialogSeen = true;
    observer.disconnect();
    expect(dialogSeen).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a skill starting does not open the sheet', () => {
    setViewport(true);
    render(<AISidebar />);
    act(() => { useMonitorStore.setState({ activeSkill: 'sre' }); });
    expect(useUIStore.getState().aiSidebarExpanded).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows no rail while collapsed', () => {
    setViewport(true);
    render(<AISidebar />);
    expect(screen.queryByTestId('rail')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal bottom sheet with a visible Close button that has focus', () => {
    setViewport(true);
    render(<><button>opener</button><AISidebar /></>);
    act(() => { useUIStore.getState().expandAISidebar(); });
    const sheet = screen.getByRole('dialog', { name: 'Pulse AI' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.className).toContain('pb-[env(safe-area-inset-bottom)]');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.textContent).toBe('Close');
    expect(document.activeElement).toBe(close);
  });

  it('traps Tab inside the sheet', () => {
    setViewport(true);
    render(<><button>outside</button><AISidebar /></>);
    act(() => { useUIStore.getState().expandAISidebar(); });
    const last = screen.getByRole('button', { name: 'Last card' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Escape, the Close button and the backdrop each close it', () => {
    setViewport(true);
    render(<AISidebar />);
    act(() => { useUIStore.getState().expandAISidebar(); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUIStore.getState().aiSidebarExpanded).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => { useUIStore.getState().expandAISidebar(); });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUIStore.getState().aiSidebarExpanded).toBe(false);

    act(() => { useUIStore.getState().expandAISidebar(); });
    fireEvent.mouseDown(screen.getByTestId('ai-sheet-backdrop'));
    expect(useUIStore.getState().aiSidebarExpanded).toBe(false);
  });

  it('returns focus to what opened it', () => {
    setViewport(true);
    render(<><button>opener</button><AISidebar /></>);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    act(() => { useUIStore.getState().expandAISidebar(); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('shows chat in the sheet with a way back to the dashboard', () => {
    setViewport(true);
    useUIStore.setState({ aiSidebarMode: 'chat' });
    render(<AISidebar />);
    // The sidebar collapses itself on mount below 1200px, so open it after.
    act(() => { useUIStore.getState().expandAISidebar(); });
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(useUIStore.getState().aiSidebarMode).toBe('dashboard');
  });
});

describe('AI sidebar on wider screens', () => {
  it('opens in chat when a skill starts', () => {
    setViewport(false);
    render(<AISidebar />);
    act(() => { useMonitorStore.setState({ activeSkill: 'sre' }); });
    expect(useUIStore.getState().aiSidebarExpanded).toBe(true);
    expect(useUIStore.getState().aiSidebarMode).toBe('chat');
  });

  it('keeps the rail when collapsed and a sidebar, not a dialog, when open', () => {
    setViewport(false);
    render(<AISidebar />);
    expect(screen.getByTestId('rail')).toBeDefined();
    act(() => { useUIStore.getState().expandAISidebar(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'AI Sidebar' })).toBeDefined();
  });
});
