// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { EpisodePanel } from '../EpisodePanel';

const fetchOpenEpisodes = vi.fn();
const fetchEpisode = vi.fn();
const detachSymptom = vi.fn();

const dismissEpisode = vi.fn();

vi.mock('../../../engine/episodeApi', () => ({
  fetchOpenEpisodes: (...a: unknown[]) => fetchOpenEpisodes(...a),
  fetchEpisode: (...a: unknown[]) => fetchEpisode(...a),
  detachSymptom: (...a: unknown[]) => detachSymptom(...a),
  dismissEpisode: (...a: unknown[]) => dismissEpisode(...a),
}));

// The agent panel opens a WebSocket; not what these tests are about.
vi.mock('../../../components/agent/InlineAgent', () => ({
  InlineAgent: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="inline-agent">{initialPrompt}</div>
  ),
}));

const EPISODE = {
  id: 'ep-1',
  status: 'open' as const,
  cause_category: 'control_plane',
  cause_title: 'etcd changed leader 12 times in an hour',
  cause_finding_id: 'f-1',
  cause_layer: 0,
  started_at: Math.floor(Date.now() / 1000) - 600,
  cause_started_at: null,
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

  it('measures "started" from the episode when the cause reports no onset of its own', async () => {
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, started_at: Math.floor(Date.now() / 1000) - 600 }]);
    render(<EpisodePanel />);
    expect(await screen.findByText(/started 10m ago/)).toBeTruthy();
  });

  it('measures "started" from the cause\'s own onset, not from when Pulse opened the episode', async () => {
    // Observed live: a cause firing for two days, an episode reopened seconds
    // ago after a gap -- "started 7s ago" for a condition nowhere near new.
    fetchOpenEpisodes.mockResolvedValue([
      {
        ...EPISODE,
        started_at: Math.floor(Date.now() / 1000) - 7,
        cause_started_at: Math.floor(Date.now() / 1000) - 2 * 86400,
      },
    ]);
    render(<EpisodePanel />);
    expect(await screen.findByText(/started 2d ago/)).toBeTruthy();
    expect(screen.queryByText(/started 7s ago/)).toBeNull();
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


// ── the work already done, and the ways out ───────────────────────────────

describe('EpisodePanel investigation and dismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchOpenEpisodes.mockResolvedValue([EPISODE]);
    dismissEpisode.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('shows what the agent already concluded', async () => {
    fetchEpisode.mockResolvedValue({
      episode: EPISODE,
      symptoms: SYMPTOMS,
      investigation: {
        id: 'inv-1', status: 'completed', summary: 's', suspected_cause: 'peer latency',
        recommended_fix: 'check the network path', confidence: 0.8, error: null,
        timestamp: 1, failed: false,
      },
    });
    render(<EpisodePanel />);
    expect(await screen.findByText(/peer latency/)).toBeTruthy();
    expect(screen.getByText(/check the network path/)).toBeTruthy();
  });

  it('says the investigation failed rather than showing nothing', async () => {
    fetchEpisode.mockResolvedValue({
      episode: EPISODE,
      symptoms: SYMPTOMS,
      investigation: {
        id: 'inv-1', status: 'failed', summary: null, suspected_cause: null,
        recommended_fix: null, confidence: null, error: 'Connection error.',
        timestamp: 1, failed: true,
      },
    });
    render(<EpisodePanel />);
    expect(await screen.findByText(/Connection error/)).toBeTruthy();
    expect(screen.getByText(/without\s+root-cause analysis/)).toBeTruthy();
  });

  it('hands the agent everything the card already knows', async () => {
    fetchEpisode.mockResolvedValue({
      episode: EPISODE,
      symptoms: SYMPTOMS,
      investigation: {
        id: 'inv-1', status: 'completed', summary: null, suspected_cause: 'x',
        recommended_fix: null, confidence: null, error: null, timestamp: 1, failed: false,
      },
      recurrence: { occurrences: 6, recurring: true, window_seconds: 39600, interval_seconds: 7200 },
      changes: [{ category: 'audit_rbac', title: 'cluster-admin granted', namespace: 'ns', at: 1, seconds_before: 120 }],
    });
    render(<EpisodePanel />);
    const prompt = (await screen.findByTestId('inline-agent')).textContent || '';
    expect(prompt).toContain(EPISODE.cause_title);
    expect(prompt).toContain('cluster-admin granted');
    expect(prompt).toContain('6 times');
    expect(prompt).toContain('What should I do about it?');
  });

  it('an operator can dismiss the episode', async () => {
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS });
    render(<EpisodePanel />);
    fireEvent.click(await screen.findByText('Dismiss'));
    await waitFor(() => expect(dismissEpisode).toHaveBeenCalledWith('ep-1'));
  });

  it('renders against an agent that returns no investigation', async () => {
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS });
    render(<EpisodePanel />);
    expect(await screen.findByText(EPISODE.cause_title)).toBeTruthy();
    expect(screen.queryByTestId('inline-agent')).toBeNull();
  });
});
