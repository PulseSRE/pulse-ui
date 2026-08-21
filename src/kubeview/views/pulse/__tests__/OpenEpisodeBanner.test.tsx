// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { OpenEpisodeBanner } from '../OpenEpisodeBanner';

/**
 * The audit asked for "one front door": at 03:00 an SRE needs one screen that
 * says what is wrong, and the product should already know which one. Putting
 * the episode panel inside the Inbox tab was not that — you still had to land
 * on the dashboard and know to go looking.
 */

const fetchOpenEpisodes = vi.fn();

vi.mock('../../../engine/episodeApi', () => ({
  fetchOpenEpisodes: (...a: unknown[]) => fetchOpenEpisodes(...a),
}));

const EPISODE = {
  id: 'ep-1',
  status: 'open' as const,
  cause_category: 'control_plane',
  cause_title: 'etcd changed leader 12 times in an hour',
  cause_finding_id: 'f-1',
  cause_layer: 0,
  started_at: Math.floor(Date.now() / 1000) - 1800,
  cause_started_at: null,
  ended_at: null,
  last_seen_at: Math.floor(Date.now() / 1000),
  symptom_count: 8,
  namespaces: ['multicluster-engine', 'open-cluster-management'],
  correlation_key: 'control_plane::Etcd/cluster',
  recurrence_of: null,
};

describe('OpenEpisodeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchOpenEpisodes.mockResolvedValue([EPISODE]);
  });

  afterEach(cleanup);

  it('stays out of the way when nothing is wrong', async () => {
    fetchOpenEpisodes.mockResolvedValue([]);
    const { container } = render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    await waitFor(() => expect(fetchOpenEpisodes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('leads with the cause, not a count of findings', async () => {
    render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    expect(await screen.findByText(EPISODE.cause_title)).toBeTruthy();
    expect(screen.getByText('Open incident')).toBeTruthy();
  });

  it('shows how long it has been running and how far it reaches', async () => {
    render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    expect(await screen.findByText(/running 30m/)).toBeTruthy();
    expect(screen.getByText(/8 symptoms across 2 namespaces/)).toBeTruthy();
  });

  it('measures "running" from the cause\'s own onset, not from when the episode reopened', async () => {
    // Observed live: a cause firing for two days, an episode reopened seconds
    // ago after a gap -- "running 7s" for a condition nowhere near new.
    fetchOpenEpisodes.mockResolvedValue([
      {
        ...EPISODE,
        started_at: Math.floor(Date.now() / 1000) - 7,
        cause_started_at: Math.floor(Date.now() / 1000) - 2 * 86400,
      },
    ]);
    render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    expect(await screen.findByText(/running 2d/)).toBeTruthy();
    expect(screen.queryByText(/running 7s/)).toBeNull();
  });

  it('takes you to the incident in one click', async () => {
    const onOpen = vi.fn();
    render(<OpenEpisodeBanner onOpen={onOpen} />);
    fireEvent.click(await screen.findByText(EPISODE.cause_title));
    expect(onOpen).toHaveBeenCalled();
  });

  it('says when the same cause has been seen before', async () => {
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, recurrence_of: 'ep-earlier' }]);
    render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    expect(await screen.findByText('seen before')).toBeTruthy();
  });

  it('mentions the others rather than hiding them', async () => {
    fetchOpenEpisodes.mockResolvedValue([EPISODE, { ...EPISODE, id: 'ep-2' }, { ...EPISODE, id: 'ep-3' }]);
    render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    expect(await screen.findByText('+2 more open')).toBeTruthy();
  });

  it('survives the agent being unreachable', async () => {
    fetchOpenEpisodes.mockRejectedValue(new Error('offline'));
    const { container } = render(<OpenEpisodeBanner onOpen={vi.fn()} />);
    await waitFor(() => expect(fetchOpenEpisodes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
