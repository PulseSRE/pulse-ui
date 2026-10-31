// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { k8sLogs } from '../query';

afterEach(() => vi.unstubAllGlobals());

describe('k8sLogs previous', () => {
  it('adds previous=true to the log request', async () => {
    const fetchMock = vi.fn(async () => new Response('old', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(k8sLogs('shop', 'web-1', 'app', { tailLines: 80, previous: true }, 'local')).resolves.toBe('old');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kubernetes/api/v1/namespaces/shop/pods/web-1/log?container=app&tailLines=80&previous=true');
  });

  it('rejects when the previous instance does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'previous terminated container "app" not found' }), { status: 400 })));
    await expect(k8sLogs('shop', 'web-1', 'app', { previous: true }, 'local')).rejects.toThrow(/previous terminated container/);
  });
});
