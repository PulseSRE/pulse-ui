// @vitest-environment jsdom
import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

vi.stubGlobal('fetch', vi.fn());

import LogStream from '../LogStream';

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => cleanup());

beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

function mockFetchResponse(status: number, body: string | object) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof body === 'object' ? body : JSON.parse(text)),
    body: null,
  } as any);
}

describe('LogStream', () => {
  it('fetches logs successfully on mount', async () => {
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, 'line one\nline two'));

    await act(async () => {
      render(<LogStream namespace="default" podName="web-1" />);
    });

    expect(screen.getByText('line one')).toBeTruthy();
    expect(screen.getByText('line two')).toBeTruthy();
  });

  it('retries with container name on 400 response (multi-container pod)', async () => {
    // First call: log fetch returns 400
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(400, 'must specify container'));
    // Second call: pod fetch to discover containers
    vi.mocked(fetch).mockReturnValueOnce(
      mockFetchResponse(200, { spec: { containers: [{ name: 'web' }] } })
    );
    // Third call: retry log fetch with container=web
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, 'log line 1\nlog line 2'));

    await act(async () => {
      render(<LogStream namespace="default" podName="multi-pod" />);
    });

    // Verify the retry fetch included the container param
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[2][0]).toContain('container=web');

    expect(screen.getByText('log line 1')).toBeTruthy();
    expect(screen.getByText('log line 2')).toBeTruthy();
  });

  // Regression: the auto-detected default used to be spec.containers[0]
  // unconditionally, which for many real pods (including this cluster's own
  // acm-agent pods) is a sidecar like oauth-proxy — logs "worked" but showed
  // the wrong container by default instead of the actual app.
  it('skips a known sidecar container and picks the app container as the default', async () => {
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(400, 'must specify container'));
    vi.mocked(fetch).mockReturnValueOnce(
      mockFetchResponse(200, { spec: { containers: [{ name: 'oauth-proxy' }, { name: 'streamlit-app' }] } })
    );
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, 'app log line'));

    await act(async () => {
      render(<LogStream namespace="acm-agent" podName="acm-agent-54875b54c8-klmb4" />);
    });

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[2][0]).toContain('container=streamlit-app');
    expect(screen.getByText('app log line')).toBeTruthy();
  });

  it('shows error on non-400 failure', async () => {
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(500, 'Internal Server Error'));

    await act(async () => {
      render(<LogStream namespace="default" podName="crash-pod" />);
    });

    expect(screen.getByText(/Failed to fetch logs: 500/)).toBeTruthy();
  });

  it('falls back to the previous container when the running one has no output, and says so', async () => {
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, ''));
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, 'panic: payments.url is not set'));

    await act(async () => {
      render(<LogStream namespace="shop" podName="checkout-1" />);
    });

    expect(vi.mocked(fetch).mock.calls[1][0]).toContain('previous=true');
    expect(screen.getByText('panic: payments.url is not set')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('previous instance');
  });

  it('asks for the previous logs of the container it auto-detected', async () => {
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(400, 'must specify container'));
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, { spec: { containers: [{ name: 'app' }] } }));
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, ''));
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, 'old line'));

    await act(async () => {
      render(<LogStream namespace="shop" podName="checkout-1" />);
    });

    const prevUrl = String(vi.mocked(fetch).mock.calls[3][0]);
    expect(prevUrl).toContain('container=app');
    expect(prevUrl).toContain('previous=true');
  });

  it('does not mark current logs as previous', async () => {
    vi.mocked(fetch).mockReturnValueOnce(mockFetchResponse(200, 'fresh line'));
    await act(async () => {
      render(<LogStream namespace="shop" podName="checkout-1" />);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('streams every line in follow mode and says when the stream ends', async () => {
    const enc = new TextEncoder();
    const chunks = ['a1\na2\n', 'a3\n'];
    let i = 0;
    const body = { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }) }) };
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve({ ok: true, status: 200, statusText: 'OK', body } as any));

    await act(async () => {
      render(<LogStream namespace="shop" podName="checkout-1" follow />);
    });

    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('follow=true');
    for (const t of ['a1', 'a2', 'a3']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('stream ended');
    expect(screen.queryByText('Live')).toBeNull();
  });
});
