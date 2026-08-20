// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InboxResetButton } from '../InboxResetButton';
import { resetInbox } from '../../../engine/inboxApi';

vi.mock('../../../engine/inboxApi', () => ({
  resetInbox: vi.fn(),
}));

const refresh = vi.fn();

vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector) =>
    selector({
      stats: { needs_attention: 33, total: 339 },
      refresh,
    }),
  ),
}));

const OUTCOME = {
  reset_at: 1_700_000_000,
  reset_by: 'sre@example.com',
  items_archived: 33,
  pinned_archived: 1,
  claimed_archived: 2,
  episodes_closed: 1,
  containers_baselined: 412,
  rescanned: true,
};

describe('InboxResetButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resetInbox).mockResolvedValue(OUTCOME);
  });

  afterEach(cleanup);

  it('does not reset on the first click — it asks first', () => {
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    expect(resetInbox).not.toHaveBeenCalled();
  });

  it('says how many items it is about to take, and that nothing is deleted', () => {
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.getByText(/Archive 33 open items/)).toBeDefined();
    expect(screen.getByText(/Nothing is deleted/)).toBeDefined();
    expect(screen.getByText(/comes straight back/)).toBeDefined();
  });

  it('cancelling leaves the inbox alone', () => {
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(resetInbox).not.toHaveBeenCalled();
    expect(screen.getByText('Reset')).toBeDefined();
  });

  it('confirming resets and reloads the list', async () => {
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getAllByText('Reset')[0]);
    await waitFor(() => expect(resetInbox).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('reports what it did rather than just closing', async () => {
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getAllByText('Reset')[0]);
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain('33 items archived');
    expect(status).toContain('1 episode closed');
    expect(status).toContain('Rescanned');
  });

  it('says so when the rescan failed but the reset stood', async () => {
    vi.mocked(resetInbox).mockResolvedValue({ ...OUTCOME, rescanned: false, rescan_error: 'API down' });
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getAllByText('Reset')[0]);
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    expect(screen.getByRole('status').textContent).toContain('Rescan failed');
  });

  it('surfaces a failure instead of pretending it worked', async () => {
    vi.mocked(resetInbox).mockRejectedValue(new Error('403 Administrator access required'));
    render(<InboxResetButton />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getAllByText('Reset')[0]);
    await waitFor(() => expect(screen.getByText(/Administrator access required/)).toBeDefined());
    expect(refresh).not.toHaveBeenCalled();
  });
});
