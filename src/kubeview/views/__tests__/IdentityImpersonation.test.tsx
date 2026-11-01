// @vitest-environment jsdom
/**
 * Impersonate is offered once per subject: on user rows (Users) and service
 * account rows (Groups & Service Accounts). The Impersonation tab shows the
 * current impersonation and recent targets, not another user list.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const { ui } = vi.hoisted(() => ({
  ui: { impersonateUser: null as string | null, setImpersonation: vi.fn(), clearImpersonation: vi.fn(), addToast: vi.fn() },
}));
vi.mock('react-router-dom', async () => { const a = await vi.importActual('react-router-dom'); return { ...a, useNavigate: () => vi.fn() }; });
vi.mock('../../store/uiStore', () => ({ useUIStore: (s: any) => s({ selectedNamespace: '*', addTab: vi.fn(), impersonateGroups: [], ...ui }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({
    isLoading: false,
    data: apiPath.endsWith('/users')
      ? [{ metadata: { name: 'alice', uid: 'u1' } }, { metadata: { name: 'bob', uid: 'u2' } }]
      : apiPath.endsWith('/serviceaccounts')
        ? [{ metadata: { name: 'builder', namespace: 'shop', uid: 's1' } }]
        : [],
  }),
}));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), k8sDelete: vi.fn().mockResolvedValue({}) }));

import IdentityView from '../IdentityView';

function r() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><IdentityView /></MemoryRouter></QueryClientProvider>);
}
const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => { localStorage.clear(); ui.impersonateUser = null; vi.clearAllMocks(); });
afterEach(cleanup);

describe('Identity impersonation', () => {
  it('users are impersonated from the Users tab; the Impersonation tab has no second user list', () => {
    r();
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate alice' }));
    expect(ui.setImpersonation).toHaveBeenCalledWith('alice');
    tab(/Impersonation/);
    expect(screen.queryByRole('button', { name: 'Impersonate bob' })).toBeNull();
    // alice is a recent target, listed once with the action.
    const recent = screen.getByLabelText('Recently impersonated');
    expect(within(recent).getByText('alice')).toBeDefined();
    expect(within(recent).getAllByRole('button', { name: /Impersonat/ })).toHaveLength(1);
  });

  it('service accounts are impersonated from their row on Groups & Service Accounts', () => {
    r();
    tab(/Groups & Service Accounts/);
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate shop/builder' }));
    expect(ui.setImpersonation).toHaveBeenCalledWith('system:serviceaccount:shop:builder');
  });

  it('every subject has exactly one Impersonate action across the tabs', () => {
    r();
    const seen: string[] = [];
    for (const t of [/^Users$/, /Groups & Service Accounts/, /RBAC/, /Impersonation/]) {
      tab(t);
      seen.push(...screen.queryAllByRole('button', { name: /^Impersonate / }).map((b) => b.getAttribute('aria-label')!));
    }
    expect(seen.sort()).toEqual(['Impersonate alice', 'Impersonate bob', 'Impersonate shop/builder']);
  });

  it('shows who is being impersonated with Stop, and recent targets re-impersonate', () => {
    localStorage.setItem('pulse-recent-impersonation:local', JSON.stringify(['system:serviceaccount:shop:builder', 'alice']));
    ui.impersonateUser = 'alice';
    r();
    tab(/Impersonation/);
    expect(screen.getByText('Currently impersonating')).toBeDefined();
    const recent = screen.getByLabelText('Recently impersonated');
    expect(within(recent).getByRole('button', { name: 'Impersonating alice' })).toHaveProperty('disabled', true);
    fireEvent.click(within(recent).getByRole('button', { name: 'Impersonate system:serviceaccount:shop:builder' }));
    expect(ui.setImpersonation).toHaveBeenCalledWith('system:serviceaccount:shop:builder');
    fireEvent.click(screen.getByRole('button', { name: 'Stop Impersonating' }));
    expect(ui.clearImpersonation).toHaveBeenCalled();
  });

  it('an unreadable recent list is treated as empty', () => {
    localStorage.setItem('pulse-recent-impersonation:local', '{not json');
    r();
    tab(/Impersonation/);
    expect(screen.getByText('No recent impersonation')).toBeDefined();
  });
});
