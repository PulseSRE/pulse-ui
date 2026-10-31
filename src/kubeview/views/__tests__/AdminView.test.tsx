// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mocks must be declared before imports that use them

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      addTab: addTabMock,
      addToast: addToastMock,
      setSelectedNamespace: vi.fn(),
      setLastSyncTime: vi.fn(),
      removeDegradedReason: vi.fn(),
    };
    return selector(state);
  },
}));

// Mock the query module so no real fetch calls happen
vi.mock('../../engine/query', () => ({
  k8sList: vi.fn().mockResolvedValue([]),
  k8sGet: vi.fn().mockResolvedValue(null),
  k8sPatch: vi.fn().mockResolvedValue({}),
}));

// Mock the ClusterConfig sub-component to keep tests focused
vi.mock('../../components/ClusterConfig', () => ({
  default: () => <div data-testid="cluster-config">ClusterConfig</div>,
}));

import AdminView from '../AdminView';
import { k8sGet, k8sList } from '../../engine/query';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderAdmin(queryClient?: QueryClient) {
  const qc = queryClient ?? createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders admin tabs', () => {
    renderAdmin();
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Cluster Config')).toBeDefined();
    expect(screen.getByText(/^Updates/)).toBeDefined();
    expect(screen.getByText(/^Snapshots/)).toBeDefined();
    expect(screen.getAllByText(/Quotas/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Certificates')).toBeDefined();
    expect(screen.getByText(/^Operators/)).toBeDefined();
  });

  it('renders the Administration heading', () => {
    renderAdmin();
    expect(screen.getByText('Administration')).toBeDefined();
  });

  it('shows cluster version info card on overview', () => {
    renderAdmin();
    // Overview is the default tab and should show these info cards
    expect(screen.getByText('Cluster Version')).toBeDefined();
  });

  it('shows platform info card on overview', () => {
    renderAdmin();
    expect(screen.getByText('Platform')).toBeDefined();
  });

  it('shows nodes once, in the Nodes panel (no separate Nodes info card)', () => {
    renderAdmin();
    expect(screen.getAllByText(/^Nodes \(\d+\)$/)).toHaveLength(1);
    expect(screen.queryByText('Nodes')).toBeNull();
  });

  it('shows CRDs info card on overview', () => {
    renderAdmin();
    expect(screen.getAllByText('CRDs').length).toBeGreaterThanOrEqual(1);
    // The tab label carries no count; the card does.
    expect(screen.queryByRole('tab', { name: /CRDs \(/ })).toBeNull();
  });

  it('shows control plane panel on overview', () => {
    renderAdmin();
    expect(screen.getAllByText('Control Plane').length).toBeGreaterThanOrEqual(1);
  });

  it('shows identity providers panel on overview', () => {
    renderAdmin();
    expect(screen.getByText('Identity Providers')).toBeDefined();
  });

  it('shows cluster capacity panel on overview', () => {
    renderAdmin();
    expect(screen.getByText('Cluster Capacity')).toBeDefined();
  });

  it('shows Capture Snapshot button on snapshots tab', () => {
    renderAdmin();
    const snapshotsTab = screen.getByRole('tab', { name: /^Snapshots/ });
    fireEvent.click(snapshotsTab);
    expect(screen.getByText('Capture Snapshot')).toBeDefined();
  });

  it('shows No Snapshots Yet message on snapshots tab when none exist', () => {
    renderAdmin();
    const snapshotsTab = screen.getByRole('tab', { name: /^Snapshots/ });
    fireEvent.click(snapshotsTab);
    expect(screen.getByText('No Snapshots Yet')).toBeDefined();
  });

  it('shows Import button on snapshots tab', () => {
    renderAdmin();
    const snapshotsTab = screen.getByRole('tab', { name: /^Snapshots/ });
    fireEvent.click(snapshotsTab);
    expect(screen.getByText('Import')).toBeDefined();
  });

  it('shows quotas panels when switching to quotas tab', () => {
    renderAdmin();
    const quotasTabs = screen.getAllByRole('tab', { name: /Quotas/ });
    fireEvent.click(quotasTabs[0]);
    expect(screen.getAllByText(/Resource Quotas/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Limit Ranges/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows ClusterConfig component on config tab', () => {
    renderAdmin();
    const configTab = screen.getByRole('tab', { name: /Cluster Config/ });
    fireEvent.click(configTab);
    expect(screen.getByTestId('cluster-config')).toBeDefined();
  });

  it('renders overview tab without crashing', () => {
    // Verifies the component mounts and renders the Overview tab header
    const { container } = renderAdmin();
    expect(container.querySelector('.bg-slate-950')).toBeDefined();
  });

  it('reads expiry from the certificate itself — no "creation + 780 days" guesses — and parses the router cert', async () => {
    const { waitFor } = await import('@testing-library/react');
    // A service-ca secret created ~760 days ago with no readable tls.crt used to
    // be reported as expiring in ~20 days. Now its expiry is unknown, and a
    // secret whose certificate really has expired is reported.
    const created = new Date(Date.now() - 760 * 86400000).toISOString();
    vi.mocked(k8sList).mockImplementation(async (path: string) => {
      if (path.includes('kubernetes.io/tls')) {
        return [
          { type: 'kubernetes.io/tls', metadata: { name: 'guessed', namespace: 'ns', creationTimestamp: created, annotations: { 'service.beta.openshift.io/originating-service-name': 'svc' } }, data: {} },
          { type: 'kubernetes.io/tls', metadata: { name: 'really-expired', namespace: 'ns', creationTimestamp: created }, data: { 'tls.crt': 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJXRENCL3FBREFnRUNBaFF1ZEVuQ3RKSkFIUXc1KzNpb0oyeXkvd1pvdVRBS0JnZ3Foa2pPUFFRREFqQVMKTVJBd0RnWURWUVFEREFkbGVIQnBjbVZrTUI0WERUSTBNREV3TVRBd01EQXdNRm9YRFRJME1ESXdNVEF3TURBdwpNRm93RWpFUU1BNEdBMVVFQXd3SFpYaHdhWEpsWkRCWk1CTUdCeXFHU000OUFnRUdDQ3FHU000OUF3RUhBMElBCkJNK2gveFZoZXNxaWxJa3JoYit1OC9JVmJTdkhuWEsyelE1UStJOHl0QndxS2Y1OFE2SGZySTRyVjJaSTF0TFQKQkN0OE5LbEJtbHBsbmVSaWxicCt2aXFqTWpBd01CMEdBMVVkRGdRV0JCUTRpUGM3aDE1M3ZXcGlYTUR1cWI5eQorNjBLanpBUEJnTlZIUk1CQWY4RUJUQURBUUgvTUFvR0NDcUdTTTQ5QkFNQ0Ewa0FNRVlDSVFEeFpqOC9paGFNCjVCdG5OOEFlWkc4eDNnUXlzdkQxbEhySFFJSHY3bnpvRHdJaEFLTlJpaGJWYldTeVZGZnpldTVOV0FRTmpaRC8KNnNoUFZ2bWRIWWF1RmxOZQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==' } },
        ] as never;
      }
      return [] as never;
    });
    vi.mocked(k8sGet).mockImplementation(async (path: string) => {
      if (path.includes('router-certs-default')) return { metadata: { name: 'router-certs-default' }, data: { 'tls.crt': 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJWRENCL0tBREFnRUNBaFJVL090N2dPT2dNQXJyQ0ZWWUJTakh0WjlBMlRBS0JnZ3Foa2pPUFFRREFqQVIKTVE4d0RRWURWUVFEREFabWRYUjFjbVV3SGhjTk1qWXhNRE14TURJME5URTNXaGNOTXpZeE1ESTRNREkwTlRFMwpXakFSTVE4d0RRWURWUVFEREFabWRYUjFjbVV3V1RBVEJnY3Foa2pPUFFJQkJnZ3Foa2pPUFFNQkJ3TkNBQVNiClZYYmU5Z1RxRmdNbUhwNmRicnZuRlNMUDdNQ1hLemJKYTErSFBNR2x4OHA1MzAvWWo2VkN1d1JSdyszaXBPMzAKOE1RaTdnaER2RmFabUxiOFFpMEJvekl3TURBZEJnTlZIUTRFRmdRVThvSjhyWVBLM3M4M3J6VDBGU0kxRmpQYQoybVl3RHdZRFZSMFRBUUgvQkFVd0F3RUIvekFLQmdncWhrak9QUVFEQWdOSEFEQkVBaUJkTkF2UlFFUlRiY09pCmJyV2h2UGdjWlBBRGVYdnVTdHI5WGsxUW43UlZLQUlnRkhZa2xWeDBhL3pkdXk4cVJnb2dNMGUvaDQ3N1kxN2wKYko1eExoK1g2UFk9Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K' } } as never;
      return null as never;
    });
    renderAdmin();
    await waitFor(() => expect(screen.getByText(/1 cert expiring within 30 days/)).toBeDefined());
    expect(screen.getByText('really-expired', { exact: false })).toBeDefined();
    expect(screen.queryByText('guessed', { exact: false })).toBeNull();
    await waitFor(() => expect(screen.getByText('Router Cert Expires')).toBeDefined());
  });

  it('counts an operator that is both degraded and progressing once', async () => {
    const { waitFor } = await import('@testing-library/react');
    const cond = (type: string, status: string) => ({ type, status });
    vi.mocked(k8sList).mockImplementation(async (path: string) => {
      if (path.includes('clusteroperators')) {
        return [
          { metadata: { name: 'both', uid: 'a' }, status: { conditions: [cond('Degraded', 'True'), cond('Progressing', 'True')] } },
          { metadata: { name: 'fine', uid: 'b' }, status: { conditions: [cond('Available', 'True'), cond('Degraded', 'False'), cond('Progressing', 'False')] } },
        ] as never;
      }
      return [] as never;
    });
    vi.mocked(k8sGet).mockResolvedValue(null as never);
    renderAdmin();
    await waitFor(() => {
      const card = screen.getByText('Cluster Operators').parentElement!;
      expect(card.textContent).toContain('1/2');
    });
  });
});
