// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const navigateMock = vi.fn();
const addTabMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      addTab: addTabMock,
      addToast: vi.fn(),
      impersonateUser: '',
      impersonateGroups: [],
    };
    return selector(state);
  },
}));

const k8sListMock = vi.fn();

vi.mock('../../engine/query', () => ({
  k8sList: (...args: any[]) => k8sListMock(...args),
}));

import { CertificatesTab } from '../admin/CertificatesTab';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

const goMock = vi.fn();

function renderTab(qc?: QueryClient) {
  const queryClient = qc ?? createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CertificatesTab go={goMock} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Helper to make a TLS secret fixture
function makeTlsSecret(overrides: {
  name: string;
  namespace?: string;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
  hasCert?: boolean;
}) {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'kubernetes.io/tls',
    metadata: {
      name: overrides.name,
      namespace: overrides.namespace || 'my-app',
      uid: `uid-${overrides.name}`,
      creationTimestamp: overrides.creationTimestamp || '2025-01-15T00:00:00Z',
      annotations: overrides.annotations || {},
    },
    data: overrides.hasCert ? { 'tls.crt': '' } : {},
  };
}

describe('CertificatesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    k8sListMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading state initially', () => {
    k8sListMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderTab();
    expect(screen.getByText('Loading TLS certificates...')).toBeDefined();
  });

  it('shows error state on fetch failure', async () => {
    k8sListMock.mockRejectedValue(new Error('forbidden'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Failed to load certificates')).toBeDefined());
    expect(screen.getByText('forbidden')).toBeDefined();
  });

  it('renders summary cards with correct counts', async () => {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 86400000).toISOString();
    const inFifteenDays = new Date(now.getTime() + 15 * 86400000).toISOString();
    const inSixtyDays = new Date(now.getTime() + 60 * 86400000).toISOString();

    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'critical-cert', annotations: { 'cert-manager.io/certificate-expiry': inThreeDays } }),
      makeTlsSecret({ name: 'warning-cert', annotations: { 'cert-manager.io/certificate-expiry': inFifteenDays } }),
      makeTlsSecret({ name: 'healthy-cert', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('Total Certificates')).toBeDefined());

    // Summary values
    expect(screen.getByText('3')).toBeDefined(); // total
    expect(screen.getByText('1', { selector: '.text-red-400' })).toBeDefined(); // critical
    expect(screen.getByText('1', { selector: '.text-yellow-400' })).toBeDefined(); // warning
  });

  it('renders certificate rows in the table', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({
        name: 'my-tls-secret',
        namespace: 'production',
        annotations: {
          'cert-manager.io/certificate-expiry': inSixtyDays,
          'cert-manager.io/common-name': 'app.example.com',
          'cert-manager.io/issuer-name': 'letsencrypt',
        },
      }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('my-tls-secret')).toBeDefined());

    expect(screen.getByText('production')).toBeDefined();
    expect(screen.getByText('app.example.com')).toBeDefined();
    expect(screen.getByText('cert-manager')).toBeDefined();
  });

  it('navigates to secret detail on click', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({
        name: 'click-me',
        namespace: 'default',
        annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays },
      }),
    ]);

    renderTab();
    // default namespace is system, need showSystem
    await waitFor(() => expect(screen.getByText('Total Certificates')).toBeDefined());

    // Show system certs to see the 'default' namespace cert
    const showBtn = screen.getByText(/System certs/);
    fireEvent.click(showBtn);
    await waitFor(() => expect(screen.getByText('click-me')).toBeDefined());

    fireEvent.click(screen.getByText('click-me'));
    expect(goMock).toHaveBeenCalledWith('/r/v1~secrets/default/click-me', 'click-me');
  });

  it('filters out system namespaces by default', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'user-cert', namespace: 'my-app', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
      makeTlsSecret({ name: 'system-cert', namespace: 'openshift-ingress', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('user-cert')).toBeDefined());
    expect(screen.queryByText('system-cert')).toBeNull();
  });

  it('shows system certs when toggle is clicked', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'system-cert', namespace: 'openshift-ingress', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('Total Certificates')).toBeDefined());

    const showBtn = screen.getByText(/System certs/);
    fireEvent.click(showBtn);
    await waitFor(() => expect(screen.getByText('system-cert')).toBeDefined());
  });

  it('filters by search text', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'alpha-cert', namespace: 'ns1', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
      makeTlsSecret({ name: 'beta-cert', namespace: 'ns2', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('alpha-cert')).toBeDefined());

    const input = screen.getByPlaceholderText(/Search name/);
    fireEvent.change(input, { target: { value: 'beta' } });

    expect(screen.queryByText('alpha-cert')).toBeNull();
    expect(screen.getByText('beta-cert')).toBeDefined();
  });

  it('filters by status when clicking summary cards', async () => {
    const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString();
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();

    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'crit', namespace: 'ns1', annotations: { 'cert-manager.io/certificate-expiry': inThreeDays } }),
      makeTlsSecret({ name: 'ok', namespace: 'ns2', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('crit')).toBeDefined());

    // Click the Critical card
    const critCard = screen.getByText('Critical (< 7d)').closest('button')!;
    fireEvent.click(critCard);

    expect(screen.getByText('crit')).toBeDefined();
    expect(screen.queryByText('ok')).toBeNull();
  });

  it('detects service-ca issuer from annotations', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({
        name: 'svc-ca-cert',
        namespace: 'my-app',
        annotations: {
          'service.beta.openshift.io/expiry': inSixtyDays,
        },
      }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('svc-ca-cert')).toBeDefined());
    expect(screen.getByText('service-ca')).toBeDefined();
  });

  it('detects platform issuer for openshift- namespaces', async () => {
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'platform-cert', namespace: 'openshift-monitoring' }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('Total Certificates')).toBeDefined());

    // Need to show system certs
    fireEvent.click(screen.getByText(/System certs/));
    await waitFor(() => expect(screen.getByText('platform-cert')).toBeDefined());
    expect(screen.getByText('platform')).toBeDefined();
  });

  it('shows manual issuer for unrecognized secrets', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({
        name: 'manual-cert',
        namespace: 'custom-ns',
        annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays },
      }),
    ]);

    // cert-manager annotation but no issuer-name → still gets cert-manager issuer
    // Let's test a truly manual one with no annotations
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'manual-cert', namespace: 'custom-ns' }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('manual-cert')).toBeDefined());
    expect(screen.getByText('manual')).toBeDefined();
  });

  it('shows empty state when no certs match filters', async () => {
    k8sListMock.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText('No certificates match the current filters')).toBeDefined());
  });

  it('clears status filter with Clear filter button', async () => {
    const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString();
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();

    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'crit', namespace: 'ns1', annotations: { 'cert-manager.io/certificate-expiry': inThreeDays } }),
      makeTlsSecret({ name: 'ok', namespace: 'ns2', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('crit')).toBeDefined());

    // Filter to critical only
    const critCard = screen.getByText('Critical (< 7d)').closest('button')!;
    fireEvent.click(critCard);
    expect(screen.queryByText('ok')).toBeNull();

    // Clear filter
    fireEvent.click(screen.getByText('Clear filter'));
    expect(screen.getByText('ok')).toBeDefined();
    expect(screen.getByText('crit')).toBeDefined();
  });

  it('sorts by name when clicking the Name column header', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'zebra-cert', namespace: 'ns1', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
      makeTlsSecret({ name: 'alpha-cert', namespace: 'ns2', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('zebra-cert')).toBeDefined());

    // Click Name header to sort by name
    fireEvent.click(screen.getByText('Name'));

    const rows = screen.getAllByRole('row');
    // First data row (index 1, index 0 is header) should be alpha
    const cellTexts = rows.slice(1).map(r => r.querySelector('.text-blue-400')?.textContent);
    expect(cellTexts[0]).toBe('alpha-cert');
    expect(cellTexts[1]).toBe('zebra-cert');
  });

  it('calls k8sList with fieldSelector for TLS secrets', async () => {
    k8sListMock.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(k8sListMock).toHaveBeenCalledWith('/api/v1/secrets?fieldSelector=type=kubernetes.io/tls', undefined, 'local'));
  });

  it('uses cert-manager expiry annotation when available', async () => {
    const expiry = new Date(Date.now() + 5.5 * 86400000); // ~5 days out
    k8sListMock.mockResolvedValue([
      makeTlsSecret({
        name: 'cm-cert',
        namespace: 'my-ns',
        annotations: { 'cert-manager.io/certificate-expiry': expiry.toISOString() },
      }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('cm-cert')).toBeDefined());
    expect(screen.getByText(/in \d+ days/)).toBeDefined();
  });

  it('shows issuer breakdown in total card', async () => {
    const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString();
    k8sListMock.mockResolvedValue([
      makeTlsSecret({ name: 'a', namespace: 'ns1', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays, 'cert-manager.io/issuer-name': 'le' } }),
      makeTlsSecret({ name: 'b', namespace: 'ns2', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays, 'cert-manager.io/issuer-name': 'le' } }),
      makeTlsSecret({ name: 'c', namespace: 'ns3', annotations: { 'cert-manager.io/certificate-expiry': inSixtyDays } }),
    ]);

    renderTab();
    await waitFor(() => expect(screen.getByText('Total Certificates')).toBeDefined());
    // Should show issuer counts like "2 cert-manager, 1 manual"
    expect(screen.getByText(/2 cert-manager/)).toBeDefined();
    expect(screen.getByText(/1 manual/)).toBeDefined();
  });
});
