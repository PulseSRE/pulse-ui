// @vitest-environment jsdom
/**
 * "View not found" used to show while the views list was still loading, and
 * after it failed to load. It now waits for the list, and a failed load is an
 * error with Retry. Driven through the real customViewStore with fetch routed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import CustomView from '../CustomView';
import { useCustomViewStore } from '../../store/customViewStore';

function answer(status: number, body: unknown) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const fn = vi.fn(async () => {
    await gate;
    return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error', headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, release };
}

beforeEach(async () => {
  useCustomViewStore.setState({ views: [], loading: false, error: null, loadError: null });
  // Clear the store's 5s debounce from an earlier test.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"views":[]}', { status: 200 })));
  await useCustomViewStore.getState().forceLoadViews();
  useCustomViewStore.setState({ views: [], loading: false, error: null, loadError: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CustomView before and after the views load', () => {
  it('shows loading, not "View not found", while the list loads; then "not found" only if it is absent', async () => {
    // forceLoadViews bypasses the store's debounce, so this load is in flight at render.
    const { release } = answer(200, { views: [], owner: 'me' });
    void useCustomViewStore.getState().forceLoadViews();
    render(<MemoryRouter><CustomView viewId="cv-1" /></MemoryRouter>);
    expect(screen.getByText('Loading view…')).toBeTruthy();
    expect(screen.queryByText('View not found')).toBeNull();
    release();
    expect(await screen.findByText('View not found')).toBeTruthy();
  });

  it.each([403, 500])('shows an error with Retry, not "View not found", when the list fails with %i', async (status) => {
    const { release } = answer(status, { error: `denied ${status}` });
    release();
    void useCustomViewStore.getState().forceLoadViews();
    render(<MemoryRouter><CustomView viewId="cv-1" /></MemoryRouter>);
    expect(await screen.findByText('Views could not be loaded')).toBeTruthy();
    expect(screen.queryByText('View not found')).toBeNull();

    answer(200, { views: [{ id: 'cv-1', title: 'My view', layout: [], created_at: new Date().toISOString() }], owner: 'me' }).release();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByText('Views could not be loaded')).toBeNull());
    expect(screen.queryByText('View not found')).toBeNull();
  });
});
