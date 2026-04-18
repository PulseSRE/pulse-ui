// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useUIStore } from '../../store/uiStore';

function resetStore() {
  useUIStore.setState({
    commandPaletteOpen: false,
    browserOpen: false,
    actionPanelOpen: false,
    dockPanel: null,
  });
}

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('Cmd+K toggles command palette', () => {
    renderHook(() => useKeyboardShortcuts());

    fireKey('k', { metaKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);

    fireKey('k', { metaKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('Ctrl+K toggles command palette', () => {
    renderHook(() => useKeyboardShortcuts());

    fireKey('k', { ctrlKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it('Cmd+B toggles resource browser', () => {
    renderHook(() => useKeyboardShortcuts());

    fireKey('b', { metaKey: true });
    expect(useUIStore.getState().browserOpen).toBe(true);

    fireKey('b', { metaKey: true });
    expect(useUIStore.getState().browserOpen).toBe(false);
  });

  it('Cmd+. opens command palette', () => {
    renderHook(() => useKeyboardShortcuts());

    fireKey('.', { metaKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it('Cmd+J toggles AI sidebar', () => {
    useUIStore.setState({ aiSidebarExpanded: true });
    renderHook(() => useKeyboardShortcuts());

    fireKey('j', { metaKey: true });
    expect(useUIStore.getState().aiSidebarExpanded).toBe(false);
  });

  it('Escape closes command palette first', () => {
    useUIStore.setState({ commandPaletteOpen: true, browserOpen: true });
    renderHook(() => useKeyboardShortcuts());

    fireKey('Escape');
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    expect(useUIStore.getState().browserOpen).toBe(true);
  });

  it('Escape closes browser when palette is closed', () => {
    useUIStore.setState({ browserOpen: true });
    renderHook(() => useKeyboardShortcuts());

    fireKey('Escape');
    expect(useUIStore.getState().browserOpen).toBe(false);
  });

  it('Escape closes AI sidebar when all overlays are closed', () => {
    useUIStore.setState({ aiSidebarExpanded: true });
    renderHook(() => useKeyboardShortcuts());

    fireKey('Escape');
    expect(useUIStore.getState().aiSidebarExpanded).toBe(false);
  });

  it('does not respond to key without meta/ctrl', () => {
    renderHook(() => useKeyboardShortcuts());

    fireKey('k');
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);

    fireKey('b');
    expect(useUIStore.getState().browserOpen).toBe(false);
  });
});
