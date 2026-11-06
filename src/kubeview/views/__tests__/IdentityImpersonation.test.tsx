// @vitest-environment jsdom
/**
 * Impersonate is offered once per subject: on user rows (Users) and service
 * account rows (Groups & Service Accounts). There is no Impersonation tab:
 * the Shell's banner shows who is impersonated and has Stop, and an old
 * `?tab=impersonation` link opens the default (Users) tab.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
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

function r(url = '/identity') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}><IdentityView /></MemoryRouter></QueryClientProvider>);
}
const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => { localStorage.clear(); ui.impersonateUser = null; vi.clearAllMocks(); });
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

describe('Identity impersonation', () => {
  it('users are impersonated from their row on the Users tab', () => {
    r();
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate alice' }));
    expect(ui.setImpersonation).toHaveBeenCalledWith('alice');
    expect(ui.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Impersonating alice' }));
  });

  it('service accounts are impersonated from their row on Groups & Service Accounts', () => {
    r();
    tab(/Groups & Service Accounts/);
    fireEvent.click(screen.getByRole('button', { name: 'Impersonate shop/builder' }));
    expect(ui.setImpersonation).toHaveBeenCalledWith('system:serviceaccount:shop:builder');
  });

  it('the subject being impersonated shows as Impersonating, disabled', () => {
    ui.impersonateUser = 'alice';
    r();
    expect(screen.getByRole('button', { name: 'Impersonating alice' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Impersonate bob' })).toHaveProperty('disabled', false);
  });

  it('every subject has exactly one Impersonate action across the tabs', () => {
    r();
    const seen: string[] = [];
    for (const t of [/^Users$/, /Groups & Service Accounts/, /RBAC/, /Sign-in/]) {
      tab(t);
      seen.push(...screen.queryAllByRole('button', { name: /^Impersonate / }).map((b) => b.getAttribute('aria-label')!));
    }
    expect(seen.sort()).toEqual(['Impersonate alice', 'Impersonate bob', 'Impersonate shop/builder']);
  });

  it('has no Impersonation tab, and an old ?tab=impersonation link opens Users', () => {
    r('/identity?tab=impersonation');
    expect(screen.queryByRole('tab', { name: /Impersonation/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /^Users$/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Impersonate alice' })).toBeDefined();
    expect(screen.queryByText('Recently impersonated')).toBeNull();
  });
});
