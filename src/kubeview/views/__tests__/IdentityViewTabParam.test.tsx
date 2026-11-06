// @vitest-environment jsdom
/** Identity keeps its tab in `?tab=` through the router (useTabParam). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { renderRouted } from '../../__tests__/helpers/routerTabs';
vi.mock('../../store/uiStore', () => ({ useUIStore: (s: any) => s({ selectedNamespace: '*', addTab: vi.fn(), addToast: vi.fn(), impersonateUser: null, impersonateGroups: [], setImpersonation: vi.fn(), clearImpersonation: vi.fn() }) }));
vi.mock('../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../../engine/query', () => ({ k8sList: vi.fn().mockResolvedValue([]), k8sGet: vi.fn().mockResolvedValue(null), k8sDelete: vi.fn().mockResolvedValue({}) }));
import IdentityView from '../IdentityView';

const selected = (name: RegExp) => screen.getByRole('tab', { name }).getAttribute('aria-selected');

describe('IdentityView tab in the URL', () => {
  afterEach(cleanup);

  it('opens RBAC from a deep link', () => {
    renderRouted(<IdentityView />, '/identity?tab=rbac');
    expect(selected(/^RBAC$/)).toBe('true');
  });

  it('switches on a same-page ?tab= link and on Back', async () => {
    const page = renderRouted(<IdentityView />, '/identity');
    expect(selected(/^Users$/)).toBe('true');
    await page.go('/identity?tab=rbac');
    expect(selected(/^RBAC$/)).toBe('true');
    await page.back();
    expect(selected(/^Users$/)).toBe('true');
  });

  it('a tab click writes ?tab= through the router', () => {
    const page = renderRouted(<IdentityView />, '/identity');
    fireEvent.click(screen.getByRole('tab', { name: /Groups & Service Accounts/ }));
    expect(page.url()).toBe('/identity?tab=groups-sa');
  });

  it('an old ?tab=impersonation link opens Users and is removed from the URL', () => {
    const page = renderRouted(<IdentityView />, '/identity?tab=impersonation');
    expect(selected(/^Users$/)).toBe('true');
    expect(page.url()).toBe('/identity');
  });
});
