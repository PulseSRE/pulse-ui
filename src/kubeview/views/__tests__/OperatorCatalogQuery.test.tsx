// @vitest-environment jsdom
/**
 * Readiness gates and the cluster-logging next step now link to
 * `/operators?q=<name>` instead of `/create/v1~pods?tab=operators&q=…` (the
 * create-Pod page). The catalog must pick the query up.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('../../store/uiStore', () => ({ useUIStore: (selector: any) => selector({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn() }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), k8sCreate: vi.fn(), k8sDelete: vi.fn(),
}));
vi.mock('../../components/feedback/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import OperatorCatalogView from '../OperatorCatalogView';

describe('/operators?q=', () => {
  afterEach(cleanup);

  it.each(['loki', 'cluster-logging', 'oadp'])('pre-fills the search with %s', (q) => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/operators?q=${q}`]}><OperatorCatalogView /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect((screen.getByPlaceholderText('Search operators...') as HTMLInputElement).value).toBe(q);
  });
});
