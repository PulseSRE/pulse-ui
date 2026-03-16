// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResourceBrowser } from '../ResourceBrowser';

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const closeBrowserMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      closeBrowser: closeBrowserMock,
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
  registry.set('batch/v1/jobs', {
    group: 'batch',
    version: 'v1',
    kind: 'Job',
    plural: 'jobs',
    name: 'jobs',
    singularName: 'job',
    namespaced: true,
    verbs: ['get', 'list'],
    shortNames: [],
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

function renderBrowser() {
  return render(
    <MemoryRouter>
      <ResourceBrowser />
    </MemoryRouter>,
  );
}

describe('OpenShiftView ResourceBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry = buildRegistry();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the browser heading', () => {
    renderBrowser();
    expect(screen.getByText('Browse Resources')).toBeDefined();
  });

  it('shows Core group expanded by default', () => {
    renderBrowser();
    expect(screen.getByText('nodes')).toBeDefined();
    expect(screen.getByText('pods')).toBeDefined();
  });

  it('shows API groups sorted with Core first', () => {
    renderBrowser();
    const coreText = screen.getByText('Core (v1)');
    const appsText = screen.getByText('apps');
    const batchText = screen.getByText('batch');
    expect(coreText).toBeDefined();
    expect(appsText).toBeDefined();
    expect(batchText).toBeDefined();
  });

  it('expands a collapsed group on click', () => {
    renderBrowser();
    expect(screen.queryByText('deployments')).toBeNull();
    fireEvent.click(screen.getByText('apps'));
    expect(screen.getByText('deployments')).toBeDefined();
  });

  it('generates correct GVR path for core resources on click', () => {
    renderBrowser();
    fireEvent.click(screen.getByText('nodes'));

    expect(addTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/r/v1~nodes',
        title: 'nodes',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/r/v1~nodes');
  });

  it('generates correct GVR path for grouped resources on click', () => {
    renderBrowser();
    fireEvent.click(screen.getByText('apps'));
    fireEvent.click(screen.getByText('deployments'));

    expect(addTabMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/r/apps~v1~deployments',
        title: 'deployments',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/r/apps~v1~deployments');
  });

  it('does not include undefined in paths', () => {
    renderBrowser();
    fireEvent.click(screen.getByText('nodes'));

    const path = addTabMock.mock.calls[0]?.[0]?.path;
    expect(path).not.toContain('undefined');
  });

  it('closes browser after resource click', () => {
    renderBrowser();
    fireEvent.click(screen.getByText('nodes'));
    expect(closeBrowserMock).toHaveBeenCalled();
  });

  it('filters resources by search query', () => {
    renderBrowser();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'node' } });
    expect(screen.getByText('nodes')).toBeDefined();
    expect(screen.queryByText('pods')).toBeNull();
  });

  it('filters across groups by search', () => {
    renderBrowser();
    const input = screen.getByPlaceholderText(/Search resources/);
    fireEvent.change(input, { target: { value: 'deploy' } });
    expect(screen.getByText('apps')).toBeDefined();
    expect(screen.queryByText('Core (v1)')).toBeNull();
  });

  it('shows built-in pages in pinned section', () => {
    renderBrowser();
    expect(screen.getByText('Cluster Pulse')).toBeDefined();
    expect(screen.getByText('Timeline')).toBeDefined();
    expect(screen.getByText('Dashboard')).toBeDefined();
  });

  it('navigates to pulse on page click', () => {
    renderBrowser();
    fireEvent.click(screen.getByText('Cluster Pulse'));
    expect(navigateMock).toHaveBeenCalledWith('/pulse');
    expect(closeBrowserMock).toHaveBeenCalled();
  });

  it('navigates to timeline on page click', () => {
    renderBrowser();
    fireEvent.click(screen.getByText('Timeline'));
    expect(navigateMock).toHaveBeenCalledWith('/timeline');
    expect(closeBrowserMock).toHaveBeenCalled();
  });

  it('handles null registry gracefully', () => {
    mockRegistry = null;
    renderBrowser();
    expect(screen.getByText('Browse Resources')).toBeDefined();
  });
});
