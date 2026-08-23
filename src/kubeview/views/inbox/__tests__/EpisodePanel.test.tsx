// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { EpisodePanel, timelineRangeFor } from '../EpisodePanel';

const fetchOpenEpisodes = vi.fn();
const fetchEpisode = vi.fn();
const detachSymptom = vi.fn();

const dismissEpisode = vi.fn();

const connectAndSend = vi.fn();
const expandAISidebar = vi.fn();
const setAISidebarMode = vi.fn();

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(() => ({}), {
    getState: () => ({ connectAndSend }),
  }),
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign(() => ({}), {
    getState: () => ({ expandAISidebar, setAISidebarMode }),
  }),
}));

vi.mock('../../../engine/episodeApi', () => ({
  fetchOpenEpisodes: (...a: unknown[]) => fetchOpenEpisodes(...a),
  fetchEpisode: (...a: unknown[]) => fetchEpisode(...a),
  detachSymptom: (...a: unknown[]) => detachSymptom(...a),
  dismissEpisode: (...a: unknown[]) => dismissEpisode(...a),
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
    // The prompt used to be read off an embedded chat panel. There is only one
    // chat surface now, so it is read off the message sent into the sidebar.
    //
    // Wait for the recurrence label before clicking: the button renders
    // immediately but the prompt is built from `changes` and `recurrence`,
    // which arrive from fetchEpisode. Clicking too early sent a prompt that
    // was correct but incomplete — a genuine race, and it made this test fail
    // roughly one full-suite run in several.
    await screen.findByText(/6 times/);
    fireEvent.click(await screen.findByText(/How do I fix this\?/));
    await waitFor(() => expect(connectAndSend).toHaveBeenCalled());
    const prompt = connectAndSend.mock.calls[0][0] as string;
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

/**
 * A cause that explains nothing.
 *
 * Two control-plane memory episodes opened in the same second on the reference
 * cluster: `HighOverallControlPlaneMemory` with eight symptoms, and
 * `ControlPlaneNodeMemoryHigh` with none. Neither can explain the other — they
 * sit at the same causal layer — so symptom ownership went entirely to
 * whichever claimed them first, and the loser still rendered as a full-width
 * red cause card, ahead of the one doing the explaining.
 *
 * An episode is a claim that one thing explains others. Until it explains
 * something it has made no claim.
 */
describe('an episode that explains nothing does not lead the queue', () => {
  const EMPTY = {
    ...EPISODE,
    id: 'ep-empty',
    cause_title: 'ControlPlaneNodeMemoryHigh',
    symptom_count: 0,
    namespaces: [],
    correlation_key: 'alerts::Alert/ControlPlaneNodeMemoryHigh',
  };
  const FULL = { ...EPISODE, id: 'ep-full', cause_title: 'HighOverallControlPlaneMemory', symptom_count: 8 };

  beforeEach(() => {
    vi.clearAllMocks();
    detachSymptom.mockResolvedValue(undefined);
    fetchEpisode.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'ep-empty'
          ? { episode: EMPTY, symptoms: [] }
          : { episode: FULL, symptoms: SYMPTOMS },
      ),
    );
  });

  afterEach(cleanup);

  it('puts the cause that explains the most first', async () => {
    // Returned worst-first by the API, as it was on the cluster.
    fetchOpenEpisodes.mockResolvedValue([EMPTY, FULL]);
    render(<EpisodePanel />);
    await waitFor(() => expect(screen.getByText('HighOverallControlPlaneMemory')).toBeDefined());
    const rendered = document.body.textContent ?? '';
    expect(rendered.indexOf('HighOverallControlPlaneMemory')).toBeLessThan(
      rendered.indexOf('ControlPlaneNodeMemoryHigh'),
    );
  });

  it('says so in words rather than showing a bare zero', async () => {
    // "0 symptoms" reads like a count that failed to load.
    fetchOpenEpisodes.mockResolvedValue([EMPTY]);
    render(<EpisodePanel />);
    expect(await screen.findByText(/explains nothing yet/)).toBeDefined();
    expect(screen.queryByText(/0 symptoms/)).toBeNull();
  });

  it('does not dress it as an alarm', async () => {
    fetchOpenEpisodes.mockResolvedValue([EMPTY]);
    const { container } = render(<EpisodePanel />);
    await screen.findByText(/explains nothing yet/);
    const card = container.querySelector('div[class*="rounded-lg"][class*="border"]');
    expect(card?.className).not.toMatch(/border-red/);
  });

  it('does not flash "explains nothing" while its symptoms are still loading', async () => {
    // The list payload carries symptom_count synchronously; the symptom detail
    // arrives later. Reading only the async list meant every card rendered
    // grey "explains nothing yet" for a beat and then flipped to red.
    // A detail fetch that never resolves pins the pre-load state.
    fetchOpenEpisodes.mockResolvedValue([FULL]);
    fetchEpisode.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<EpisodePanel />);
    await screen.findByText('HighOverallControlPlaneMemory');
    expect(screen.queryByText(/explains nothing yet/)).toBeNull();
    const card = container.querySelector('div[class*="rounded-lg"][class*="border"]');
    expect(card?.className).toMatch(/border-red/);
  });

  it('trusts the list payload for an empty episode before detail loads too', async () => {
    fetchOpenEpisodes.mockResolvedValue([EMPTY]);
    fetchEpisode.mockImplementation(() => new Promise(() => {}));
    render(<EpisodePanel />);
    expect(await screen.findByText(/explains nothing yet/)).toBeDefined();
  });

  it('an episode that does explain something keeps the alarm', async () => {
    fetchOpenEpisodes.mockResolvedValue([FULL]);
    const { container } = render(<EpisodePanel />);
    await screen.findByText('HighOverallControlPlaneMemory');
    const card = container.querySelector('div[class*="rounded-lg"][class*="border"]');
    expect(card?.className).toMatch(/border-red/);
  });
});

