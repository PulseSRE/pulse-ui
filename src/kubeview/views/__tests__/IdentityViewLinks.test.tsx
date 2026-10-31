// @vitest-environment jsdom
/** RBAC audit: failing items of the token-automount check are ServiceAccounts. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const goMock = vi.fn();
vi.mock('../../store/uiStore', () => ({ useUIStore: (s: any) => s({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn(), impersonateUser: null, impersonateGroups: [], setImpersonation: vi.fn(), clearImpersonation: vi.fn() }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => goMock }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), k8sDelete: vi.fn().mockResolvedValue({}) }));

const data: Record<string, unknown[]> = {
  '/api/v1/serviceaccounts': [{ metadata: { name: 'deployer-bot', namespace: 'shop', uid: 'sa1' } }],
  '/apis/rbac.authorization.k8s.io/v1/rolebindings': [{
    metadata: { name: 'bot-admin', namespace: 'shop', uid: 'rb1' },
    roleRef: { kind: 'ClusterRole', name: 'admin', apiGroup: 'rbac.authorization.k8s.io' },
    subjects: [{ kind: 'ServiceAccount', name: 'deployer-bot', namespace: 'shop' }],
  }],
};
vi.mock('../../hooks/useK8sListWatch', () => ({
  useK8sListWatch: ({ apiPath }: { apiPath: string }) => ({ data: data[apiPath] ?? [], isLoading: false }),
}));

import IdentityView from '../IdentityView';

describe('IdentityView RBAC audit links', () => {
  afterEach(() => { cleanup(); goMock.mockReset(); window.history.replaceState(null, '', '/'); });

  it('opens the ServiceAccount, not a RoleBinding YAML of the same name', () => {
    window.history.replaceState(null, '', '/identity?tab=rbac');
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><IdentityView /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('ServiceAccount Token Automount').closest('button')!);
    const item = screen.getAllByText('deployer-bot').map((el) => el.closest('button')).filter(Boolean).pop()!;
    fireEvent.click(item);
    expect(goMock).toHaveBeenCalledWith('/r/v1~serviceaccounts/shop/deployer-bot', 'deployer-bot');
  });
});
