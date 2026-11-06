// @vitest-environment jsdom
/**
 * The /r/* resource list is one table: the header row, the filter row and
 * every body row share one grid template, so a value can only sit under its
 * own header (it used to be a header <table> over flex rows, and Pods showed
 * the status under READY). Rows are rows, cells are cells, checkboxes say what
 * they select, and the sorted column says so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const invalidateSpy = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({
      selectedNamespace: '*',
      addTab: addTabMock,
      addToast: vi.fn(),
      setSelectedNamespace: vi.fn(),
      setConnectionStatus: vi.fn(),
    }),
    { getState: () => ({ setSelectedNamespace: vi.fn() }) },
  ),
}));

vi.mock('../../../store/clusterStore', () => ({
  useClusterStore: (selector: (s: unknown) => unknown) => selector({ resourceRegistry: null }),
}));

const watch: { data: unknown[]; isLoading: boolean; error: Error | null } = { data: [], isLoading: false, error: null };
vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => watch }));

vi.mock('../../../engine/query', () => ({
  k8sPatch: vi.fn().mockResolvedValue({}),
  k8sDelete: vi.fn().mockResolvedValue({}),
  k8sList: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../hooks/useCanI', () => ({
  useCanI: () => ({ allowed: true, isLoading: false }),
}));

const scrollToIndex = vi.fn();
// jsdom has no layout, so the virtualizer is replaced by one that renders every row.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 36, size: 36, key: i })),
    measureElement: () => {},
    scrollToIndex,
  }),
}));

import TableView from '../TableView';
import { registerBuiltinEnhancers } from '../../../engine/enhancers/register';
import { buildColumnTemplate, actionsColumnWidth, trackFor, headerWidth, SELECT_COLUMN_PX } from '../columnTemplate';

function pod(name: string, opts: { namespace?: string; restarts?: number; phase?: string; created?: string } = {}) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      namespace: opts.namespace ?? 'default',
      uid: `uid-${name}`,
      creationTimestamp: opts.created ?? '2025-01-01T00:00:00Z',
      labels: { app: name },
    },
    spec: { nodeName: 'worker-1', containers: [{ name: 'main', image: 'x' }] },
    status: {
      phase: opts.phase ?? 'Running',
      podIP: '10.0.0.1',
      containerStatuses: [{ name: 'main', ready: true, restartCount: opts.restarts ?? 0, state: { running: {} } }],
    },
  };
}

function renderTable(gvrKey = 'v1/pods') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  qc.invalidateQueries = invalidateSpy as unknown as typeof qc.invalidateQueries;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TableView gvrKey={gvrKey} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

registerBuiltinEnhancers();

const headerRow = () => screen.getAllByRole('row')[0];
const bodyRows = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-index'));
const headerTexts = () => within(headerRow()).getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');
const rowNames = () => bodyRows().map((r) => cellsOf(r)[1].textContent ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  watch.data = [];
  watch.isLoading = false;
  watch.error = null;
});
afterEach(() => cleanup());

describe('column template', () => {
  it('keeps pixel widths fixed and lets percentage and unsized columns grow from a floor', () => {
    expect(trackFor('150px')).toEqual({ track: '150px', min: 150 });
    expect(trackFor('25%').track).toMatch(/^minmax\(200px, \d+fr\)$/);
    expect(trackFor(undefined).track).toMatch(/^minmax\(120px, 1fr\)$/);
  });

  it('never makes a column narrower than its header, so READY is not cut to REA…', () => {
    const ready = trackFor('70px', 'Ready', true);
    expect(ready.min).toBeGreaterThan(70);
    expect(ready.track).toBe(`${ready.min}px`);
    expect(ready.min).toBeGreaterThanOrEqual(headerWidth('Ready', true));
    expect(trackFor('150px', 'Status', true).track).toBe('150px');
    expect(trackFor(undefined, 'A very long custom column header', false).min).toBe(headerWidth('A very long custom column header'));
  });

  it('starts with the checkbox column, ends with actions, and sums the floors into a min width', () => {
    const t = buildColumnTemplate([
      { width: '25%', header: 'Name', sortable: true },
      { width: '70px', header: 'IP', sortable: false },
      { header: 'Zone', sortable: false },
    ], 120);
    expect(t.template.split(' ')[0]).toBe(`${SELECT_COLUMN_PX}px`);
    expect(t.template.endsWith(' 120px')).toBe(true);
    expect(t.minWidth).toBe(48 + 200 + 70 + 120 + 120);
  });

  it('widens the actions column to the widest actions seen, never narrows it', () => {
    const estimate = actionsColumnWidth(3);
    expect(actionsColumnWidth(3, 0)).toBe(estimate);
    expect(actionsColumnWidth(3, 10)).toBe(estimate);
    expect(actionsColumnWidth(3, 400)).toBe(432);
  });
});

describe('resource list table: alignment and semantics', () => {
  it('header, filter row and every body row use one grid template, one cell per header', () => {
    watch.data = [pod('alpha'), pod('beta', { restarts: 7, phase: 'Pending' }), pod('gamma')];
    renderTable();
    fireEvent.click(screen.getByTitle('Column filters'));

    const table = screen.getByRole('table', { name: 'Pods' });
    const rows = within(table).getAllByRole('row');
    const template = headerRow().style.gridTemplateColumns;
    expect(template).toMatch(/^48px /);
    const headerCount = headerTexts().length;
    for (const row of rows) {
      expect(row.style.gridTemplateColumns).toBe(template);
    }
    for (const row of bodyRows()) {
      expect(cellsOf(row)).toHaveLength(headerCount);
    }
    expect(bodyRows()).toHaveLength(3);
  });

  it('each value sits under its own header (Status under STATUS, restarts under RESTARTS)', () => {
    watch.data = [pod('beta', { restarts: 7, phase: 'Pending' })];
    renderTable();
    const headers = headerTexts();
    const cells = cellsOf(bodyRows()[0]);
    expect(cells[headers.indexOf('Name')].textContent).toContain('beta');
    expect(cells[headers.indexOf('Status')].textContent).toMatch(/Pending/);
    expect(cells[headers.indexOf('Restarts')].textContent).toContain('7');
    expect(within(cells[headers.indexOf('Actions')]).getByTitle('Delete')).toBeDefined();
    expect(within(cells[headers.indexOf('Actions')]).getByRole('button', { name: 'Edit YAML' })).toBeDefined();
  });

  it('labels the row checkboxes, the header checkbox, the search, the column filters and the page size', () => {
    watch.data = [pod('alpha'), pod('beta')];
    renderTable();
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Select alpha' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Select beta' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Search pods' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: /Rows per page/ })).toBeDefined();
    fireEvent.click(screen.getByTitle('Column filters'));
    expect(screen.getByRole('textbox', { name: 'Filter Name' })).toBeDefined();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-label')).toMatch(/^Select /);
    }
  });
});

describe('resource list table: sorting', () => {
  it('sorts by the clicked header, toggles direction, and marks only that header with aria-sort', () => {
    watch.data = [pod('bravo'), pod('alpha'), pod('charlie')];
    renderTable();
    const nameHeader = () => within(headerRow()).getAllByRole('columnheader').find((h) => h.textContent?.includes('Name'))!;

    expect(rowNames()).toEqual(['alpha', 'bravo', 'charlie']);
    expect(nameHeader().getAttribute('aria-sort')).toBe('ascending');
    expect(within(headerRow()).getAllByRole('columnheader').filter((h) => h.hasAttribute('aria-sort'))).toHaveLength(1);

    fireEvent.click(within(nameHeader()).getByRole('button'));
    expect(rowNames()).toEqual(['charlie', 'bravo', 'alpha']);
    expect(nameHeader().getAttribute('aria-sort')).toBe('descending');

    const restarts = within(headerRow()).getAllByRole('columnheader').find((h) => h.textContent?.includes('Restarts'))!;
    fireEvent.click(within(restarts).getByRole('button'));
    expect(restarts.getAttribute('aria-sort')).toBe('ascending');
    expect(nameHeader().hasAttribute('aria-sort')).toBe(false);
  });

  it('a column that cannot be sorted has no sort button', () => {
    watch.data = [pod('alpha')];
    renderTable();
    const labels = within(headerRow()).getAllByRole('columnheader').find((h) => h.textContent === 'Labels')!;
    expect(within(labels).queryByRole('button')).toBeNull();
  });
});

describe('resource list table: selection', () => {
  it('row checkboxes select one row; the header box shows mixed, then selects the page', () => {
    watch.data = [pod('alpha'), pod('beta')];
    renderTable();
    const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select beta' }));
    expect((screen.getByRole('checkbox', { name: 'Select beta' }) as HTMLInputElement).checked).toBe(true);
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    expect(screen.getByText('Delete 1')).toBeDefined();

    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(screen.getByText('Delete 2')).toBeDefined();

    fireEvent.click(all);
    expect(screen.queryByText(/Delete \d/)).toBeNull();
  });
});

describe('resource list table: keyboard', () => {
  it('j/k move focus to the row, x selects it, Enter opens it', () => {
    watch.data = [pod('alpha'), pod('beta')];
    renderTable();

    act(() => { fireEvent.keyDown(window, { key: 'j' }); });
    expect(document.activeElement).toBe(bodyRows()[0]);
    expect(bodyRows()[0].tabIndex).toBe(0);
    expect(bodyRows()[1].tabIndex).toBe(-1);

    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'j' }); });
    expect(document.activeElement).toBe(bodyRows()[1]);
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'auto' });

    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'x' }); });
    expect((screen.getByRole('checkbox', { name: 'Select beta' }) as HTMLInputElement).checked).toBe(true);

    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'k' }); });
    expect(document.activeElement).toBe(bodyRows()[0]);

    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); });
    expect(navigateMock).toHaveBeenCalledWith('/r/v1~pods/default/alpha');
  });

  it('Enter on a focused button belongs to the button, and typing in search moves nothing', () => {
    watch.data = [pod('alpha'), pod('beta')];
    renderTable();
    act(() => { fireEvent.keyDown(window, { key: 'j' }); });

    const yaml = within(bodyRows()[0]).getByRole('button', { name: 'Edit YAML' });
    yaml.focus();
    act(() => { fireEvent.keyDown(yaml, { key: 'Enter' }); });
    expect(navigateMock).not.toHaveBeenCalledWith('/r/v1~pods/default/alpha');

    const search = screen.getByRole('textbox', { name: 'Search pods' });
    search.focus();
    act(() => { fireEvent.keyDown(search, { key: 'j' }); });
    expect(document.activeElement).toBe(search);
    expect(bodyRows()[0].tabIndex).toBe(0);
  });

  it('a click on a row checkbox keeps focus on the checkbox', () => {
    watch.data = [pod('alpha'), pod('beta')];
    renderTable();
    const box = screen.getByRole('checkbox', { name: 'Select beta' });
    box.focus();
    fireEvent.click(box);
    expect(document.activeElement).toBe(box);
  });
});

describe('resource list table: loading, empty, error and no-match states', () => {
  it('loading says what is loading and renders no table', () => {
    watch.isLoading = true;
    renderTable();
    expect(screen.getByRole('status').textContent).toContain('Loading pods');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a successful empty read says there are none, with Create', () => {
    renderTable();
    expect(screen.getByText('No pods found')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create Pods' })).toBeDefined();
  });

  it('a failed read shows the error and Retry, not an empty list', () => {
    watch.error = new Error('pods is forbidden: User "dev" cannot list resource "pods"');
    renderTable();
    expect(screen.getByText('Error loading resources')).toBeDefined();
    expect(screen.getByText(/pods is forbidden/)).toBeDefined();
    expect(screen.queryByText('No pods found')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['k8s', 'list', '/api/v1/pods'] });
  });

  it('filters that match nothing keep the headers and say so inside the table', () => {
    vi.useFakeTimers();
    try {
      watch.data = [pod('alpha'), pod('beta')];
      renderTable();
      fireEvent.change(screen.getByRole('textbox', { name: 'Search pods' }), { target: { value: 'zzz' } });
      act(() => { vi.advanceTimersByTime(250); });
      const table = screen.getByRole('table');
      expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(3);
      expect(within(table).getByRole('cell', { name: /0 of 2 pods match your filters/ })).toBeDefined();
      expect(within(table).getByRole('button', { name: 'Clear all filters' })).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
