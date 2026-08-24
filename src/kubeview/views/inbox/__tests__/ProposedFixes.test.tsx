// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProposedFixes } from '../ProposedFixes';
import { approveFix, fetchFixHistory } from '../../../engine/fixHistory';

vi.mock('../../../engine/fixHistory', () => ({
  fetchFixHistory: vi.fn(),
  approveFix: vi.fn(),
}));

const PROPOSAL = {
  id: 'a-1',
  findingId: 'f-1',
  timestamp: Date.now(),
  category: 'crashloop',
  tool: '',
  input: {},
  status: 'proposed' as const,
  beforeState: '',
  afterState: '',
  reasoning: 'Auto-fix for crashloop: Pod api-7f9 restarting (12x)',
  durationMs: 0,
  rollbackAvailable: false,
  resources: [{ kind: 'Pod', name: 'api-7f9', namespace: 'prod' }],
};

describe('ProposedFixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchFixHistory).mockResolvedValue({ actions: [PROPOSAL], total: 1, page: 1, pageSize: 20 });
    vi.mocked(approveFix).mockResolvedValue({ ...PROPOSAL, status: 'completed', tool: 'delete_pod' });
  });

  afterEach(cleanup);

  it('shows nothing at all when no fix is waiting', async () => {
    vi.mocked(fetchFixHistory).mockResolvedValue({ actions: [], total: 0, page: 1, pageSize: 20 });
    const { container } = render(<ProposedFixes />);
    await waitFor(() => expect(fetchFixHistory).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('asks only for proposals, not the whole fix history', async () => {
    render(<ProposedFixes />);
    await waitFor(() => expect(fetchFixHistory).toHaveBeenCalled());
    expect(vi.mocked(fetchFixHistory).mock.calls[0][0]).toEqual({ filters: { status: 'proposed' } });
  });

  it('says how many are waiting on a person', async () => {
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText(/1 fix waiting on you/)).toBeDefined());
    // What it would do, and what it would do it to.
    expect(screen.getByText(/Auto-fix for crashloop/)).toBeDefined();
    expect(screen.getByText(/Pod api-7f9 · proposed/)).toBeDefined();
  });

  it('approving runs the fix and takes it off the list', async () => {
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(approveFix).toHaveBeenCalledWith('a-1'));
    await waitFor(() => expect(screen.getByText(/Ran delete_pod/)).toBeDefined());
    expect(screen.queryByText('Approve')).toBeNull();
  });

  it('a fix that ran and failed says so rather than reading as success', async () => {
    vi.mocked(approveFix).mockResolvedValue({
      ...PROPOSAL,
      status: 'failed',
      error: 'api server said no',
    });
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText(/Failed: api server said no/)).toBeDefined());
  });

  it('a long failure message is clamped to one line as a layout safety net', async () => {
    // The backend cleans up ApiException text before this ever arrives, but a
    // clamp here means a surprise wall of text can never blow out this row —
    // the full message is still available on hover via title.
    const longMessage =
      'pods "klusterlet-646d4fdd8b-4kz56" is forbidden: User "system:serviceaccount:openshiftpulse:pulse-openshift-sre-agent" cannot delete resource "pods" in API group "" in the namespace "open-cluster-management-agent"';
    vi.mocked(approveFix).mockResolvedValue({ ...PROPOSAL, status: 'failed', error: longMessage });
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    const messageEl = await waitFor(() => screen.getByTitle(`Failed: ${longMessage}`));
    expect(messageEl.className).toContain('truncate');
  });

  it('surfaces a refusal, because the agent refuses on purpose', async () => {
    vi.mocked(approveFix).mockRejectedValue(
      new Error('The condition this was proposed for is no longer being reported — nothing to fix'),
    );
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText(/no longer being reported/)).toBeDefined());
  });

  it('a refusal re-reads the list rather than trusting stale state', async () => {
    vi.mocked(approveFix).mockRejectedValue(new Error('Somebody else just approved this'));
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(vi.mocked(fetchFixHistory).mock.calls.length).toBeGreaterThan(1));
  });

  it('warns when the fix treats a symptom of a known cause', async () => {
    // On the reference cluster all four fixes awaiting approval targeted the
    // exact four pods the same screen called "Explained by the cause above —
    // not separate problems". The Approve button said nothing about it.
    vi.mocked(fetchFixHistory).mockResolvedValue({
      actions: [{ ...PROPOSAL, explainedBy: 'HighOverallControlPlaneMemory' }],
      total: 1, page: 1, pageSize: 20,
    });
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText(/HighOverallControlPlaneMemory/)).toBeDefined());
    expect(screen.getByText(/treats the symptom, not the cause/)).toBeDefined();
  });

  it('still offers the fix — the operator decides, they are just not blind', async () => {
    // Suppressing it would be worse: a stopgap restart is sometimes right.
    vi.mocked(fetchFixHistory).mockResolvedValue({
      actions: [{ ...PROPOSAL, explainedBy: 'HighOverallControlPlaneMemory' }],
      total: 1, page: 1, pageSize: 20,
    });
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
  });

  it('says nothing when no episode explains the finding', async () => {
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    expect(screen.queryByText(/treats the symptom/)).toBeNull();
  });

  it('an agent too old to send the field is not treated as a cause', async () => {
    vi.mocked(fetchFixHistory).mockResolvedValue({
      actions: [{ ...PROPOSAL, explainedBy: undefined }],
      total: 1, page: 1, pageSize: 20,
    });
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    expect(screen.queryByText(/treats the symptom/)).toBeNull();
  });

  it('a list that will not load stays quiet instead of shouting over the inbox', async () => {
    vi.mocked(fetchFixHistory).mockRejectedValue(new Error('network'));
    const { container } = render(<ProposedFixes />);
    await waitFor(() => expect(fetchFixHistory).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
  it('a failed fix never sits under a "Fixes applied" header with a green check', async () => {
    // The reference cluster showed exactly this: an RBAC 403 rendered under
    // "Fixes applied" with a checkmark. The header must name what happened.
    vi.mocked(approveFix).mockResolvedValue({
      ...PROPOSAL,
      status: 'failed',
      error: 'service account cannot delete pods',
    });
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Fix failed')).toBeDefined());
    expect(screen.queryByText('Fixes applied')).toBeNull();
  });

  it('a fix that succeeded still reads "Fixes applied"', async () => {
    render(<ProposedFixes />);
    await waitFor(() => expect(screen.getByText('Approve')).toBeDefined());
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Fixes applied')).toBeDefined());
  });

});
