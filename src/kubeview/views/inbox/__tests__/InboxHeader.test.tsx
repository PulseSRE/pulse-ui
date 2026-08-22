// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { InboxHeader } from '../InboxHeader';

// Mutable so a test can vary one field (e.g. currentUser) without restating
// the whole store.
let stateOverride: Record<string, unknown> = {};

vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector) => {
    const state = {
      stats: { new: 3, total: 10, agent_cleared: 5, critical: 2, warning: 4 },
      activePreset: null,
      setPreset: vi.fn(),
      refresh: vi.fn(),
      ...stateOverride,
    };
    return selector(state);
  }),
}));

describe('InboxHeader', () => {
  const onNewTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders inbox title', () => {
    render(<InboxHeader onNewTask={onNewTask} />);
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeDefined();
  });

  it('renders preset buttons with aria-pressed', () => {
    render(<InboxHeader onNewTask={onNewTask} />);
    const btns = screen.getAllByRole('button', { pressed: false });
    const presetLabels = btns.map((b) => b.textContent).filter((t) => t?.includes('Attention') || t?.includes('Cleared'));
    expect(presetLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('renders new task button', () => {
    render(<InboxHeader onNewTask={onNewTask} />);
    const btns = screen.getAllByText(/New Task/);
    expect(btns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(btns[0]);
    expect(onNewTask).toHaveBeenCalled();
  });

  it('renders severity badges when data exists', () => {
    render(<InboxHeader onNewTask={onNewTask} />);
    expect(screen.getAllByText(/Critical/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Warning/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('the My Items pill does not print an identity hash at you', () => {
  afterEach(cleanup);

  it('names a real user', () => {
    stateOverride = { currentUser: 'kube:admin' };
    render(<InboxHeader onNewTask={vi.fn()} />);
    expect(screen.getByText(/My Items \(kube:admin\)/)).toBeDefined();
  });

  it('says just My Items when the identity is the agent opaque fallback', () => {
    // Observed live: "My Items (user-5451b787f74974ba)". The hash is the right
    // thing to key data on and the wrong thing to show a person.
    stateOverride = { currentUser: 'user-5451b787f74974ba' };
    render(<InboxHeader onNewTask={vi.fn()} />);
    expect(screen.getByText('My Items')).toBeDefined();
    expect(screen.queryByText(/user-5451b/)).toBeNull();
  });

  it('says just My Items when there is no user at all', () => {
    stateOverride = { currentUser: null };
    render(<InboxHeader onNewTask={vi.fn()} />);
    expect(screen.getByText('My Items')).toBeDefined();
  });
});
