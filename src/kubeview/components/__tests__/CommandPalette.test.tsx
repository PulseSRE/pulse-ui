// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from '../CommandPalette';

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const closeCommandPaletteMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      closeCommandPalette: closeCommandPaletteMock,
      addTab: addTabMock,
    };
    return selector(state);
  },
}));

function buildRegistry() {
  const registry = new Map();
  registry.set('core/v1/nodes', {
    group: '',
    version: 'v1',
    kind: 'Node',
    plural: 'nodes',
    name: 'nodes',
    singularName: 'node',
    namespaced: false,
    verbs: ['get', 'list'],
    shortNames: ['no'],
    categories: [],
  });
  registry.set('core/v1/pods', {
    group: '',
    version: 'v1',
    kind: 'Pod',
    plural: 'pods',
    name: 'pods',
    singularName: 'pod',
    namespaced: true,
    verbs: ['get', 'list'],
    shortNames: ['po'],
    categories: [],
  });
  registry.set('apps/v1/deployments', {
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    plural: 'deployments',
    name: 'deployments',
    singularName: 'deployment',
    namespaced: true,
    verbs: ['get', 'list'],
    shortNames: ['deploy'],
    categories: [],
  });
  registry.set('core/v1/services', {
    group: '',
    version: 'v1',
    kind: 'Service',
    plural: 'services',
    name: 'services',
    singularName: 'service',
    namespaced: true,
    verbs: ['get', 'list'],
    shortNames: ['svc'],
    categories: [],
  });
  return registry;
}

let mockRegistry: Map<string, any> | null = null;

vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (selector: any) => {
    const state = { resourceRegistry: mockRegistry };
    return selector(state);
  },
}));

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

describe('OpenShiftView CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry = buildRegistry();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders search input', () => {
    renderPalette();
    expect(screen.getByPlaceholderText(/Search resources/)).toBeDefined();
  });

  it('handles registry entries with missing fields', () => {
    // Real clusters can have entries with undefined plural/kind/group
    mockRegistry!.set('bad/v1/incomplete', {
      group: undefined,
      version: 'v1',
      kind: undefined,
      plural: undefined,
      singularName: '',
      namespaced: true,
      verbs: ['get', 'list'],
      shortNames: [],
      categories: [],
    });

    // Should not throw
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'node' } });
    expect(screen.getAllByText('nodes').length).toBeGreaterThanOrEqual(1);
  });

  it('shows built-in pages', () => {
    renderPalette();
    expect(screen.getByText('Cluster Pulse')).toBeDefined();
    expect(screen.getByText('Timeline')).toBeDefined();
    expect(screen.getByText('Dashboard')).toBeDefined();
  });

  it('shows resource types from registry', () => {
    renderPalette();
    expect(screen.getAllByText('nodes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('pods').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('deployments').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by search query including pages', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'timeline' } });
    expect(screen.getByText('Timeline')).toBeDefined();
    expect(screen.queryByText('nodes')).toBeNull();
    expect(screen.queryByText('deployments')).toBeNull();
  });

  it('generates correct GVR path for core resources (no group)', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'Node' } });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(addTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/r/v1~nodes',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/r/v1~nodes');
  });

  it('generates correct GVR path for grouped resources', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'Deployment' } });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(addTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/r/apps~v1~deployments',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/r/apps~v1~deployments');
  });

  it('does not include undefined in paths', () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'Enter' });

    const path = addTabMock.mock.calls[0]?.[0]?.path;
    expect(path).toBeDefined();
    expect(path).not.toContain('undefined');
  });

  it('shows subtitle with group/version for grouped resources', () => {
    renderPalette();
    expect(screen.getAllByText('apps/v1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows subtitle with version only for core resources', () => {
    renderPalette();
    expect(screen.getAllByText('v1').length).toBeGreaterThan(0);
  });

  it('shows No results for unmatched query', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'xyznotexist' } });
    expect(screen.getByText('No results found')).toBeDefined();
  });

  it('shows action items when query starts with :', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: ':scale' } });
    expect(screen.getByText('Scale deployment')).toBeDefined();
  });

  it('shows query suggestions when query starts with ?', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: '?fail' } });
    expect(screen.getByText('Show failing pods')).toBeDefined();
  });

  it('keyboard navigation cycles through items', () => {
    renderPalette();
    // First 3 items are pages (Pulse, Timeline, Dashboard), then resources
    // down, down, up = index 1 (Timeline)
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(addTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/timeline',
      }),
    );
  });

  it('closes palette after selection', () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(closeCommandPaletteMock).toHaveBeenCalled();
  });

  it('closes palette on backdrop click', () => {
    renderPalette();
    const backdrop = document.querySelector('.fixed.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(closeCommandPaletteMock).toHaveBeenCalled();
  });

  it('shows only pages when registry is null', () => {
    mockRegistry = null;
    renderPalette();
    // Built-in pages should still show
    expect(screen.getByText('Cluster Pulse')).toBeDefined();
    expect(screen.getByText('Timeline')).toBeDefined();
    // No resources
    expect(screen.queryByText('nodes')).toBeNull();
  });

  it('saves selected resources to recents', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    // Filter to just nodes so only one item
    fireEvent.change(input, { target: { value: 'Node' } });
    fireEvent.keyDown(window, { key: 'Enter' });

    const stored = localStorage.getItem('openshiftview-recents');
    expect(stored).toBeDefined();
    const recents = JSON.parse(stored!);
    expect(recents[0].title).toBe('nodes');
  });

  it('deduplicates resources by group+kind', () => {
    // Add a duplicate Node in the same group — should be deduped
    mockRegistry!.set('core/v1/nodes-duplicate', {
      group: '',
      version: 'v1',
      kind: 'Node',
      plural: 'nodes',
    name: 'nodes',
      singularName: 'node',
      namespaced: false,
      verbs: ['get', 'list'],
      shortNames: [],
      categories: [],
    });

    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'Node' } });
    const nodeItems = screen.getAllByText('nodes');
    expect(nodeItems.length).toBe(1);
  });

  it('shows same-kind resources from different groups separately', () => {
    // Add Node from config.openshift.io — different group, should NOT be deduped
    mockRegistry!.set('config.openshift.io/v1/nodes', {
      group: 'config.openshift.io',
      version: 'v1',
      kind: 'Node',
      plural: 'nodes',
    name: 'nodes',
      singularName: 'node',
      namespaced: false,
      verbs: ['get', 'list'],
      shortNames: [],
      categories: [],
    });

    renderPalette();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'Node' } });
    // Should show both: core nodes and config.openshift.io nodes
    const nodeItems = screen.getAllByText('nodes');
    expect(nodeItems.length).toBe(2);
  });
});
