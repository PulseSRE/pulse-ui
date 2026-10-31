// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => {
      const state = { addToast: vi.fn(), addTab: vi.fn(), selectedNamespace: '*' };
      return selector(state);
    },
    // k8sFetch reads impersonation from the store.
    { getState: () => ({ impersonateUser: '', impersonateGroups: [] }) },
  ),
}));

vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/gvr', () => ({ K8S_BASE: '' }));
vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

// Mock fetch for file listing
const mockFetchResponse = { ok: true, text: () => Promise.resolve('') };
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockFetchResponse)));

import NodeLogsView from '../NodeLogsView';

function renderView(nodeName = 'worker-01') {
  return render(
    <MemoryRouter initialEntries={[`/node-logs/${nodeName}`]}>
      <Routes>
        <Route path="/node-logs/:name" element={<NodeLogsView />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NodeLogsView', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders heading with node name', () => {
    renderView('worker-01');
    expect(screen.getByText('Node Logs')).toBeDefined();
    expect(screen.getByText('worker-01')).toBeDefined();
  });

  it('renders all log source tabs', () => {
    renderView();
    expect(screen.getByText('Audit Logs')).toBeDefined();
    expect(screen.getByText('Journal')).toBeDefined();
    expect(screen.getByText('CRI-O')).toBeDefined();
    expect(screen.getByText('Containers')).toBeDefined();
    expect(screen.getByText('OVN/Network')).toBeDefined();
  });

  it('shows file list sidebar with count', () => {
    renderView();
    expect(screen.getByText(/Files/)).toBeDefined();
  });

  it('shows search input for filtering logs', () => {
    renderView();
    expect(screen.getByPlaceholderText('Filter log lines...')).toBeDefined();
  });

  it('shows no-files message when directory listing is empty', async () => {
    renderView();
    await vi.waitFor(() => {
      expect(screen.getByText('No log files found')).toBeDefined();
    });
  });
});
