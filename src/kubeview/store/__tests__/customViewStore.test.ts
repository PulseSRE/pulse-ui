// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCustomViewStore } from '../customViewStore';
import type { ViewSpec, ComponentSpec } from '../../engine/agentComponents';

function makeView(overrides: Partial<ViewSpec> = {}): ViewSpec {
  return {
    id: overrides.id ?? 'v1',
    title: overrides.title ?? 'Test View',
    layout: overrides.layout ?? [],
    generatedAt: overrides.generatedAt ?? Date.now(),
    ...overrides,
  };
}

function makeWidget(title = 'Widget'): ComponentSpec {
  return {
    kind: 'key_value',
    title,
    pairs: [{ key: 'status', value: 'ok' }],
  };
}

/** Mock fetch to simulate the backend API */
function mockFetch(response: any = {}, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
    statusText: 'OK',
  } as Response);
}

describe('customViewStore', () => {
  beforeEach(() => {
    useCustomViewStore.setState({ views: [], loading: false, currentUser: null, activeBuilderId: null });
    vi.restoreAllMocks();
  });

  // ---- Initial state ----

  it('initializes with empty views', () => {
    expect(useCustomViewStore.getState().views).toEqual([]);
  });

  // ---- saveView ----

  it('saves a new view', async () => {
    const fetchSpy = mockFetch({ id: 'v1', owner: 'testuser' });
    const saved = await useCustomViewStore.getState().saveView(makeView({ id: 'v1' }));
    expect(saved).toBe(true);
    const views = useCustomViewStore.getState().views;
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe('v1');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/agent/views',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('saveView returns false on API failure', async () => {
    mockFetch({ error: 'Server error' }, false);
    const saved = await useCustomViewStore.getState().saveView(makeView({ id: 'v-fail' }));
    expect(saved).toBe(false);
    expect(useCustomViewStore.getState().views).toHaveLength(0);
  });

  // ---- deleteView ----

  it('deletes a view by id', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1' }));
    await useCustomViewStore.getState().saveView(makeView({ id: 'v2' }));

    mockFetch({ deleted: true });
    await useCustomViewStore.getState().deleteView('v1');
    const views = useCustomViewStore.getState().views;
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe('v2');
  });

  it('deleting non-existent id removes nothing from local state', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1' }));

    mockFetch({ deleted: true });
    await useCustomViewStore.getState().deleteView('nonexistent');
    expect(useCustomViewStore.getState().views).toHaveLength(1);
  });

  // ---- updateView ----

  it('updates view fields by id', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', title: 'Old' }));

    mockFetch({ updated: true });
    await useCustomViewStore.getState().updateView('v1', { title: 'New', description: 'desc' });
    const view = useCustomViewStore.getState().views[0];
    expect(view.title).toBe('New');
    expect(view.description).toBe('desc');
  });

  it('updateView does nothing for non-existent id', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', title: 'Same' }));

    mockFetch({ updated: true });
    await useCustomViewStore.getState().updateView('nonexistent', { title: 'Changed' });
    expect(useCustomViewStore.getState().views[0].title).toBe('Same');
  });

  // ---- addWidget ----

  it('adds a widget to an existing view', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', layout: [] }));

    mockFetch({ updated: true });
    await useCustomViewStore.getState().addWidget('v1', makeWidget('New Widget'));
    const layout = useCustomViewStore.getState().views[0].layout;
    expect(layout).toHaveLength(1);
    expect((layout[0] as any).title).toBe('New Widget');
  });

  it('addWidget does nothing for non-existent view', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', layout: [] }));

    await useCustomViewStore.getState().addWidget('nonexistent', makeWidget());
    expect(useCustomViewStore.getState().views[0].layout).toHaveLength(0);
  });

  // ---- removeWidget ----

  it('removes a widget by index', async () => {
    const w1 = makeWidget('A');
    const w2 = makeWidget('B');
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', layout: [w1, w2] }));

    mockFetch({ updated: true });
    await useCustomViewStore.getState().removeWidget('v1', 0);
    const layout = useCustomViewStore.getState().views[0].layout;
    expect(layout).toHaveLength(1);
    expect((layout[0] as any).title).toBe('B');
  });

  // ---- getView ----

  it('getView returns the matching view', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', title: 'Found' }));
    const view = useCustomViewStore.getState().getView('v1');
    expect(view?.title).toBe('Found');
  });

  it('getView returns undefined for missing id', () => {
    expect(useCustomViewStore.getState().getView('nope')).toBeUndefined();
  });

  // ---- loadViews ----

  it('loads views from the backend API', async () => {
    const fetchSpy = mockFetch({
      views: [
        { id: 'v1', title: 'Loaded', description: '', icon: '', layout: [], positions: {}, created_at: new Date().toISOString(), owner: 'testuser' },
      ],
      owner: 'testuser',
    });
    await useCustomViewStore.getState().loadViews();
    expect(useCustomViewStore.getState().views).toHaveLength(1);
    expect(useCustomViewStore.getState().views[0].title).toBe('Loaded');
    expect(useCustomViewStore.getState().currentUser).toBe('testuser');
    expect(fetchSpy).toHaveBeenCalledWith('/api/agent/views', expect.anything());
  });

  // ---- Error handling ----

  it('handles API errors gracefully on save', async () => {
    mockFetch({ error: 'Server error' }, false);
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1' }));
    expect(useCustomViewStore.getState().views).toHaveLength(0);
  });

  // ---- createAndAddWidget ----

  it('createAndAddWidget creates a new view and returns its id', async () => {
    mockFetch({ id: 'cv-1', owner: 'testuser' });
    const viewId = await useCustomViewStore.getState().createAndAddWidget(makeWidget('First'));
    expect(viewId).not.toBeNull();
    expect(useCustomViewStore.getState().activeBuilderId).toBe(viewId);
    expect(useCustomViewStore.getState().views).toHaveLength(1);
  });

  it('createAndAddWidget returns null and does not set activeBuilderId when save fails', async () => {
    // Regression: a failed save() must not leave activeBuilderId pointing at
    // a view that was never persisted -- later widget mutations would
    // silently target a non-existent view.
    mockFetch({ error: 'Server error' }, false);
    const viewId = await useCustomViewStore.getState().createAndAddWidget(makeWidget('Doomed'));
    expect(viewId).toBeNull();
    expect(useCustomViewStore.getState().activeBuilderId).toBeNull();
    expect(useCustomViewStore.getState().views).toHaveLength(0);
  });

  it('createAndAddWidget adds to the active builder view without re-saving when one exists', async () => {
    mockFetch({ id: 'v1', owner: 'testuser' });
    await useCustomViewStore.getState().saveView(makeView({ id: 'v1', layout: [] }));
    useCustomViewStore.getState().setActiveBuilderId('v1');

    mockFetch({ updated: true });
    const viewId = await useCustomViewStore.getState().createAndAddWidget(makeWidget('Added'));
    expect(viewId).toBe('v1');
    expect(useCustomViewStore.getState().views[0].layout).toHaveLength(1);
  });

  // ---- claimSharedView ----

  it('claimSharedView reloads views bypassing the debounce window', async () => {
    // Regression: claimSharedView must use forceLoadViews(), not loadViews(),
    // otherwise a recent load elsewhere in the app silently no-ops the reload
    // and the newly claimed view never appears.
    const existing = { id: 'v1', title: 'Existing', description: '', icon: '', layout: [], positions: {}, created_at: new Date().toISOString(), owner: 'testuser' };
    const cloned = { ...existing, id: 'cloned-1', title: 'Cloned' };

    // Prime the debounce window so a plain loadViews() call would no-op afterward.
    // Use forceLoadViews() here (not loadViews()) since the debounce timestamp is
    // module-level state that can carry over from earlier tests in this file.
    mockFetch({ views: [existing], owner: 'testuser' });
    await useCustomViewStore.getState().forceLoadViews();
    expect(useCustomViewStore.getState().views).toHaveLength(1);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'cloned-1' }), statusText: 'OK' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ views: [existing, cloned], owner: 'testuser' }),
        statusText: 'OK',
      } as Response);

    const id = await useCustomViewStore.getState().claimSharedView('share-token-123');
    expect(id).toBe('cloned-1');
    // The whole point of the fix: the clone shows up immediately even though
    // we just loaded views a moment ago (well within the 5s debounce window).
    expect(useCustomViewStore.getState().views.map((v) => v.id)).toContain('cloned-1');
  });
});
