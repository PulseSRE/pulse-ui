// @vitest-environment jsdom
/** The etcd leader cell: a failed Prometheus read is "Could not check", never "No Leader". */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryInstant = vi.fn();
vi.mock('../../../components/metrics/prometheus', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  queryInstant: (...a: unknown[]) => queryInstant(...a),
}));

import { ClusterTypeSummary } from '../ClusterTypeSummary';
import { PrometheusReadError } from '../../../engine/readError';

let qc: QueryClient | undefined;
function renderSummary() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ClusterTypeSummary isHyperShift={false} nodeDetails={[]} nodePools={[]} clusterVersion="4.17.1" platform="AWS" />
    </QueryClientProvider>,
  );
}
const etcdCell = () => screen.getByText('etcd Leader').nextElementSibling as HTMLElement;
/** The visible value, without the screen-reader-only reason. */
const shown = () => etcdCell().firstChild?.textContent;

afterEach(() => { cleanup(); qc?.clear(); queryInstant.mockReset(); });

describe('etcd leader', () => {
  it.each([
    ['403', new PrometheusReadError('forbidden', 'Prometheus refused the query (403)', 403)],
    ['500', new PrometheusReadError('http', 'Prometheus returned an error (status 500)', 500)],
  ])('a %s read says "Could not check" with the reason, not "No Leader"', async (_l, err) => {
    queryInstant.mockRejectedValue(err);
    renderSummary();
    expect(shown()).toBe('Checking…');
    await waitFor(() => expect(shown()).toBe('Could not check'));
    expect(etcdCell().getAttribute('title')).toBe(err.message);
    // The reason is announced too, not only a hover tooltip.
    expect(etcdCell().querySelector('.sr-only')?.textContent).toBe(`: ${err.message}`);
    expect(etcdCell().className).not.toContain('text-red-400');
  });

  it('a successful read with no series is "No data"; a leader is "Elected"', async () => {
    let answer!: (v: unknown) => void;
    queryInstant.mockReturnValue(new Promise((r) => { answer = r; }));
    renderSummary();
    // Not "No data" while the read is still in flight.
    expect(shown()).toBe('Checking…');
    answer([]);
    await waitFor(() => expect(shown()).toBe('No data'));
    cleanup(); qc?.clear();
    queryInstant.mockResolvedValue([{ metric: {}, value: 1 }]);
    renderSummary();
    expect(shown()).toBe('Checking…');
    await waitFor(() => expect(shown()).toBe('Elected'));
  });
});
