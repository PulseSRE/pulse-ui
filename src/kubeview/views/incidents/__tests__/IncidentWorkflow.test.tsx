// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncidentLifecycleDrawer } from '../IncidentLifecycleDrawer';
import { useMonitorStore } from '../../../store/monitorStore';
import { useFleetStore } from '../../../store/fleetStore';
import type { ActionReport, VerificationReport } from '../../../engine/monitorClient';

vi.mock('../../../engine/analyticsApi', () => ({ fetchConfidenceCalibration: async () => null }));
const action: ActionReport = { id: 'action-new', findingId: 'finding-1', tool: 'restart_deployment', input: { name: 'web', namespace: 'prod' }, status: 'completed', timestamp: 1000 };
let postmortems: unknown[];
let denyImpact: boolean;
let clients: QueryClient[];

beforeEach(() => {
  clients = []; postmortems = []; denyImpact = false;
  useFleetStore.setState({ activeClusterId: 'local' });
  useMonitorStore.setState({ findings: [{ id: 'finding-1', severity: 'warning', category: 'crashloop', title: 'Web container repeatedly exits', summary: 'Scanner reported repeated restarts', resources: [{ kind: 'Pod', name: 'web-1', namespace: 'prod' }], autoFixable: true, timestamp: 1000 }], investigations: [{ id: 'investigation-1', findingId: 'finding-1', category: 'crashloop', status: 'completed', summary: 'Investigated', suspectedCause: 'Configuration might be invalid', evidence: ['Previous logs report missing configuration'], recommendedFix: 'Check the referenced configuration', alternativesConsidered: ['Dependency unavailable'], timestamp: 1001 }], pendingActions: [], recentActions: [action], verifications: [] });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/impact')) return denyImpact ? { ok: false, status: 403 } : { ok: false, status: 404 };
    if (url.includes('/learning')) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ postmortems }) };
  }));
});
afterEach(() => { cleanup(); clients.forEach(c => c.clear()); vi.unstubAllGlobals(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><IncidentLifecycleDrawer findingId="finding-1" onClose={vi.fn()} /></QueryClientProvider>);
}
function report(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return { id: 'verification-1', actionId: action.id, findingId: action.findingId, status: 'verified', evidence: 'All selected pods Ready after restart', timestamp: 2000, ...overrides };
}

describe('incident evidence and recovery workflow', () => {
  it.each(['crashloop', 'failed_rollout', 'pending_pods'])('shows resource, cluster and hypothesis context for %s', category => {
    useMonitorStore.setState(s => ({ findings: s.findings.map(f => ({ ...f, category })) }));
    useFleetStore.setState({ activeClusterId: 'remote-b' });
    mount();
    expect(screen.getByText('finding-1')).toBeDefined();
    expect(screen.getByText(/Pod\/web-1 in namespace prod/)).toBeDefined();
    expect(screen.getByText(/agent deployment cluster/, { selector: 'dd' })).toBeDefined();
    expect(screen.getByText(/not the selected fleet cluster/)).toBeDefined();
    expect(screen.getByText('Hypothesis — not a confirmed cause')).toBeDefined();
    expect(screen.getByText('Agent-reported evidence')).toBeDefined();
    expect(screen.getByText('Recommendation only; no execution is implied.')).toBeDefined();
    expect(screen.getByText('Recovery not confirmed')).toBeDefined();
    expect(screen.getByText(/action completed. Recovery is a separate/)).toBeDefined();
  });

  it('does not reuse a previous action verdict or a same-category postmortem', async () => {
    useMonitorStore.setState({ verifications: [report({ actionId: 'action-old' })] });
    postmortems = [{ id: 'pm-unrelated', incident_type: 'crashloop', plan_id: '', root_cause: 'Unrelated incident cause', prevention: [] }];
    mount();
    await waitFor(() => expect(clients[0].getQueryData(['postmortems'])).toHaveLength(1));
    expect(screen.getByText('Recovery not confirmed')).toBeDefined();
    expect(screen.queryByText('Unrelated incident cause')).toBeNull();
    expect(screen.queryByText('Recovery verified by agent check')).toBeNull();
  });

  it('joins recovery to its exact action and downgrades a later recurrence with a different finding ID', () => {
    useMonitorStore.setState({ verifications: [report()] }); mount();
    expect(screen.getByText('Recovery verified by agent check')).toBeDefined();
    act(() => useMonitorStore.setState({ verifications: [report(), report({ id: 'recurrence', findingId: 'finding-2', status: 'verified_then_recurred', evidence: 'Same condition returned', timestamp: 3000 })] }));
    expect(screen.getByText('Condition returned after verification')).toBeDefined();
    expect(screen.queryByText('Recovery verified by agent check')).toBeNull();
  });

  it.each(['improved', 'unverifiable', 'still_failing'] as const)('never reports %s as recovery', status => {
    useMonitorStore.setState({ verifications: [report({ status })] }); mount();
    expect(screen.queryByText('Recovery verified by agent check')).toBeNull();
    expect(screen.getByText('All selected pods Ready after restart')).toBeDefined();
  });

  it('requires reported evidence even when the backend verdict says verified', () => {
    useMonitorStore.setState({ verifications: [report({ evidence: ' ' })] }); mount();
    expect(screen.getByText('Recovery not confirmed')).toBeDefined();
    expect(screen.getByText('No recovery evidence reported for this action.')).toBeDefined();
    expect(screen.queryByText('Recovery verified by agent check')).toBeNull();
  });

  it('uses a newer action-embedded recurrence instead of an older stream verdict', () => {
    useMonitorStore.setState({ recentActions: [{ ...action, verificationStatus: 'verified_then_recurred', verificationEvidence: 'Recurring restart', verificationTimestamp: 3000 }], verifications: [report()] }); mount();
    expect(screen.getByText('Condition returned after verification')).toBeDefined();
    expect(screen.getByText('Recurring restart')).toBeDefined();
  });

  it('shows the exact incident postmortem without treating its assessment as observed cause', async () => {
    postmortems = [{ id: 'pm-finding-1', incident_type: 'crashloop', plan_id: 'shared-template', root_cause: 'Configuration issue assessed by agent', prevention: [] }]; mount();
    expect(await screen.findByText('Configuration issue assessed by agent')).toBeDefined();
    expect(screen.getByText('Postmortem cause assessment')).toBeDefined();
    expect(screen.getByText('Recovery not confirmed')).toBeDefined();
  });

  it.each(['proposed', 'expired', 'rolled_back', 'failed'] as const)('does not convert %s execution into verified recovery', status => {
    useMonitorStore.setState({ recentActions: [{ ...action, status }], verifications: [report()] }); mount();
    expect(screen.queryByText('Recovery verified by agent check')).toBeNull();
    if (status === 'proposed') expect(screen.getByText('Awaiting approval; this action has not executed.')).toBeDefined();
    if (status === 'expired') expect(screen.getByText('Approval expired; this proposal did not execute.')).toBeDefined();
    if (status === 'rolled_back') expect(screen.getByText('Recovery not confirmed after rollback')).toBeDefined();
  });

  it('does not claim recovery from a report without its action record', () => {
    useMonitorStore.setState({ recentActions: [], verifications: [report()] }); mount();
    expect(screen.getByText('Recovery not confirmed')).toBeDefined();
    expect(screen.queryByText('Recovery verified by agent check')).toBeNull();
  });

  it('keeps keyboard focus in the drawer and restores it when closed', () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    const { unmount } = mount();
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(document.activeElement?.tagName).toBe('SUMMARY');
    unmount(); expect(document.activeElement).toBe(opener); opener.remove();
  });

  it('reports failed context requests and lets the operator refresh', async () => {
    denyImpact = true; mount();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Incident data unavailable (403)');
    denyImpact = false; fireEvent.click(screen.getByText('Refresh incident context'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
