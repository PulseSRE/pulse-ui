import { describe, it, expect, vi, beforeEach } from 'vitest';
import { k8sList, k8sGet, k8sCreate, k8sUpdate, k8sPatch, k8sDelete, k8sLogs } from '../query';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockOk(data: unknown) {
  return mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
    status: 200,
  });
}

function mockError(code: number, message: string) {
  return mockFetch.mockResolvedValueOnce({
    ok: false,
    status: code,
    json: () => Promise.resolve({ kind: 'Status', message, reason: 'NotFound', code }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('k8sList', () => {
  it('fetches items from list response', async () => {
    mockOk({ apiVersion: 'v1', kind: 'PodList', metadata: {}, items: [{ metadata: { name: 'a' } }, { metadata: { name: 'b' } }] });

    const result = await k8sList('/api/v1/pods');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ metadata: { name: 'a' } });
    expect(mockFetch).toHaveBeenCalledWith('/api/kubernetes/api/v1/pods');
  });

  it('injects namespace into path', async () => {
    mockOk({ items: [] });

    await k8sList('/api/v1/pods', 'kube-system');
    expect(mockFetch).toHaveBeenCalledWith('/api/kubernetes/api/v1/namespaces/kube-system/pods');
  });

  it('skips namespace injection for "all"', async () => {
    mockOk({ items: [] });

    await k8sList('/api/v1/pods', 'all');
    expect(mockFetch).toHaveBeenCalledWith('/api/kubernetes/api/v1/pods');
  });

  it('skips namespace injection if already present', async () => {
    mockOk({ items: [] });

    await k8sList('/api/v1/namespaces/default/pods', 'other');
    expect(mockFetch).toHaveBeenCalledWith('/api/kubernetes/api/v1/namespaces/default/pods');
  });

  it('throws on error response', async () => {
    mockError(404, 'pods not found');

    await expect(k8sList('/api/v1/pods')).rejects.toThrow('pods not found');
  });
});

describe('k8sGet', () => {
  it('fetches a single resource', async () => {
    mockOk({ metadata: { name: 'nginx' }, kind: 'Pod' });

    const result = await k8sGet('/api/v1/namespaces/default/pods/nginx');
    expect(result).toEqual({ metadata: { name: 'nginx' }, kind: 'Pod' });
  });

  it('throws on error', async () => {
    mockError(404, 'pod not found');

    await expect(k8sGet('/api/v1/namespaces/default/pods/nginx')).rejects.toThrow('pod not found');
  });
});

describe('k8sCreate', () => {
  it('sends POST with JSON body', async () => {
    const body = { metadata: { name: 'test' }, kind: 'Pod' };
    mockOk(body);

    await k8sCreate('/api/v1/namespaces/default/pods', body);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/kubernetes/api/v1/namespaces/default/pods',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  });

  it('throws on error', async () => {
    mockError(409, 'already exists');

    await expect(k8sCreate('/api/v1/pods', {})).rejects.toThrow('already exists');
  });
});

describe('k8sUpdate', () => {
  it('sends PUT with JSON body', async () => {
    const body = { metadata: { name: 'test' } };
    mockOk(body);

    await k8sUpdate('/api/v1/namespaces/default/pods/test', body);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

describe('k8sPatch', () => {
  it('sends PATCH with strategic merge by default', async () => {
    mockOk({ metadata: { name: 'test' } });

    await k8sPatch('/api/v1/namespaces/default/pods/test', { metadata: { labels: { app: 'x' } } });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      }),
    );
  });

  it('supports custom patch type', async () => {
    mockOk({});

    await k8sPatch('/api/v1/pods/test', [{ op: 'add', path: '/metadata/labels/x', value: 'y' }], 'application/json-patch+json');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json-patch+json' },
      }),
    );
  });
});

describe('k8sDelete', () => {
  it('sends DELETE with Foreground propagationPolicy for pods', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await k8sDelete('/api/v1/namespaces/default/pods/test');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/kubernetes/api/v1/namespaces/default/pods/test',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ kind: 'DeleteOptions', apiVersion: 'v1', propagationPolicy: 'Foreground' }),
      }),
    );
  });

  it('scales to 0 before deleting deployments', async () => {
    // First call: PATCH to scale down, second call: DELETE
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await k8sDelete('/apis/apps/v1/namespaces/default/deployments/nginx');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // First call: scale to 0
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ spec: { replicas: 0 } });
    // Second call: delete
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
  });

  it('scales to 0 before deleting statefulsets', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await k8sDelete('/apis/apps/v1/namespaces/default/statefulsets/redis');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
  });

  it('does not scale non-scalable resources', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await k8sDelete('/api/v1/namespaces/default/configmaps/test');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('continues delete even if scale-down fails', async () => {
    // Scale fails, delete succeeds
    mockFetch.mockRejectedValueOnce(new Error('scale failed'));
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await k8sDelete('/apis/apps/v1/namespaces/default/deployments/nginx');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not throw on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(k8sDelete('/api/v1/pods/test')).resolves.toBeUndefined();
  });

  it('throws on non-404 error', async () => {
    mockError(403, 'forbidden');

    await expect(k8sDelete('/api/v1/pods/test')).rejects.toThrow('forbidden');
  });
});

describe('k8sLogs', () => {
  it('fetches pod logs as text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('line1\nline2\n'),
    });

    const logs = await k8sLogs('default', 'nginx');
    expect(logs).toBe('line1\nline2\n');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/kubernetes/api/v1/namespaces/default/pods/nginx/log',
    );
  });

  it('adds container parameter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    await k8sLogs('default', 'nginx', 'sidecar');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('container=sidecar'),
    );
  });

  it('adds tailLines parameter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    await k8sLogs('default', 'nginx', undefined, { tailLines: 100 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('tailLines=100'),
    );
  });

  it('adds timestamps parameter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    await k8sLogs('default', 'nginx', undefined, { timestamps: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('timestamps=true'),
    );
  });

  it('combines multiple parameters', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    await k8sLogs('default', 'nginx', 'app', { tailLines: 50, timestamps: true, sinceSeconds: 3600 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('container=app');
    expect(url).toContain('tailLines=50');
    expect(url).toContain('timestamps=true');
    expect(url).toContain('sinceSeconds=3600');
  });
});
