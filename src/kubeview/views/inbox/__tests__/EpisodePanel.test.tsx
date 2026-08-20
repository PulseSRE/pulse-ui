// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EpisodePanel } from '../EpisodePanel';

const fetchOpenEpisodes = vi.fn();
const fetchEpisode = vi.fn();
const detachSymptom = vi.fn();

vi.mock('../../../engine/episodeApi', () => ({
  fetchOpenEpisodes: (...a: unknown[]) => fetchOpenEpisodes(...a),
  fetchEpisode: (...a: unknown[]) => fetchEpisode(...a),
  detachSymptom: (...a: unknown[]) => detachSymptom(...a),
}));

const EPISODE = {
  id: 'ep-1',
  status: 'open' as const,
  cause_category: 'control_plane',
  cause_title: 'etcd changed leader 12 times in an hour',
  cause_finding_id: 'f-1',
  cause_layer: 0,
  started_at: Math.floor(Date.now() / 1000) - 600,
  ended_at: null,
  last_seen_at: Math.floor(Date.now() / 1000),
  symptom_count: 2,
  namespaces: ['multicluster-engine', 'open-cluster-management'],
  correlation_key: 'control_plane::Etcd/cluster',
  recurrence_of: null,
};

const SYMPTOMS = [
  {
    episode_id: 'ep-1',
    correlation_key: 'workloads:mce:Deployment/ocm-controller',
    category: 'workloads',
    title: 'Deployment ocm-controller degraded (0/2)',
    namespace: 'multicluster-engine',
    attached_at: 1,
    detached_at: null,
    detached_by: null,
  },
  {
    episode_id: 'ep-1',
    correlation_key: 'crashloop:ocm:Pod/grc-policy-propagator',
    category: 'crashloop',
    title: 'Pod grc-policy-propagator restarting (14x)',
    namespace: 'open-cluster-management',
    attached_at: 2,
    detached_at: null,
    detached_by: null,
  },
];

describe('EpisodePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchOpenEpisodes.mockResolvedValue([EPISODE]);
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS });
    detachSymptom.mockResolvedValue(undefined);
  });

  it('renders nothing when no episode is open', async () => {
    fetchOpenEpisodes.mockResolvedValue([]);
    const { container } = render(<EpisodePanel />);
    await waitFor(() => expect(fetchOpenEpisodes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('leads with the cause, not the symptoms', async () => {
    render(<EpisodePanel />);
    expect(await screen.findByText(EPISODE.cause_title)).toBeTruthy();
    expect(screen.getByText('Cause')).toBeTruthy();
  });

  it('shows the blast radius so the list is not mistaken for separate problems', async () => {
    render(<EpisodePanel />);
    expect(await screen.findByText(/2 symptoms across 2 namespaces/)).toBeTruthy();
    expect(screen.getByText(/not separate problems/i)).toBeTruthy();
  });

  it('folds the symptoms underneath the cause', async () => {
    render(<EpisodePanel />);
    expect(await screen.findByText(SYMPTOMS[0].title)).toBeTruthy();
    expect(screen.getByText(SYMPTOMS[1].title)).toBeTruthy();
  });

  it('marks a recurring episode', async () => {
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, recurrence_of: 'ep-earlier' }]);
    render(<EpisodePanel />);
    expect(await screen.findByText('recurring')).toBeTruthy();
  });

  it('detaching a symptom tells the agent and removes it from view', async () => {
    render(<EpisodePanel />);
    await screen.findByText(SYMPTOMS[0].title);

    fireEvent.click(screen.getAllByTitle(/not caused by the episode/i)[0]);

    await waitFor(() =>
      expect(detachSymptom).toHaveBeenCalledWith('ep-1', SYMPTOMS[0].correlation_key),
    );
    await waitFor(() => expect(screen.queryByText(SYMPTOMS[0].title)).toBeNull());
  });

  it('survives the agent being unreachable', async () => {
    fetchOpenEpisodes.mockRejectedValue(new Error('offline'));
    const { container } = render(<EpisodePanel />);
    await waitFor(() => expect(fetchOpenEpisodes).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders the cause even when its symptoms cannot be loaded', async () => {
    fetchEpisode.mockRejectedValue(new Error('offline'));
    render(<EpisodePanel />);
    expect(await screen.findByText(EPISODE.cause_title)).toBeTruthy();
  });
});
