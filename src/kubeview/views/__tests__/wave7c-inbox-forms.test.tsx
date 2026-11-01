// @vitest-environment jsdom
/**
 * Wave 7c: new-task due date and namespace picker, clickable episode symptoms,
 * and Views clone / filter / share failure. Each pins the request sent and the
 * failure path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

const k8sList = vi.fn();
vi.mock('../../engine/query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../engine/query');
  return { ...actual, k8sList: (...args: unknown[]) => k8sList(...args) };
});

const fetchEpisode = vi.fn();
const fetchOpenEpisodes = vi.fn();
vi.mock('../../engine/episodeApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../engine/episodeApi');
  return {
    ...actual,
    fetchEpisode: (...a: unknown[]) => fetchEpisode(...a),
    fetchOpenEpisodes: (...a: unknown[]) => fetchOpenEpisodes(...a),
  };
});

import { NewTaskDialog } from '../inbox/NewTaskDialog';
import { EpisodePanel, symptomResource } from '../inbox/EpisodePanel';
import ViewsManagement from '../ViewsManagement';
import { useInboxStore } from '../../store/inboxStore';
import { useUIStore } from '../../store/uiStore';
import { useCustomViewStore } from '../../store/customViewStore';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

type Call = { url: string; method: string; body: unknown };
type Handler = (call: Call) => { status?: number; body: unknown };

function route(handlers: Array<[string, Handler]>) {
  const calls: Call[] = [];
  mockFetch.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    const call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const hit = handlers.find(([k]) => `${method} ${url}`.includes(k));
    const out = hit ? hit[1](call) : { status: 200, body: {} };
    const status = out.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
      headers: new Headers(),
      json: () => Promise.resolve(out.body),
    });
  });
  return calls;
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="*" element={<>{ui}<Where /></>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const toasts = () => useUIStore.getState().toasts.map((t) => t.title);

beforeEach(() => {
  mockFetch.mockReset();
  k8sList.mockReset();
  fetchEpisode.mockReset();
  fetchOpenEpisodes.mockReset();
  useUIStore.setState({ toasts: [] });
  useInboxStore.setState({ selectedItemId: null });
});
afterEach(() => cleanup());

describe('new task', () => {
  const routes: Array<[string, Handler]> = [
    ['POST /api/agent/inbox', () => ({ status: 201, body: { id: 'inb-new', item_type: 'task', status: 'new' } })],
    ['GET /api/agent/inbox', () => ({ body: { items: [], groups: [], stats: {}, total: 0 } })],
  ];

  it('picks the namespace from the cluster and sends the due date as epoch seconds', async () => {
    k8sList.mockResolvedValue([{ metadata: { name: 'shop' } }, { metadata: { name: 'bank' } }]);
    const calls = route(routes);
    wrap(<NewTaskDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Rotate certs' } });
    await screen.findByRole('option', { name: 'shop' });
    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'shop' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body.title).toBe('Rotate certs');
    expect(body.namespace).toBe('shop');
    expect(body.due_date).toBe(Math.floor(new Date('2026-11-15T23:59:59').getTime() / 1000));
  });

  it('sends no due date or namespace when none is chosen', async () => {
    k8sList.mockResolvedValue([{ metadata: { name: 'shop' } }]);
    const calls = route(routes);
    wrap(<NewTaskDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body.due_date).toBeUndefined();
    expect(body.namespace).toBeUndefined();
  });

  it('falls back to typing the namespace when namespaces cannot be listed', async () => {
    k8sList.mockRejectedValue(new Error('403 Forbidden'));
    const calls = route(routes);
    wrap(<NewTaskDialog open onClose={vi.fn()} />);
    const input = await waitFor(() => {
      const el = screen.getByLabelText('Namespace');
      expect(el.tagName).toBe('INPUT');
      return el;
    });
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'x' } });
    fireEvent.change(input, { target: { value: 'payments' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect((calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>)?.namespace).toBe('payments'));
  });

  it('keeps the dialog open and says so when creating fails', async () => {
    k8sList.mockResolvedValue([]);
    route([['POST /api/agent/inbox', () => ({ status: 500, body: {} })]]);
    const onClose = vi.fn();
    wrap(<NewTaskDialog open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(toasts()).toContain('Failed to create task'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('episode symptoms', () => {
  const episode = {
    id: 'ep-1',
    cause_title: 'etcd leader changes',
    cause_category: 'control_plane',
    started_at: Math.floor(Date.now() / 1000) - 600,
    namespaces: ['shop'],
    symptom_count: 3,
  };
  const symptom = (key: string, title: string, item_id: string | null) => ({
    episode_id: 'ep-1', correlation_key: key, category: 'crashloop', title, namespace: 'shop',
    attached_at: 0, detached_at: null, detached_by: null, item_id,
  });

  it('opens the inbox item a symptom belongs to, else links its resource', async () => {
    fetchOpenEpisodes.mockResolvedValue([episode]);
    fetchEpisode.mockResolvedValue({
      episode,
      symptoms: [
        symptom('crashloop:shop:Pod/api', 'api crashlooping', 'inb-7'),
        symptom('degraded:shop:Deployment/web', 'web degraded', null),
        symptom('crashloop:shop:Pod/worker', 'worker crashlooping', null),
      ],
    });
    wrap(<EpisodePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'api crashlooping' }));
    expect(useInboxStore.getState().selectedItemId).toBe('inb-7');

    expect(screen.getByText('web degraded').closest('a')?.getAttribute('href')).toBe('/r/apps~v1~deployments/shop/web');
    // A pod key names no real pod (its suffix is stripped): plain text, no dead link.
    expect(screen.getByText('worker crashlooping').closest('a, button')).toBeNull();
  });

  it('"What else changed" navigates in the app instead of reloading it', async () => {
    fetchOpenEpisodes.mockResolvedValue([episode]);
    fetchEpisode.mockResolvedValue({ episode, symptoms: [] });
    wrap(<EpisodePanel />);
    fireEvent.click(await screen.findByText(/What else changed/));
    expect(screen.getByTestId('where').textContent).toBe('/timeline?range=15m');
  });

  it('parses only linkable symptom keys', () => {
    expect(symptomResource('degraded:shop:Deployment/web')).toEqual({ kind: 'Deployment', name: 'web', namespace: 'shop' });
    expect(symptomResource('crashloop:shop:Pod/api')).toBeNull();
    expect(symptomResource('alert:shop:HighErrorRate')).toBeNull();
  });
});

describe('views management', () => {
  const view = (id: string, title: string, view_type: string) => ({
    id, title, description: '', layout: [{ kind: 'chart' }], positions: {}, created_at: new Date().toISOString(), owner: 'alice', view_type,
  });

  beforeEach(() => {
    useCustomViewStore.setState({ views: [], loading: false, error: null });
  });

  function views() {
    return [view('v1', 'Node health', 'custom'), view('v2', 'Checkout incident', 'incident')];
  }

  it('clones a view through the clone endpoint and shows the copy', async () => {
    let cloned = false;
    const calls = route([
      ['POST /api/agent/views/v1/clone', () => { cloned = true; return { body: { id: 'v3', owner: 'alice' } }; }],
      ['GET /api/agent/views', () => ({ body: { views: cloned ? [...views(), view('v3', 'Node health (copy)', 'custom')] : views(), owner: 'alice' } })],
    ]);
    useCustomViewStore.getState().forceLoadViews();
    wrap(<ViewsManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clone Node health' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/views/v1/clone'))).toHaveLength(1));
    expect(await screen.findByText('Node health (copy)')).toBeTruthy();
    expect(toasts()).toContain('Cloned "Node health"');
  });

  it('says when cloning fails', async () => {
    route([
      ['POST /api/agent/views/v1/clone', () => ({ status: 403, body: { error: 'View not found or not owned by you' } })],
      ['GET /api/agent/views', () => ({ body: { views: views(), owner: 'alice' } })],
    ]);
    useCustomViewStore.getState().forceLoadViews();
    wrap(<ViewsManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clone Node health' }));
    await waitFor(() => expect(toasts()).toContain('Clone failed'));
  });

  it('filters by type and by search', async () => {
    route([['GET /api/agent/views', () => ({ body: { views: views(), owner: 'alice' } })]]);
    useCustomViewStore.getState().forceLoadViews();
    wrap(<ViewsManagement />);
    await screen.findByText('Node health');
    fireEvent.click(screen.getByRole('button', { name: 'Incident (1)' }));
    expect(screen.queryByText('Node health')).toBeNull();
    expect(screen.getByText('Checkout incident')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All (2)' }));
    fireEvent.change(screen.getByPlaceholderText('Search views'), { target: { value: 'node' } });
    await waitFor(() => expect(screen.queryByText('Checkout incident')).toBeNull());
    expect(screen.getByText('Node health')).toBeTruthy();
  });

  it('says when sharing fails instead of doing nothing', async () => {
    const calls = route([
      ['POST /api/agent/views/v1/share', () => ({ status: 500, body: { error: 'boom' } })],
      ['GET /api/agent/views', () => ({ body: { views: views(), owner: 'alice' } })],
    ]);
    useCustomViewStore.getState().forceLoadViews();
    wrap(<ViewsManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Share Node health' }));
    await waitFor(() => expect(toasts()).toContain('Share failed'));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/views/v1/share'))).toBe(true);
  });

  it('shows the link when the clipboard refuses it', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    route([
      ['POST /api/agent/views/v1/share', () => ({ body: { share_token: 'tok123' } })],
      ['GET /api/agent/views', () => ({ body: { views: views(), owner: 'alice' } })],
    ]);
    useCustomViewStore.getState().forceLoadViews();
    wrap(<ViewsManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Share Node health' }));
    await waitFor(() => expect(toasts()).toContain('Copy the share link'));
    expect(useUIStore.getState().toasts.find((t) => t.title === 'Copy the share link')?.detail).toContain('/share/tok123');
  });
});
