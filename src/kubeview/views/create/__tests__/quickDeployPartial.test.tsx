// @vitest-environment jsdom
/**
 * Quick Deploy never checked the Service and Route responses: a rejected
 * Service still produced "Application created". Each is now checked and a
 * partial result says what is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useUIStore } from '../../../store/uiStore';

vi.mock('../../../components/DeployProgress', () => ({ default: () => null }));
vi.mock('../../../engine/errorToast', () => ({ showErrorToast: vi.fn() }));

import { QuickDeployTab } from '../QuickDeployTab';

const calls: Array<{ method: string; url: string }> = [];
let serviceStatus = 201;

beforeEach(() => {
  calls.length = 0;
  serviceStatus = 201;
  useUIStore.setState({ toasts: [], selectedNamespace: 'shop' } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method || 'GET', url });
    if (url.endsWith('/services')) {
      return serviceStatus === 201
        ? new Response('{}', { status: 201 })
        : new Response(JSON.stringify({ message: 'services "web" is forbidden' }), { status: serviceStatus });
    }
    return new Response('{}', { status: 201 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function deploy() {
  render(<MemoryRouter><QuickDeployTab /></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText('my-app'), { target: { value: 'web' } });
  fireEvent.change(screen.getByPlaceholderText('nginx:latest or quay.io/org/image:tag'), { target: { value: 'nginx:1' } });
  fireEvent.change(screen.getByPlaceholderText('8080 (optional — creates Service)'), { target: { value: '8080' } });
  fireEvent.click(screen.getByText('Deploy'));
}

describe('Quick Deploy partial results', () => {
  it('creates Deployment, Service and Route and reports success', async () => {
    deploy();
    await waitFor(() => expect(useUIStore.getState().toasts.length).toBeGreaterThan(0));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/kubernetes/apis/apps/v1/namespaces/shop/deployments',
      'POST /api/kubernetes/api/v1/namespaces/shop/services',
      'POST /api/kubernetes/apis/route.openshift.io/v1/namespaces/shop/routes',
    ]);
    expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'success', title: 'Application "web" created' });
  });

  it('a rejected Service is reported and no Route is attempted', async () => {
    serviceStatus = 403;
    deploy();
    await waitFor(() => expect(useUIStore.getState().toasts.length).toBeGreaterThan(0));
    const toast = useUIStore.getState().toasts[0];
    expect(toast.type).toBe('warning');
    expect(toast.title).toBe('Deployment "web" created, but not everything was');
    expect(toast.detail).toContain('Service: services "web" is forbidden');
    expect(calls.some((c) => c.url.endsWith('/routes'))).toBe(false);
  });
});
