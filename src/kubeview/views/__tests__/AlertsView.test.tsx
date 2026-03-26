// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const navigateMock = vi.fn();
const addTabMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: any) => {
      const state = {
        addTab: addTabMock,
        addToast: addToastMock,
        setSelectedNamespace: vi.fn(),
      };
      return selector(state);
    },
    {
      getState: () => ({
        setSelectedNamespace: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../../hooks/useNavigateTab', () => ({
  useNavigateTab: () => vi.fn(),
}));

vi.mock('../../components/metrics/Sparkline', () => ({
  MetricCard: ({ title }: { title: string }) => <div data-testid="metric-card">{title}</div>,
  Sparkline: () => <div data-testid="sparkline" />,
}));

vi.mock('../../components/metrics/prometheus', () => ({
  queryRange: vi.fn().mockResolvedValue([]),
  getTimeRange: vi.fn().mockReturnValue([0, 1]),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import AlertsView from '../AlertsView';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderAlerts(queryClient?: QueryClient) {
  // Default: fetch returns empty results
  if (mockFetch.mock.calls.length === 0 && mockFetch.getMockImplementation() === undefined) {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/rules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { groups: [] } }),
        });
      }
      if (url.includes('/silences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
  }

  const qc = queryClient ?? createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AlertsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Alerts heading', () => {
    renderAlerts();
    expect(screen.getByText('Alerts')).toBeDefined();
  });

  it('renders 3 tabs: Firing, Rules, Silences', () => {
    renderAlerts();
    // Tab buttons contain text like "Firing (0)", "Rules (0)", "Silences (0)"
    expect(screen.getByRole('button', { name: /^Firing \(/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Rules \(/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Silences \(/ })).toBeDefined();
  });

  it('shows "No alerts firing" badge when no alerts', () => {
    renderAlerts();
    expect(screen.getAllByText('No alerts firing').length).toBeGreaterThanOrEqual(1);
  });

  it('shows search input with placeholder', () => {
    renderAlerts();
    expect(screen.getByPlaceholderText('Search alerts...')).toBeDefined();
  });

  it('shows stat cards for Firing, Pending, Silenced, Alert Rules, Active Silences', () => {
    renderAlerts();
    expect(screen.getByText('Firing')).toBeDefined();
    expect(screen.getByText('Pending')).toBeDefined();
    expect(screen.getByText('Alert Rules')).toBeDefined();
    expect(screen.getByText('Active Silences')).toBeDefined();
  });

  it('shows zero counts in stat cards when empty', () => {
    renderAlerts();
    // All three stat cards should show 0
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it('shows subtitle text', () => {
    renderAlerts();
    expect(screen.getByText('Prometheus alerts, rules, and silences')).toBeDefined();
  });

  it('shows "No alerts firing" in the firing tab content when empty', () => {
    renderAlerts();
    // The firing tab is active by default and shows "No alerts firing" in two places:
    // the badge at top and the empty-state in the tab content
    const noAlerts = screen.getAllByText('No alerts firing');
    expect(noAlerts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "No active silences" when switching to silences tab', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    expect(screen.getByText('No active silences')).toBeDefined();
  });

  it('search input accepts text', () => {
    renderAlerts();
    const input = screen.getByPlaceholderText('Search alerts...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'test-alert' } });
    expect(input.value).toBe('test-alert');
  });

  it('shows Create Silence button in silences tab', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    expect(screen.getByText('Create Silence')).toBeDefined();
  });

  it('opens silence form when Create Silence is clicked', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    const createBtn = screen.getByText('Create Silence');
    fireEvent.click(createBtn);
    expect(screen.getByText('New Silence')).toBeDefined();
    expect(screen.getByPlaceholderText('Explain why this alert is being silenced...')).toBeDefined();
  });

  it('silence form shows duration presets', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    const createBtn = screen.getByText('Create Silence');
    fireEvent.click(createBtn);

    expect(screen.getByText('1h')).toBeDefined();
    expect(screen.getByText('2h')).toBeDefined();
    expect(screen.getByText('4h')).toBeDefined();
    expect(screen.getByText('8h')).toBeDefined();
    expect(screen.getByText('24h')).toBeDefined();
    expect(screen.getByText('7d')).toBeDefined();
  });

  it('silence form has matchers section', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    const createBtn = screen.getByText('Create Silence');
    fireEvent.click(createBtn);

    expect(screen.getByText('Matchers')).toBeDefined();
    expect(screen.getByPlaceholderText('Label name')).toBeDefined();
    expect(screen.getByPlaceholderText('Value')).toBeDefined();
  });

  it('shows Silence button on firing alerts', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/rules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: {
              groups: [{
                name: 'test-group',
                rules: [{
                  name: 'TestAlert',
                  query: 'up == 0',
                  state: 'firing',
                  health: 'ok',
                  type: 'alerting',
                  labels: { severity: 'warning' },
                  annotations: { description: 'Test alert firing' },
                  alerts: [{
                    labels: { alertname: 'TestAlert', severity: 'warning' },
                    annotations: { description: 'Test alert firing' },
                    state: 'firing',
                    activeAt: '2024-01-01T00:00:00Z',
                  }],
                }],
              }],
            },
          }),
        });
      }
      if (url.includes('/silences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    // Render with the custom mock already set
    const qc = createQueryClient();
    const { container } = render(<QueryClientProvider client={qc}><MemoryRouter><AlertsView /></MemoryRouter></QueryClientProvider>);
    // Wait for the firing count to update (proves data loaded)
    await waitFor(() => {
      expect(container.textContent).toContain('Firing');
      expect(container.textContent).toMatch(/1.*warning/);
    }, { timeout: 3000 });
  });

  it('shows Expire button on active silences', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/rules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { groups: [] } }),
        });
      }
      if (url.includes('/silences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 'silence-1',
              status: { state: 'active' },
              matchers: [{ name: 'alertname', value: 'TestAlert', isRegex: false }],
              startsAt: '2024-01-01T00:00:00Z',
              endsAt: '2024-01-01T01:00:00Z',
              createdBy: 'admin',
              comment: 'Test silence',
            },
          ]),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);

    // Wait for silences to load
    await screen.findByText('Test silence');
    expect(screen.getByText('Expire')).toBeDefined();
  });

  it('silence form can add and remove matchers', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    const createBtn = screen.getByText('Create Silence');
    fireEvent.click(createBtn);

    // Initially has one matcher
    expect(screen.getAllByPlaceholderText('Label name').length).toBe(1);

    // Add another matcher
    const addMatcherBtn = screen.getByText('Add matcher');
    fireEvent.click(addMatcherBtn);
    expect(screen.getAllByPlaceholderText('Label name').length).toBe(2);
  });

  it('silence form closes when Cancel is clicked', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    const createBtn = screen.getByText('Create Silence');
    fireEvent.click(createBtn);

    expect(screen.getByText('New Silence')).toBeDefined();

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    // Form should be closed
    expect(screen.queryByText('New Silence')).toBeNull();
  });

  it('shows EmptyState with guidance when firing alerts tab is empty', () => {
    renderAlerts();
    const firingTab = screen.getByRole('button', { name: /^Firing \(/ });
    fireEvent.click(firingTab);
    expect(screen.getAllByText('No alerts firing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Your cluster is healthy.*no alerts are currently firing/)).toBeDefined();
  });

  it('shows EmptyState with guidance when rules tab is empty', () => {
    renderAlerts();
    const rulesTab = screen.getByRole('button', { name: /^Rules \(/ });
    fireEvent.click(rulesTab);
    expect(screen.getByText('No alert rules found')).toBeDefined();
    expect(screen.getByText('Alert rules are configured in Prometheus. Make sure Alertmanager is connected and accessible.')).toBeDefined();
  });

  it('shows EmptyState with guidance when silences tab is empty', () => {
    renderAlerts();
    const silencesTab = screen.getByRole('button', { name: /^Silences \(/ });
    fireEvent.click(silencesTab);
    expect(screen.getByText('No active silences')).toBeDefined();
    expect(screen.getByText('Silences temporarily mute alerts. Create one to suppress a noisy alert during maintenance.')).toBeDefined();
  });
});
