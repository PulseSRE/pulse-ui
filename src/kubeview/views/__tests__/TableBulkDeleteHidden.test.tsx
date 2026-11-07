// @vitest-environment jsdom
/**
 * Bulk delete acts on exactly what its confirm lists. Rows selected before a
 * search hid them are not deleted unless the user explicitly includes them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn(), setConnectionStatus: vi.fn() }),
    { getState: () => ({ setSelectedNamespace: vi.fn(), addToast: vi.fn() }) },
  ),
}));
vi.mock('../../store/clusterStore', () => ({ useClusterStore: (sel: any) => sel({ resourceRegistry: null }) }));

const watch: { data: any[]; isLoading: boolean; error: Error | null } = { data: [], isLoading: false, error: null };
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => watch }));

const k8sDelete = vi.fn().mockResolvedValue({});
vi.mock('../../engine/query', () => ({
  k8sPatch: vi.fn().mockResolvedValue({}),
  k8sDelete: (...a: unknown[]) => k8sDelete(...a),
  k8sList: vi.fn().mockResolvedValue([]),
  k8sCreate: vi.fn().mockResolvedValue({}),
  k8sGet: vi.fn().mockResolvedValue({}),
  k8sFetch: vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
}));
vi.mock('../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: true, isLoading: false }) }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 36, size: 36, key: i })),
    measureElement: () => {},
  }),
}));

import TableView from '../table/TableView';
import { registerBuiltinEnhancers } from '../../engine/enhancers/register';

registerBuiltinEnhancers();

const cm = (name: string, uid: string) => ({
  apiVersion: 'v1', kind: 'ConfigMap',
  metadata: { name, namespace: 'shop', uid, creationTimestamp: '2025-01-01T00:00:00Z' },
  data: {},
});

let qc: QueryClient;
function renderTable() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><TableView gvrKey="v1/configmaps" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Tick the row checkbox of each named row. */
function selectRows(...names: string[]) {
  for (const name of names) {
    const row = screen.getAllByText(name).map((el) => el.closest('[data-index]')).find(Boolean) as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
  }
}

async function search(term: string) {
  fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: term } });
  await waitFor(() => expect(screen.queryAllByText('beta-config')).toHaveLength(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  watch.data = [cm('alpha-config', 'a1'), cm('beta-config', 'b1')];
});
afterEach(() => {
  cleanup();
  qc?.clear();
});

describe('bulk delete with a selection hidden by search', () => {
  it('lists exactly the visible selection and deletes only that by default', async () => {
    renderTable();
    selectRows('alpha-config', 'beta-config');
    await search('alpha');
    fireEvent.click(screen.getByRole('button', { name: /Delete 2/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete 1 resource?')).toBeTruthy();
    const list = within(dialog).getByRole('list', { name: 'Resources to delete' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['ConfigMap shop/alpha-config']);
    expect(within(dialog).getByText('1 selected row is hidden by your search')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 1 resource' }));
    await waitFor(() => expect(k8sDelete).toHaveBeenCalledTimes(1));
    expect(k8sDelete.mock.calls[0][0]).toBe('/api/v1/namespaces/shop/configmaps/alpha-config');
  });

  it('deletes the hidden rows too only after the user includes them, and lists them first', async () => {
    renderTable();
    selectRows('alpha-config', 'beta-config');
    await search('alpha');
    fireEvent.click(screen.getByRole('button', { name: /Delete 2/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Also delete the 1 hidden row/ }));
    const list = within(dialog).getByRole('list', { name: 'Resources to delete' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'ConfigMap shop/alpha-config',
      'ConfigMap shop/beta-config',
    ]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 resources' }));
    await waitFor(() => expect(k8sDelete).toHaveBeenCalledTimes(2));
    expect(k8sDelete.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/api/v1/namespaces/shop/configmaps/alpha-config',
      '/api/v1/namespaces/shop/configmaps/beta-config',
    ]);
  });

  it('with only hidden rows selected, nothing can be deleted until they are included', async () => {
    renderTable();
    selectRows('beta-config');
    await search('alpha');
    fireEvent.click(screen.getByRole('button', { name: /Delete 1/ }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete 0 resources' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(k8sDelete).not.toHaveBeenCalled();
  });

  it('without a search, lists every selected row and has no hidden-row notice', async () => {
    renderTable();
    selectRows('alpha-config', 'beta-config');
    fireEvent.click(screen.getByRole('button', { name: /Delete 2/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete 2 resources?')).toBeTruthy();
    expect(within(dialog).queryByText(/hidden by your search/)).toBeNull();
    expect(within(within(dialog).getByRole('list', { name: 'Resources to delete' })).getAllByRole('listitem')).toHaveLength(2);
  });
});