describe('an episode points at what else changed', () => {
  const NOW = 1_800_000_000;

  afterEach(cleanup);

  it('picks a range that covers the onset, not the page default', () => {
    // 6h is the Timeline's own default and would exclude a cause that began
    // fourteen hours ago — the case that most needs the surrounding context.
    expect(timelineRangeFor(NOW - 14 * 3600, NOW)).toBe('24h');
  });

  it('keeps a fresh cause tight rather than showing a week of noise', () => {
    expect(timelineRangeFor(NOW - 300, NOW)).toBe('15m');
    expect(timelineRangeFor(NOW - 40 * 60, NOW)).toBe('1h');
  });

  it('widens for an old cause instead of cutting it off', () => {
    expect(timelineRangeFor(NOW - 5 * 86400, NOW)).toBe('7d');
  });

  it('is inclusive at each boundary', () => {
    // A cause exactly 1h old belongs in the 1h window, not the 6h one.
    expect(timelineRangeFor(NOW - 3600, NOW)).toBe('1h');
    expect(timelineRangeFor(NOW - 24 * 3600, NOW)).toBe('24h');
  });

  it('does not go negative on a clock skewed forward', () => {
    // Agent and browser clocks differ; a cause "starting" in the future must
    // not produce a nonsense range.
    expect(timelineRangeFor(NOW + 600, NOW)).toBe('15m');
  });

  it('links from the card with that range', async () => {
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, symptom_count: 2 }]);
    fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: SYMPTOMS });
    render(<EpisodePanel />);
    const link = await screen.findByText(/What else changed/);
    expect(link.closest('a')?.getAttribute('href')).toMatch(/^\/timeline\?range=/);
  });
});

/**
 * An episode card with nothing to do.
 *
 * The card said what was wrong — cause, symptom count, blast radius,
 * recurrence — and then offered "What else changed" and "Dismiss". Look at
 * history, or make it go away. Neither fixes anything.
 *
 * Meanwhile the symptoms underneath got Approve buttons. Actions on the
 * symptoms and none on the cause is exactly backwards, and it is the reason
 * the product's causal model did not reach the operator's hands.
 *
 * Two gates kept the agent out of reach: it rendered inside the investigation
 * block, so it required an investigation to already exist, and the expand
 * control was gated on `symptoms.length > 0`, so an episode explaining nothing
 * had no chevron at all — which is what `ControlPlaneNodeMemoryHigh` looked
 * like on the reference cluster.
 */
