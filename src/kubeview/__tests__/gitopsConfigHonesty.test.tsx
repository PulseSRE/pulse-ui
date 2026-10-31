// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../store/uiStore', () => {
  const state = { impersonateUser: '', impersonateGroups: [], addDegradedReason: vi.fn(), removeDegradedReason: vi.fn() };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});

import { mockFetchRoutes } from './helpers/honestStates';
import { useGitOpsConfig } from '../hooks/useGitOpsConfig';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

describe('useGitOpsConfig.testConnection', () => {
  it('tests a Bitbucket App Password with Basic auth', async () => {
    const fetchMock = mockFetchRoutes({ 'api.bitbucket.org': { body: {} } }, 404);
    const { result } = renderHook(() => useGitOpsConfig(), { wrapper });
    const r = await result.current.testConnection({ provider: 'bitbucket', repoUrl: 'https://bitbucket.org/acme/gitops', baseBranch: 'main', token: 'alice:secret' });
    expect(r.success).toBe(true);
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('api.bitbucket.org'))!;
    expect(String(call[0])).toBe('https://api.bitbucket.org/2.0/repositories/acme/gitops');
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: `Basic ${btoa('alice:secret')}` });
  });

  it('does not claim the agent will validate the connection when the browser cannot reach the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u).includes('github.com')) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 404 });
    }));
    const { result } = renderHook(() => useGitOpsConfig(), { wrapper });
    const r = await result.current.testConnection({ provider: 'github', repoUrl: 'https://github.com/acme/gitops', baseBranch: 'main', token: 't' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/was not tested/);
    expect(r.error).not.toMatch(/Agent/i);
  });
});
