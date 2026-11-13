// @vitest-environment jsdom
/**
 * Inbox "Silence…" (JTBD K2, W4): an item or episode from a firing alert or a
 * monitor finding asks Pulse to propose_silence for it, with the ids as page
 * context, so the chat confirm card (with its "what it would hide" preview)
 * does the write. Disabled with the reason in observe mode and on a remote
 * cluster; absent on items that are neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InboxItem } from '../../../engine/inboxApi';
import { useFleetStore } from '../../../store/fleetStore';
import { useTrustStore } from '../../../store/trustStore';
import { isSilenceable, SILENCE_OBSERVE_REASON, SILENCE_REMOTE_REASON, silencePrompt } from '../SilenceAction';
import { TaskDetailDrawer } from '../TaskDetailDrawer';
import { EpisodePanel } from '../EpisodePanel';

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: MemoryRouter });

const askPulse = vi.hoisted(() => vi.fn());
vi.mock('../../../engine/askPulse', () => ({ askPulse }));

vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector) => selector({
    resolve: vi.fn(), claim: vi.fn(), dismiss: vi.fn(), restore: vi.fn(), advanceStatus: vi.fn(), refresh: vi.fn(), setSelectedItem: vi.fn(),
  })),
}));

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: unknown) => unknown) => selector({ addToast: vi.fn() }), {
    getState: () => ({ expandAISidebar: vi.fn(), setAISidebarMode: vi.fn(), addToast: vi.fn(), setActiveTab: vi.fn() }),
  }),
}));

vi.mock('../../../engine/inboxApi', async () => {
  const actual = await vi.importActual('../../../engine/inboxApi');
  return { ...actual, fetchInboxInvestigation: vi.fn().mockRejectedValue(new Error('not found')) };
});

const fetchOpenEpisodes = vi.hoisted(() => vi.fn());
const fetchEpisode = vi.hoisted(() => vi.fn());
vi.mock('../../../engine/episodeApi', () => ({
  fetchOpenEpisodes: (...a: unknown[]) => fetchOpenEpisodes(...a),
  fetchEpisode: (...a: unknown[]) => fetchEpisode(...a),
  detachSymptom: vi.fn(),
  dismissEpisode: vi.fn(),
  isLikelyRelated: () => false,
}));

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'inb-1',
    item_type: 'task',
    status: 'new',
    title: 'KubeNodeUnreachable',
    summary: '',
    severity: 'warning',
    priority_score: 2,
    confidence: 0.8,
    noise_score: 0,
    namespace: null,
    resources: [{ kind: 'Node', name: 'worker-5', namespace: '' }],
    correlation_key: 'alerts::Node/worker-5',
    claimed_by: null,
    claimed_at: null,
    created_by: 'system:monitor',
    due_date: null,
    finding_id: 'f-77',
    view_id: null,
    pinned_by: [],
    metadata: { investigation_id: 'inv-9' },
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
    resolved_at: null,
    snoozed_until: null,
    ...overrides,
  };
}

const EPISODE = {
  id: 'ep-1', status: 'open' as const, cause_category: 'alerts', cause_title: 'KubeNodeUnreachable', cause_finding_id: 'f-1', cause_layer: 0,
  started_at: Math.floor(Date.now() / 1000) - 600, cause_started_at: null, ended_at: null, last_seen_at: Math.floor(Date.now() / 1000),
  symptom_count: 1, namespaces: ['payments'], correlation_key: 'alerts::Node/worker-5', recurrence_of: null,
};

beforeEach(() => {
  askPulse.mockClear();
  useTrustStore.setState({ trustLevel: 1 });
  useFleetStore.setState({ activeClusterId: 'local' } as never);
  fetchOpenEpisodes.mockResolvedValue([EPISODE]);
  fetchEpisode.mockResolvedValue({ episode: EPISODE, symptoms: [], changes: [], recurrence: null, investigation: null });
});
afterEach(() => { cleanup(); useFleetStore.setState({ activeClusterId: 'local' } as never); });

const silence = () => screen.queryByRole('button', { name: /Silence…/ }) as HTMLButtonElement | null;

describe('isSilenceable / silencePrompt', () => {
  it('is true for monitor findings and firing alerts, false for generator tasks', () => {
    expect(isSilenceable({ finding_id: 'f', correlation_key: null, metadata: {} })).toBe(true);
    expect(isSilenceable({ finding_id: null, correlation_key: 'alerts:payments:Pod/api', metadata: {} })).toBe(true);
    expect(isSilenceable({ finding_id: null, correlation_key: null, metadata: { alertname: 'KubeletDown' } })).toBe(true);
    expect(isSilenceable({ finding_id: null, correlation_key: 'cert_expiry:prod', metadata: { generator: 'cert_expiry' } })).toBe(false);
  });

  it('names propose_silence and the id, and carries no cluster text', () => {
    const p = silencePrompt('inb-1', 'Inbox item');
    expect(p).toContain('propose_silence with finding_id="inb-1"');
    expect(p).toContain('only after I confirm');
  });
});

describe('TaskDetailDrawer Silence…', () => {
  it('asks Pulse to propose a silence for the item, with the finding and investigation ids as context', () => {
    const onClose = vi.fn();
    render(<TaskDetailDrawer item={makeItem()} onClose={onClose} />);
    fireEvent.click(silence()!);
    expect(askPulse).toHaveBeenCalledTimes(1);
    const [prompt, context] = askPulse.mock.calls[0];
    expect(prompt).toContain('finding_id="inb-1"');
    expect(prompt).not.toContain('KubeNodeUnreachable');
    expect(context).toEqual({ kind: 'Node', name: 'worker-5', namespace: undefined, findingId: 'f-77', investigationId: 'inv-9' });
    expect(onClose).toHaveBeenCalled();
  });

  it('is not offered on a generator task, or once the item is resolved', () => {
    render(<TaskDetailDrawer item={makeItem({ finding_id: null, correlation_key: 'cert_expiry:prod', metadata: { generator: 'cert_expiry' } })} onClose={vi.fn()} />);
    expect(silence()).toBeNull();
    cleanup();
    render(<TaskDetailDrawer item={makeItem({ status: 'resolved' })} onClose={vi.fn()} />);
    expect(silence()).toBeNull();
  });

  it('is disabled in observe mode, with the reason, and sends nothing', () => {
    useTrustStore.setState({ trustLevel: 0 });
    render(<TaskDetailDrawer item={makeItem()} onClose={vi.fn()} />);
    expect(silence()!.disabled).toBe(true);
    expect(screen.getByText(SILENCE_OBSERVE_REASON)).toBeTruthy();
    fireEvent.click(silence()!);
    expect(askPulse).not.toHaveBeenCalled();
  });

  it('is disabled on a remote cluster, with the reason, and sends nothing', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' } as never);
    render(<TaskDetailDrawer item={makeItem()} onClose={vi.fn()} />);
    expect(silence()!.disabled).toBe(true);
    expect(screen.getByText(SILENCE_REMOTE_REASON)).toBeTruthy();
    fireEvent.click(silence()!);
    expect(askPulse).not.toHaveBeenCalled();
  });
});

describe('EpisodePanel Silence…', () => {
  it("asks Pulse to propose a silence for the cause's finding, with its id as context", async () => {
    render(<EpisodePanel />);
    await waitFor(() => expect(silence()).not.toBeNull());
    fireEvent.click(silence()!);
    const [prompt, context] = askPulse.mock.calls[0];
    expect(prompt).toContain('monitor finding f-1');
    expect(prompt).toContain('finding_id="f-1"');
    expect(context).toEqual({ kind: 'Episode', name: 'ep-1', namespace: 'payments', findingId: 'f-1' });
  });

  it('is absent when the cause has no finding, and disabled in observe mode', async () => {
    fetchOpenEpisodes.mockResolvedValue([{ ...EPISODE, cause_finding_id: null }]);
    render(<EpisodePanel />);
    await screen.findByTestId('episode-cause-title');
    expect(silence()).toBeNull();
    cleanup();

    fetchOpenEpisodes.mockResolvedValue([EPISODE]);
    useTrustStore.setState({ trustLevel: 0 });
    render(<EpisodePanel />);
    await waitFor(() => expect(silence()).not.toBeNull());
    expect(silence()!.disabled).toBe(true);
    fireEvent.click(silence()!);
    expect(askPulse).not.toHaveBeenCalled();
  });
});
