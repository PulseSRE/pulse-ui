import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * When an open episode explains some inbox items, the agent leaves them out of
 * the list and reports how many. The UI shows that count, because items
 * disappearing from a work queue with no explanation is its own way of losing
 * someone's trust — so the number has to survive the trip from API to store.
 */

const fetchInbox = vi.fn();

vi.mock('../../engine/inboxApi', () => ({
  fetchInbox: (...a: unknown[]) => fetchInbox(...a),
  fetchInboxStats: vi.fn().mockResolvedValue({ new: 0, total: 0 }),
  acknowledgeInboxItem: vi.fn(),
  claimInboxItem: vi.fn(),
  unclaimInboxItem: vi.fn(),
  snoozeInboxItem: vi.fn(),
  dismissInboxItem: vi.fn(),
  resolveInboxItem: vi.fn(),
  pinInboxItem: vi.fn(),
  createInboxTask: vi.fn(),
  restoreInboxItem: vi.fn(),
}));
vi.mock('../../engine/auth', () => ({ handleAuthError: vi.fn() }));
vi.mock('../uiStore', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));

import { useInboxStore } from '../inboxStore';

function response(over: Record<string, unknown> = {}) {
  return { items: [], groups: [], stats: {}, total: 0, ...over };
}

describe('inboxStore — episode collapse count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxStore.setState({ collapsedIntoEpisodes: 0 });
  });

  it('starts at zero', () => {
    expect(useInboxStore.getState().collapsedIntoEpisodes).toBe(0);
  });

  it('carries the count from the agent', async () => {
    fetchInbox.mockResolvedValue(response({ collapsedIntoEpisodes: 12 }));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().collapsedIntoEpisodes).toBe(12);
  });

  it('treats an agent that does not send the field as nothing collapsed', async () => {
    // An older agent, or one where episodes could not be read.
    fetchInbox.mockResolvedValue(response());
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().collapsedIntoEpisodes).toBe(0);
  });

  it('clears the count when a later refresh collapses nothing', async () => {
    fetchInbox.mockResolvedValue(response({ collapsedIntoEpisodes: 5 }));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().collapsedIntoEpisodes).toBe(5);

    fetchInbox.mockResolvedValue(response({ collapsedIntoEpisodes: 0 }));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().collapsedIntoEpisodes).toBe(0);
  });
});
