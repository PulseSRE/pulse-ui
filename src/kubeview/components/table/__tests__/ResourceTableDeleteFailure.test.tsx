// @vitest-environment jsdom
/**
 * The agent table's delete caught every error and closed the dialog, so a
 * 403 or a conflict looked like a successful delete.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const k8sDelete = vi.fn();
const showErrorToast = vi.fn();
vi.mock('../../../views/TableView', () => ({ compareValues: () => 0 }));
vi.mock('../../../engine/query', () => ({ k8sDelete: (...a: unknown[]) => k8sDelete(...a), getImpersonationHeaders: () => ({}) }));
vi.mock('../../../engine/errorToast', () => ({ showErrorToast: (...a: unknown[]) => showErrorToast(...a) }));
vi.mock('../../../hooks/useResourceUrl', () => ({ buildApiPath: (gvr: string, ns?: string, name?: string) => `/api/${gvr}/${ns}/${name}` }));
vi.mock('../../feedback/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) =>
    open ? <div data-testid="confirm-dialog">{title}<button onClick={onConfirm}>confirm</button></div> : null,
}));

import { ResourceTable } from '../ResourceTable';

describe('agent table delete', () => {
  it('reports a failed delete and keeps the dialog open', async () => {
    k8sDelete.mockRejectedValueOnce(new Error('forbidden'));
    const rows = [{ name: 'pod-1', _gvr: 'v1~pods', namespace: 'default' }];
    render(<MemoryRouter><ResourceTable columns={[{ id: 'name', header: 'Name' }]} rows={rows} showActions /></MemoryRouter>);
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    fireEvent.click(screen.getByText('confirm'));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalled());
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(k8sDelete).toHaveBeenCalledWith('/api/v1/pods/default/pod-1', 'local', undefined);
  });
});
