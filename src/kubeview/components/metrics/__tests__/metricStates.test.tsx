// @vitest-environment jsdom
/**
 * Every metric widget gives one of four answers, and they never blur:
 * "Checking…" while the read is in flight, "Could not load metrics: <reason>"
 * with Retry when it failed, "No data for this period" only when the query
 * succeeded and matched nothing, and the chart when there is data.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sparkline, MetricCard } from '../Sparkline';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const HTML_502 = () => new Response('<!DOCTYPE html><html>Bad Gateway</html>', {
  status: 502,
  statusText: 'Bad Gateway',
  headers: { 'content-type': 'text/html' },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const range = (values: [number, string][]) => json({ status: 'success', data: { resultType: 'matrix', result: values.length ? [{ metric: {}, values }] : [] } });
const empty = () => json({ status: 'success', data: { resultType: 'matrix', result: [] } });

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { mockFetch.mockReset(); });
afterEach(cleanup);

const widgets: Array<[string, () => React.ReactElement]> = [
  ['MetricCard', () => <MetricCard title="CPU" query="cpu" />],
  ['Sparkline', () => <Sparkline query="cpu" label="CPU" />],
];

describe.each(widgets)('%s', (_name, widget) => {
  it('says "Checking…" while the read is in flight', async () => {
    let answer: (r: Response) => void = () => {};
    mockFetch.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    renderWithClient(widget());
    expect(await screen.findByText('Checking…')).toBeTruthy();
    expect(screen.queryByText(/No data/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Let the read finish so nothing is left pending after the test.
    answer(empty());
    expect(await screen.findByText('No data for this period')).toBeTruthy();
  });

  it('a failed read (HTML 502) is an error with the reason and Retry, never "No data"', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(HTML_502()));
    renderWithClient(widget());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load metrics');
    expect(alert.textContent).toContain('Prometheus returned an HTML page (status 502) — the metrics backend may be down or behind a login');
    expect(document.body.textContent).not.toMatch(/No data|Unexpected token/);

    mockFetch.mockImplementation(() => Promise.resolve(range([[1, '10'], [2, '20']])));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText(/^20/)).toBeTruthy();
  });

  it('a 403 is an error that says forbidden', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(json({ status: 'error', error: 'forbidden' }, 403)));
    renderWithClient(widget());
    expect((await screen.findByRole('alert')).textContent).toMatch(/403 forbidden/);
  });

  it('says "No data for this period" only when the query succeeded empty', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(empty()));
    renderWithClient(widget());
    expect(await screen.findByText('No data for this period')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('draws the data', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(range([[1, '10'], [2, '20']])));
    const { container } = renderWithClient(widget());
    await waitFor(() => expect(container.querySelectorAll('path').length).toBeGreaterThan(0));
    expect(screen.queryByText('Checking…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('MetricCard after a failed refresh', () => {
  it('does not keep showing the stale value as current', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(range([[1, '10'], [2, '42']])));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MetricCard title="CPU" query="cpu" /></QueryClientProvider>);
    expect(await screen.findByText('42%')).toBeTruthy();

    mockFetch.mockImplementation(() => Promise.resolve(HTML_502()));
    await qc.refetchQueries({ queryKey: ['metric-card'] });
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load metrics');
    expect(screen.queryByText('42%')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});
