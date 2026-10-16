// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MetricCard } from '../../metrics/Sparkline';
import { AttentionProvider, AttentionStrip } from '../attention';

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Answer each query with its own series so cards differ.
function serveQueries(byQuery: Record<string, string[]>) {
  mockFetch.mockImplementation((url: string) => {
    const query = new URL(url, 'http://x').searchParams.get('query') || '';
    const values = (byQuery[query] || []).map((v, i) => [1000 + i * 60, v]);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'success', data: { resultType: 'matrix', result: values.length ? [{ metric: {}, values }] : [] } }),
    });
  });
}

function renderDashboard(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AttentionProvider>
        <AttentionStrip />
        {ui}
      </AttentionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => mockFetch.mockReset());
afterEach(() => cleanup());

describe('AttentionStrip', () => {
  it('lists live cards past their thresholds, critical first', async () => {
    serveQueries({ cpu: ['80', '85'], restarts: ['0.002', '0.003'], nodes: ['4', '4'] });
    const { findByRole } = renderDashboard(
      <>
        <MetricCard title="Cluster CPU" query="cpu" unit="%" thresholds={{ warning: 70, critical: 90 }} />
        <MetricCard title="Restart Rate" query="restarts" unit="" thresholds={{ warning: 0.00028, critical: 0.00167 }} />
        <MetricCard title="Nodes Ready" query="nodes" unit="" thresholds={{ warning: 2, critical: 1 }} />
      </>,
    );

    const strip = await findByRole('status');
    await waitFor(() => expect(strip.textContent).toContain('Cluster CPU'));
    expect(strip.textContent).toContain('Needs attention');
    expect(strip.textContent).toContain('Restart Rate');
    expect(strip.textContent).not.toContain('Nodes Ready'); // healthy: 4 ready is above the lower-is-worse warning
    expect(strip.textContent!.indexOf('Restart Rate')).toBeLessThan(strip.textContent!.indexOf('Cluster CPU'));
    expect(strip.getAttribute('aria-label')).toBe('2 items need attention');
  });

  it('renders nothing when no live card is past a threshold, and never claims all is healthy', async () => {
    serveQueries({ cpu: ['20', '25'] });
    const { queryByRole, findByText } = renderDashboard(
      <MetricCard title="Cluster CPU" query="cpu" unit="%" thresholds={{ warning: 70, critical: 90 }} />,
    );
    await findByText('25%');
    expect(queryByRole('status')).toBeNull();
  });

  it('drops a card that leaves the dashboard', async () => {
    serveQueries({ cpu: ['95', '96'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (show: boolean) => (
      <QueryClientProvider client={qc}>
        <AttentionProvider>
          <AttentionStrip />
          {show && <MetricCard title="Cluster CPU" query="cpu" unit="%" thresholds={{ warning: 70, critical: 90 }} />}
        </AttentionProvider>
      </QueryClientProvider>
    );
    const { findByRole, queryByRole, rerender } = render(tree(true));
    expect((await findByRole('status')).textContent).toContain('Cluster CPU');
    rerender(tree(false));
    await waitFor(() => expect(queryByRole('status')).toBeNull());
  });

  it('cards outside a dashboard render without a provider', async () => {
    serveQueries({ cpu: ['95', '96'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { findByText } = render(
      <QueryClientProvider client={qc}>
        <MetricCard title="Cluster CPU" query="cpu" unit="%" thresholds={{ warning: 70, critical: 90 }} />
      </QueryClientProvider>,
    );
    expect(await findByText('96%')).toBeTruthy();
  });
});
