// @vitest-environment jsdom
/**
 * Pulse AI is a modal sheet on a phone, so the store never starts it open
 * there: not from its initial state, and not from a saved "expanded".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PHONE_QUERY } from '../../hooks/useIsPhone';

const KEY = 'openshiftpulse-ui-storage';

function setViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as never;
}

async function freshStore() {
  vi.resetModules();
  return (await import('../uiStore')).useUIStore;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe('uiStore on a phone', () => {
  it('starts with the AI sidebar collapsed', async () => {
    setViewport(true);
    const store = await freshStore();
    expect(store.getState().aiSidebarExpanded).toBe(false);
  });

  it('a saved "expanded" is restored as collapsed', async () => {
    setViewport(true);
    localStorage.setItem(KEY, JSON.stringify({ state: { aiSidebarExpanded: true }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().aiSidebarExpanded).toBe(false);
    // And the merge itself, on a state that was expanded.
    const merge = store.persist.getOptions().merge!;
    const merged = merge({ aiSidebarExpanded: true }, { ...store.getState(), aiSidebarExpanded: true }) as { aiSidebarExpanded: boolean };
    expect(merged.aiSidebarExpanded).toBe(false);
  });
});

describe('uiStore on wider screens', () => {
  it('starts expanded and restores a saved "expanded"', async () => {
    setViewport(false);
    expect((await freshStore()).getState().aiSidebarExpanded).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ state: { aiSidebarExpanded: true }, version: 0 }));
    expect((await freshStore()).getState().aiSidebarExpanded).toBe(true);
  });
});