describe('an episode card offers a way to act on the cause', () => {
  const EMPTY_EP = { ...EPISODE, id: 'ep-none', cause_title: 'ControlPlaneNodeMemoryHigh', symptom_count: 0, namespaces: [] };

  // The store spies are module-level, so calls accumulate across tests in this
  // block — "not.toHaveBeenCalled" is meaningless without this.
  beforeEach(() => {
    connectAndSend.mockClear();
    expandAISidebar.mockClear();
    setAISidebarMode.mockClear();
  });

  afterEach(cleanup);

  it('offers a fix action even with no symptoms and no investigation', async () => {
    fetchOpenEpisodes.mockResolvedValue([EMPTY_EP]);
    fetchEpisode.mockResolvedValue({ episode: EMPTY_EP, symptoms: [] });
    render(<EpisodePanel />);
    expect(await screen.findByText(/How do I fix this\?/)).toBeDefined();
  });

  it('sends the question to the one chat surface, not a second one', async () => {
    // The card used to embed its own chat while the Pulse AI sidebar sat open
    // beside it with its own input: two places to ask the same question, two
    // connection states, and nothing to say which one to use.
    fetchOpenEpisodes.mockResolvedValue([EMPTY_EP]);
    fetchEpisode.mockResolvedValue({ episode: EMPTY_EP, symptoms: [] });
    render(<EpisodePanel />);
    fireEvent.click(await screen.findByText(/How do I fix this\?/));

    await waitFor(() => expect(connectAndSend).toHaveBeenCalled());
    expect(expandAISidebar).toHaveBeenCalled();
    expect(setAISidebarMode).toHaveBeenCalledWith('chat');
    expect(screen.queryByTestId('inline-agent')).toBeNull();
  });

  it('works on an episode that explains nothing', async () => {
    // Previously impossible: no symptoms meant no chevron, so no way in.
    fetchOpenEpisodes.mockResolvedValue([EMPTY_EP]);
    fetchEpisode.mockResolvedValue({ episode: EMPTY_EP, symptoms: [] });
    render(<EpisodePanel />);
    fireEvent.click(await screen.findByText(/How do I fix this\?/));
    await waitFor(() => expect(connectAndSend).toHaveBeenCalled());
    expect(connectAndSend.mock.calls[0][0]).toContain('ControlPlaneNodeMemoryHigh');
  });

  it('tells the agent which episode is being asked about', async () => {
    fetchOpenEpisodes.mockResolvedValue([EMPTY_EP]);
    fetchEpisode.mockResolvedValue({ episode: EMPTY_EP, symptoms: [] });
    render(<EpisodePanel />);
    fireEvent.click(await screen.findByText(/How do I fix this\?/));
    await waitFor(() => expect(connectAndSend).toHaveBeenCalled());
    expect(connectAndSend.mock.calls[0][1]).toMatchObject({ kind: 'Episode', name: EMPTY_EP.id });
  });

  it('does not start a conversation until asked', async () => {
    fetchOpenEpisodes.mockResolvedValue([EMPTY_EP]);
    fetchEpisode.mockResolvedValue({ episode: EMPTY_EP, symptoms: [] });
    render(<EpisodePanel />);
    await screen.findByText(/How do I fix this\?/);
    expect(connectAndSend).not.toHaveBeenCalled();
  });

  it('never embeds a chat of its own, investigated or not', async () => {
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, symptom_count: 2 }]);
    fetchEpisode.mockResolvedValue({
      episode: EPISODE,
      symptoms: SYMPTOMS,
      investigation: { summary: 'etcd is thrashing', failed: false, recommended_fix: 'add memory' },
    });
    render(<EpisodePanel />);
    await screen.findByText(/How do I fix this\?/);
    expect(screen.queryByTestId('inline-agent')).toBeNull();
  });
});
