// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
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

  // vitest.config.ts registers no setupFiles, so Testing Library's automatic
  // cleanup is not installed — without this, renders stack up in the same
  // document and queries match elements from previous tests.
  afterEach(cleanup);

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


// ── the context the agent now returns alongside the symptoms ──────────────

const CHANGES = [
  {
    category: 'audit_deployment',
    title: 'ocm-controller rolled out',
    namespace: 'multicluster-engine',
    at: 1786000000,
    seconds_before: 420,
  },
  {
    category: 'audit_rbac',
    title: 'cluster-admin granted to svc/deployer',
    namespace: 'open-cluster-management',
    at: 1786000200,
    seconds_before: 120,
  },
];

describe('EpisodePanel context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchOpenEpisodes.mockResolvedValue([EPISODE]);
    detachSymptom.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('names the cadence when the cause keeps coming back', async () => {
    fetchEpisode.mockResolvedValue({
      episode: EPISODE,
      symptoms: SYMPTOMS,
      recurrence: { occurrences: 6, recurring: true, window_seconds: 39600, interval_seconds: 7200 },
    });
    render(<EpisodePanel />);
    // "6 times in 11h · every 2h" — the sentence that turns a page into a diagnosis
    expect(await screen.findByText(/6 times in 11h/)).toBeTruthy();
    expect(screen.getByText(/every 2h/)).toBeTruthy();
  });

  it('says nothing about cadence when the returns are irregular', async () => {
    fetchEpisode.mockResolvedValue({
      episode: EPISODE,
      symptoms: SYMPTOMS,
      recurrence: { occurrences: 3, recurring: true, window_seconds: 39600 },
    });
    render(<EpisodePanel />);
    expect(await screen.findByText(/3 times in 11h/)).toBeTruthy();
    expect(screen.queryByText(/every/)).toBeNull();
  });

  it('shows what changed before it started, with how long before', async () => {
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS, changes: CHANGES });
    render(<EpisodePanel />);
    expect(await screen.findByText('cluster-admin granted to svc/deployer')).toBeTruthy();
    expect(screen.getByText('−2m')).toBeTruthy();
    expect(screen.getByText('−7m')).toBeTruthy();
  });

  it('does not claim the change caused it', async () => {
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS, changes: CHANGES });
    render(<EpisodePanel />);
    expect(await screen.findByText(/not necessarily the cause/i)).toBeTruthy();
  });

  it('renders against an agent that sends neither field', async () => {
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS });
    render(<EpisodePanel />);
    expect(await screen.findByText(EPISODE.cause_title)).toBeTruthy();
    expect(screen.queryByText(/not necessarily the cause/i)).toBeNull();
  });

  it('falls back to the plain flag when only recurrence_of is known', async () => {
    fetchEpisode.mockResolvedValue({
      episode: { ...EPISODE, recurrence_of: 'ep-earlier' },
      symptoms: SYMPTOMS,
    });
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, recurrence_of: 'ep-earlier' }]);
    render(<EpisodePanel />);
    expect(await screen.findByText('recurring')).toBeTruthy();
  });
});
