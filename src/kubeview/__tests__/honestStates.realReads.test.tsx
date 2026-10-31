// @vitest-environment jsdom
/**
 * Pages with their reads really failing: the real useK8sListWatch and
 * k8sList run against a fetch that answers 403 (only the watch socket is
 * stubbed), so every list arrives as an error, not as an empty array.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));

import { mockFetchRoutes, renderWithClient, renderWithFailedRequests, expectNoAllClear } from './helpers/honestStates';
import SecurityView from '../views/SecurityView';
import ProjectDashboard from '../views/ProjectDashboard';
import StorageView from '../views/StorageView';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function auditRow(label: string) {
  return screen.getByText(label).closest('div.px-4') as HTMLElement;
}
function summary(label: string) {
  return screen.getByText(label).closest('div')!.parentElement as HTMLElement;
}

describe('SecurityView with every read forbidden', () => {
  it('shows unknown checks and "—" counts, never removed/Intermediate/0', async () => {
    renderWithFailedRequests(<SecurityView />, { status: 403 });
    await waitFor(() => expect(auditRow('kubeadmin user removed').textContent).toMatch(/Could not read kube-system\/kubeadmin: Permission denied \(403\)/));
    await waitFor(() => expect(auditRow('TLS security profile').textContent).toMatch(/Unknown — Permission denied \(403\)/));
    await waitFor(() => expect(screen.getByText('ClusterRoleBindings could not be read')).toBeTruthy());
    expect(auditRow('Network policies in user namespaces').textContent).toMatch(/Could not read namespaces or network policies/);
    expect(summary('Cluster Admins').textContent).toContain('—');
    expect(summary('Cluster Admins').textContent).not.toMatch(/none/);
    expect(screen.getByText('Network policies could not be read')).toBeTruthy();
    expect(summary('Network Policies').textContent).not.toMatch(/\b0\b/);
    expect(screen.getByText('Secrets could not be read')).toBeTruthy();
    // SCCs: a LoadError, not "Security Context Constraints (0) · 0 privileged"
    await waitFor(() => expect(screen.getByText('Security Context Constraints could not be loaded')).toBeTruthy());
    expect(screen.queryByText(/Security Context Constraints \(0\)/)).toBeNull();
    expect(screen.getByText('ClusterRoleBindings could not be loaded')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/kubeadmin has been removed|TLS profile: Intermediate|No non-system cluster-admin bindings/);
    expect(screen.queryAllByLabelText('Checking')).toHaveLength(0);
    expectNoAllClear();
  });

  it('shows "Checking…" — not a pass or a fail — while reads are in flight', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWithClient(<SecurityView />);
    for (const label of ['Identity Provider configured', 'kubeadmin user removed', 'TLS security profile', `Cluster-admin access limited (≤3)`, 'Network policies in user namespaces']) {
      expect(auditRow(label).textContent, label).toContain('Checking…');
      expect(auditRow(label).querySelector('[aria-label="Checking"]'), label).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/No identity provider configured|No non-system cluster-admin|All 0 user namespaces/);
    expect(summary('Cluster Admins').textContent).toContain('—');
  });

  it('checks the kube-system/kubeadmin secret, not User objects, and drops always-passing checks', async () => {
    mockFetchRoutes({
      '/secrets/kubeadmin': { body: { metadata: { name: 'kubeadmin' } } },
      'apiservers/cluster': { body: { spec: {} } },
      '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings': { body: { items: [] } },
      '/apis/security.openshift.io/v1/securitycontextconstraints': { body: { items: [{ metadata: { name: 'privileged' }, allowPrivilegedContainer: true }] } },
    }, 404);
    renderWithClient(<SecurityView />);
    await waitFor(() => expect(auditRow('kubeadmin user removed').textContent).toMatch(/kubeadmin still exists/));
    await waitFor(() => expect(auditRow('TLS security profile').textContent).toMatch(/TLS profile: Intermediate/));
    await waitFor(() => expect(screen.getByText('Security Context Constraints (1)')).toBeTruthy());
    await waitFor(() => expect(summary('Cluster Admins').textContent).toMatch(/0\s*none/));
    expect(screen.queryByText('Privileged SCCs tracked')).toBeNull();
    expect(screen.queryByText('TLS certificates managed')).toBeNull();
  });
});

describe('ProjectDashboard with its lists forbidden', () => {
  it('shows "—" and load errors, not 0 Pods / 0 Events', async () => {
    renderWithFailedRequests(
      <Routes><Route path="/project/:namespace" element={<ProjectDashboard />} /></Routes>,
      { status: 403, route: '/project/shop' },
    );
    await waitFor(() => expect(screen.getByText('Pods could not be loaded')).toBeTruthy());
    expect(screen.getByText('Deployments could not be loaded')).toBeTruthy();
    expect(screen.getByText('Events could not be loaded')).toBeTruthy();
    for (const label of ['Pods', 'Deployments', 'Events']) {
      // The summary tile is the rounded card that holds the label.
      const card = screen.getAllByText(label).find((el) => el.className.includes('text-xs'))!.closest('.rounded-lg')!;
      expect(card.textContent, label).toContain('—');
      expect(card.textContent, label).not.toMatch(/\b0\b/);
    }
    expect(screen.getByText('Pods (—)')).toBeTruthy();
  });
});

describe('StorageView with PVC/PV lists forbidden', () => {
  it('shows "—" for PVCs, PVs and capacity, and skips the PVC audit checks', async () => {
    mockFetchRoutes({ '/apis/storage.k8s.io/v1/storageclasses': { body: { items: [{ metadata: { name: 'gp3', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }, provisioner: 'ebs' }] } } }, 403);
    renderWithClient(<StorageView />);
    await waitFor(() => expect(screen.getByText('PersistentVolumeClaims and PersistentVolumes could not be loaded')).toBeTruthy());
    const card = (label: string) => screen.getByText(label).parentElement!;
    expect(card('PVCs').textContent).toContain('—');
    expect(card('Persistent Volumes').textContent).toContain('—');
    expect(card('Total Capacity').textContent).toContain('—');
    expect(card('Total Capacity').textContent).toContain('requested unknown');
    await waitFor(() => expect(screen.getByText('Default StorageClass')).toBeTruthy());
    expect(screen.queryByText('PVC Binding Status')).toBeNull();
    expect(screen.queryByText('Storage Resource Quotas')).toBeNull();
  });
});
