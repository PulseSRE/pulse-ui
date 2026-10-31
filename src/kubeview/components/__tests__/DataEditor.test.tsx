// @vitest-environment jsdom
/**
 * Removing a ConfigMap/Secret key used to save a strategic merge of the
 * remaining keys, which leaves the removed key in place. The save is now a
 * merge patch that sets removed keys to null, against the cluster on screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const k8sPatch = vi.fn();
vi.mock('../../engine/query', () => ({ k8sPatch: (...a: unknown[]) => k8sPatch(...a) }));
const addToast = vi.fn();
vi.mock('../../store/uiStore', () => ({ useUIStore: (sel: any) => sel({ addToast }) }));
const showErrorToast = vi.fn();
vi.mock('../../engine/errorToast', () => ({ showErrorToast: (...a: unknown[]) => showErrorToast(...a) }));

import DataEditor from '../DataEditor';

function renderEditor(kind: 'ConfigMap' | 'Secret', data: Record<string, string>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DataEditor resourcePath="/api/v1/namespaces/shop/configmaps/app" data={data} kind={kind} clusterId="prod-east" />
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); k8sPatch.mockResolvedValue({}); });
afterEach(() => cleanup());

describe('DataEditor', () => {
  it('removing a key sends it as null in a merge patch to the given cluster', async () => {
    renderEditor('ConfigMap', { keep: '1', drop: '2' });
    fireEvent.click(screen.getAllByTitle('Remove entry')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
    expect(k8sPatch).toHaveBeenCalledWith(
      '/api/v1/namespaces/shop/configmaps/app',
      { data: { keep: '1', drop: null } },
      'application/merge-patch+json',
      'prod-east',
    );
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'ConfigMap updated' }));
  });

  it('Secret values are base64-encoded, including non-Latin text', async () => {
    renderEditor('Secret', { a: btoa('x'), gone: btoa('y') });
    fireEvent.click(screen.getAllByTitle('Remove entry')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(k8sPatch.mock.calls[0][1]).toEqual({ data: { a: btoa('x'), gone: null } });
  });

  it('a failed save reports the error and claims nothing', async () => {
    k8sPatch.mockRejectedValueOnce(new Error('forbidden'));
    renderEditor('ConfigMap', { keep: '1', drop: '2' });
    fireEvent.click(screen.getAllByTitle('Remove entry')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.any(Error), 'Save failed'));
    expect(addToast).not.toHaveBeenCalled();
  });
});
