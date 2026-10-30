// @vitest-environment jsdom
/**
 * The inbox drawer shows saved evidence with its stance. It listed the prose
 * evidence only, so a reloaded investigation showed contradicting evidence as
 * if it supported the cause (the agent now stores evidence_detail, migration 041).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TaskDetailDrawer } from '../TaskDetailDrawer';
import type { InboxItem, InvestigationReport } from '../../../engine/inboxApi';
import { fetchInboxInvestigation } from '../../../engine/inboxApi';

vi.mock('../../../store/inboxStore', () => ({
  useInboxStore: vi.fn((selector) =>
    selector({ resolve: vi.fn(), claim: vi.fn(), dismiss: vi.fn(), restore: vi.fn(), advanceStatus: vi.fn(), refresh: vi.fn(), setSelectedItem: vi.fn() }),
  ),
}));
vi.mock('../../../store/agentStore', () => ({ useAgentStore: { getState: () => ({ connectAndSend: vi.fn() }) } }));
vi.mock('../../../store/uiStore', () => ({
  useUIStore: { getState: () => ({ expandAISidebar: vi.fn(), setAISidebarMode: vi.fn(), addToast: vi.fn(), setActiveTab: vi.fn() }) },
}));
vi.mock('../../../engine/inboxApi', async () => {
  const actual = await vi.importActual('../../../engine/inboxApi');
  return { ...actual, fetchInboxInvestigation: vi.fn() };
});

afterEach(cleanup);

const item = {
  id: 'inb-1', item_type: 'finding', status: 'triaged', title: 'api crashlooping', summary: 's', severity: 'critical',
  priority_score: 2, confidence: 0.8, noise_score: 0, namespace: 'prod', resources: [], correlation_key: null,
  claimed_by: null, claimed_at: null, created_by: 'system:monitor', due_date: null, finding_id: 'f-1', view_id: null,
  pinned_by: [], metadata: { investigation_id: 'i-1', triaged: true }, created_at: 0, updated_at: 0, resolved_at: null, snoozed_until: null,
} as unknown as InboxItem;

const base: InvestigationReport = {
  id: 'i-1', summary: 'DB_HOST missing', suspected_cause: 'DB_HOST removed', recommended_fix: 'restore it', confidence: 0.6,
  evidence: ['Logs: DB_HOST not set', 'Restarts began before the rollout'], alternatives_considered: [],
};

describe('inbox drawer evidence', () => {
  it('shows each saved item with its stance and source', async () => {
    vi.mocked(fetchInboxInvestigation).mockResolvedValue({
      ...base,
      evidence_detail: [
        { observation: 'Logs: DB_HOST not set', kind: 'log', source: 'get_pod_logs', stance: 'supports' },
        { observation: 'Restarts began before the rollout', kind: 'event', source: 'get_events', stance: 'contradicts' },
        { observation: 'Error rate 40%', kind: 'metric', source: '', unverified_source: 'prometheus', stance: 'supports' },
      ],
    });
    render(<TaskDetailDrawer item={item} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Investigation'));
    fireEvent.click(screen.getByText(/Show evidence \(3\)/));
    const row = (text: string) => screen.getByText(text).closest('li') as HTMLElement;
    expect(within(row('Restarts began before the rollout')).getByLabelText('contradicts')).toBeDefined();
    expect(within(row('Logs: DB_HOST not set')).getByText('get_pod_logs')).toBeDefined();
    expect(within(row('Error rate 40%')).getByText(/cites prometheus, which the investigation did not read/)).toBeDefined();
  });

  it('does not mark older prose-only evidence as support', async () => {
    vi.mocked(fetchInboxInvestigation).mockResolvedValue(base);
    render(<TaskDetailDrawer item={item} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Investigation'));
    fireEvent.click(screen.getByText(/Show evidence \(2\)/));
    expect(screen.getAllByLabelText('stance not recorded')).toHaveLength(2);
    expect(screen.queryByLabelText('supports')).toBeNull();
  });
});
