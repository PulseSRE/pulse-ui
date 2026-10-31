// @vitest-environment jsdom
/**
 * DataEditor saves a merge patch that carries only what changed: removed keys
 * as null, edited/added keys re-encoded, and every other key left out so its
 * stored bytes are never touched. It sends the resourceVersion it read, so a
 * concurrent change is a 409 ("reload") rather than a silent overwrite.
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

const UTF8 = 'cMOkc3N3w7ZyZA=='; // "pässwörd" as UTF-8
const BINARY = 'MIL/AA=='; // 30 82 ff 00 — not valid UTF-8

function renderEditor(kind: 'ConfigMap' | 'Secret', data: Record<string, string>) {
  stored = { ...data };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DataEditor resourcePath="/api/v1/namespaces/shop/secrets/app" data={data} kind={kind} clusterId="prod-east" resourceVersion="41" />
    </QueryClientProvider>,
  );
}

// The server's answer: the stored data with the merge patch applied.
let stored: Record<string, string> = {};
beforeEach(() => {
  vi.clearAllMocks();
  k8sPatch.mockImplementation(async (_p: string, body: any) => {
    const next = { ...stored };
    for (const [k, v] of Object.entries(body.data as Record<string, string | null>)) {
      if (v === null) delete next[k]; else next[k] = v;
    }
    return { metadata: { resourceVersion: '42' }, data: next };
  });
});
afterEach(() => cleanup());

describe('DataEditor', () => {
  it('removing a key sends only that key as null, with the resourceVersion, to the given cluster', async () => {
    renderEditor('ConfigMap', { keep: '1', drop: '2' });
    fireEvent.click(screen.getAllByTitle('Remove entry')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalledTimes(1));
    expect(k8sPatch).toHaveBeenCalledWith(
      '/api/v1/namespaces/shop/secrets/app',
      { metadata: { resourceVersion: '41' }, data: { drop: null } },
      'application/merge-patch+json',
      'prod-east',
    );
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'ConfigMap updated' }));
  });

  it('editing one Secret key leaves UTF-8 and binary keys byte-for-byte untouched', async () => {
    renderEditor('Secret', { user: btoa('admin'), password: UTF8, cert: BINARY });
    fireEvent.click(screen.getByRole('button', { name: /Reveal/ }));
    expect(screen.getByDisplayValue('pässwörd')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('admin'), { target: { value: 'root' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    const body = k8sPatch.mock.calls[0][1];
    expect(body.data).toEqual({ user: btoa('root') });
    expect(body.data).not.toHaveProperty('password');
    expect(body.data).not.toHaveProperty('cert');
  });

  it('a changed non-ASCII value is encoded as UTF-8', async () => {
    renderEditor('Secret', { password: UTF8 });
    fireEvent.click(screen.getByRole('button', { name: /Reveal/ }));
    fireEvent.change(screen.getByDisplayValue('pässwörd'), { target: { value: 'grüße' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(k8sPatch).toHaveBeenCalled());
    expect(k8sPatch.mock.calls[0][1].data).toEqual({ password: 'Z3LDvMOfZQ==' });
  });

  it('a binary value is shown read-only as base64', () => {
    renderEditor('Secret', { cert: BINARY });
    fireEvent.click(screen.getByRole('button', { name: /Reveal/ }));
    expect(screen.getByText('binary · base64')).toBeTruthy();
    expect(screen.queryByDisplayValue(BINARY)).toBeNull();
    expect(screen.getByText(BINARY)).toBeTruthy();
  });

  it('a 409 says someone else changed it and offers a reload', async () => {
    k8sPatch.mockRejectedValueOnce(Object.assign(new Error('the object has been modified'), { statusCode: 409 }));
    renderEditor('ConfigMap', { keep: '1', drop: '2' });
    fireEvent.click(screen.getAllByTitle('Remove entry')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/changed by someone else/);
    expect(addToast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByTitle('Remove entry')).toHaveLength(2);
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
