// @vitest-environment jsdom
/**
 * Snapshots captured while some reads failed: those fields are "not
 * compared" — never a grey "unchanged", never hidden by "Show only changes",
 * and an unreadable node list is not "0 nodes". Uses the real
 * captureSnapshot (fetch answering 403) and the real compareSnapshots.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../store/uiStore', () => {
  const state = { addToast: vi.fn(), impersonateUser: '', impersonateGroups: [] };
  return { useUIStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});

import { mockFetchRoutes } from '../../../__tests__/helpers/honestStates';
import { captureSnapshot, saveSnapshots } from '../../../engine/snapshot';
import { SnapshotsTab } from '../SnapshotsTab';

beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('SnapshotsTab with unreadable sources', () => {
  it('counts and keeps unreadable fields, and does not show "0 nodes"', async () => {
    mockFetchRoutes({ 'clusterversions/version': { body: { status: { desired: { version: '4.17.1' } } } } }, 403);
    const a = { ...(await captureSnapshot('before')), id: 'a' };
    const b = { ...(await captureSnapshot('after')), id: 'b' };
    saveSnapshots([a, b]);

    render(<SnapshotsTab />);
    expect(screen.getAllByText(/\? nodes/).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/\b0 nodes\b/);

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'left' } });
    fireEvent.change(selects[1], { target: { value: 'right' } });

    await waitFor(() => expect(screen.getByText(/fields could not be compared/)).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/before: .*nodes/);
    expect(screen.getAllByLabelText('Not compared').length).toBeGreaterThan(0);

    const before = screen.getAllByLabelText('Not compared').length;
    fireEvent.click(screen.getByLabelText('Show only changes'));
    expect(screen.getAllByLabelText('Not compared').length).toBe(before);
  });
});
