// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach } from 'vitest';
import { Sparkline, MetricCard } from '../Sparkline';

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});
afterEach(() => {
  cleanup();
});

function mockRangeResponse(values: [number, string][]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      status: 'success',
      data: { resultType: 'matrix', result: [{ metric: {}, values }] },
    }),
  });
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Regression: Prometheus can legitimately return "NaN"/"+Inf"/"-Inf" string
// samples (e.g. a rate() or division query with no data at that instant).
// A single one anywhere in the series used to poison Math.min/Math.max for
// the whole array, producing an SVG <path> with a "NaN" d attribute
// ("M2,NaN L2.98,NaN ...") that the browser rejects outright.
describe('Sparkline', () => {
  it('never renders a NaN in the path d attribute when a sample is "NaN"', async () => {
    mockRangeResponse([
      [1000, '10'], [1060, 'NaN'], [1120, '20'], [1180, '15'], [1240, '25'],
    ]);

    const { container } = renderWithClient(<Sparkline query="up" />);

    await waitFor(() => {
      expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
    });

    const paths = container.querySelectorAll('path');
    paths.forEach((p) => {
      const d = p.getAttribute('d');
      expect(d).not.toBeNull();
      expect(d).not.toContain('NaN');
    });
  });

  it('never renders a NaN in the path d attribute when a sample is "+Inf"', async () => {
    mockRangeResponse([
      [1000, '10'], [1060, '+Inf'], [1120, '20'], [1180, '-Inf'], [1240, '25'],
    ]);

    const { container } = renderWithClient(<Sparkline query="up" />);

    await waitFor(() => {
      expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
    });

    container.querySelectorAll('path').forEach((p) => {
      expect(p.getAttribute('d')).not.toContain('NaN');
    });
  });
});

describe('MetricCard', () => {
  it('never renders a NaN in the path d attribute when a sample is "NaN"', async () => {
    mockRangeResponse([
      [1000, '10'], [1060, 'NaN'], [1120, '20'], [1180, '15'], [1240, '25'],
    ]);

    const { container } = renderWithClient(<MetricCard title="CPU" query="up" />);

    await waitFor(() => {
      expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
    });

    container.querySelectorAll('path').forEach((p) => {
      expect(p.getAttribute('d')).not.toContain('NaN');
    });
  });

  it('shows "No data" instead of a broken chart when every sample is non-finite', async () => {
    mockRangeResponse([[1000, 'NaN'], [1060, 'NaN'], [1120, '+Inf']]);

    const { findByText } = renderWithClient(<MetricCard title="CPU" query="up" />);

    expect(await findByText('No data')).toBeTruthy();
  });

  it('keeps its own color when a lower-is-worse value is healthy', async () => {
    // Nodes Ready 4 against { warning: 2, critical: 1 } used to render red.
    mockRangeResponse([[1000, '4'], [1060, '4'], [1120, '4']]);

    const { findByText } = renderWithClient(
      <MetricCard title="Nodes Ready" query="up" unit="" color="#10b981" thresholds={{ warning: 2, critical: 1 }} />,
    );

    const value = await findByText('4');
    expect(value.closest('span')?.getAttribute('style')).toContain('rgb(16, 185, 129)');
  });

  it('turns critical when a lower-is-worse value drops to the threshold', async () => {
    mockRangeResponse([[1000, '3'], [1060, '2'], [1120, '1']]);

    const { findByText } = renderWithClient(
      <MetricCard title="Nodes Ready" query="up" unit="" color="#10b981" thresholds={{ warning: 2, critical: 1 }} />,
    );

    const value = await findByText('1');
    expect(value.closest('span')?.getAttribute('style')).toContain('rgb(239, 68, 68)');
  });

  it('shows counts without a trailing .0', async () => {
    mockRangeResponse([[1000, '10'], [1060, '10']]);

    const { findByText, queryByText } = renderWithClient(<MetricCard title="Pods Running" query="up" unit="" />);

    expect(await findByText('10')).toBeTruthy();
    expect(queryByText('10.0')).toBeNull();
  });
});


describe('MetricCard against its usual value', () => {
  function mockByUrl(rangeValues: [number, string][], usual: string | null) {
    mockFetch.mockImplementation((url: string) => {
      const isRange = String(url).includes('query_range');
      const result = isRange
        ? [{ metric: {}, values: rangeValues }]
        : usual === null ? [] : [{ metric: {}, value: [1300, usual] }];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'success', data: { resultType: isRange ? 'matrix' : 'vector', result } }),
      });
    });
  }

  it('says how many times usual the current value is', async () => {
    mockByUrl([[1000, '70'], [1060, '80']], '40');
    const { findByText } = renderWithClient(<MetricCard title="CPU" query="cpu" unit="%" thresholds={{ warning: 70, critical: 90 }} />);
    const label = await findByText('2× usual');
    expect(label.className).toContain('text-amber-400'); // higher is worse
    expect(label.getAttribute('title')).toContain('Usual: 40%');
  });

  it('stays quiet when the value is within its usual band or has no history', async () => {
    mockByUrl([[1000, '41'], [1060, '42']], '40');
    const first = renderWithClient(<MetricCard title="CPU" query="cpu" />);
    await waitFor(() => expect(mockFetch.mock.calls.some(([u]) => !String(u).includes('query_range'))).toBe(true));
    expect(first.queryByText(/usual/)).toBeNull();
    first.unmount();

    mockByUrl([[1000, '41'], [1060, '42']], null);
    const second = renderWithClient(<MetricCard title="CPU" query="cpu" />);
    await second.findByText('42%');
    expect(second.queryByText(/usual/)).toBeNull();
  });
});
