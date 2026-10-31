// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
vi.mock('react-router-dom', async () => { const a = await vi.importActual('react-router-dom'); return { ...a, useNavigate: () => vi.fn() }; });
vi.mock('../../store/uiStore', () => ({ useUIStore: (s: any) => s({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn(), impersonateUser: null, impersonateGroups: [], setImpersonation: vi.fn(), clearImpersonation: vi.fn() }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), k8sDelete: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }));
import IdentityView from '../IdentityView';
function r() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><IdentityView /></MemoryRouter></QueryClientProvider>); }
describe('IdentityView', () => {
  afterEach(cleanup);
  it('renders page header', () => { r(); expect(document.body.textContent).toContain('Identity'); });
  it('renders all 4 tabs', () => { r(); const text = document.body.textContent || ''; expect(text).toContain('Users'); expect(text).toContain('Groups & Service Accounts'); expect(text).toContain('RBAC'); expect(text).toContain('Impersonation'); });
  it('renders without crashing', () => { const { container } = r(); expect(container.querySelector('.bg-slate-950')).toBeDefined(); });
  it('shows summary counts', () => { r(); for (const l of ['Users', 'Groups', 'Service Accounts']) expect(screen.getAllByText(l).length).toBeGreaterThan(0); });
  it('counts roles and bindings on the RBAC tab only, and shows the SA-by-namespace panel once', () => {
    r();
    expect(screen.queryByText('Cluster Roles')).toBeNull();
    fireEvent.click(screen.getByText('Roles & bindings →'));
    expect(screen.getAllByText('Cluster Roles')).toHaveLength(1);
    expect(screen.getAllByText('Role Bindings')).toHaveLength(1);
    expect(screen.queryByText('Service Accounts by Namespace')).toBeNull();
  });
});
