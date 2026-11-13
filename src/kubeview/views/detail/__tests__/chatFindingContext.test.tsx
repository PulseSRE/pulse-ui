// @vitest-environment jsdom
/**
 * Pass the finding into chat (JTBD Wave 1, item 2): a question asked from a
 * page that shows an open monitor finding carries the finding's and its
 * investigation's ids (never its text), so the agent starts from that
 * investigation. Covered here: the shared helpers, the generic detail page
 * (dock context and Ask Pulse card), the Cause card's "Ask Pulse to fix", the
 * home attention rows and the Inbox drawer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: false, isLoading: false }) }));
vi.mock('../KindSections', () => ({ KindSections: () => null }));
vi.mock('../../../components/DataEditor', () => ({ default: () => null }));
const askPulse = vi.fn();
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import { GenericDetailLayout } from '../GenericDetailLayout';
import { CauseCard } from '../CauseCard';
import { findingRefFor, latestCompletedInvestigation, withFindingRef } from '../../../engine/findingContext';
import { rowContext, rowsFromFindings } from '../../pulse/attention';
import { investigateContext } from '../../inbox/TaskDetailDrawer';
import type { InboxItem } from '../../../engine/inboxApi';
import { useAgentStore } from '../../../store/agentStore';
import { useMonitorStore } from '../../../store/monitorStore';
import { useFleetStore } from '../../../store/fleetStore';

const node = { apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-1', uid: 'u1' }, spec: {}, status: {} };
const now = Date.now();
const nodeFinding = { id: 'n1', severity: 'warning', category: 'node_pressure', title: 'worker-1 has memory pressure', summary: 'MemoryPressure=True', resources: [{ kind: 'Node', name: 'worker-1' }], autoFixable: false, timestamp: now };
const inv = (extra: Record<string, unknown> = {}) => ({
  id: 'inv-2', findingId: 'n1', category: 'node_pressure', status: 'completed', summary: 's', suspectedCause: 'A batch job fills node memory.', confidence: 0.8, timestamp: now, ...extra,
});

function renderNode() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GenericDetailLayout
          resource={node as never}
          namespace={undefined}
          gvrKey="v1/nodes"
          apiPath="/x"
          events={[]}
          managedPods={[]}
          relatedResources={[]}
          isWorkload={false}
          metaTarget={{ apiPath: '/x', group: '', plural: 'x' }}
          onSwitchToEvents={vi.fn()}
          go={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  askPulse.mockReset();
  useFleetStore.setState({ activeClusterId: 'local' });
  useMonitorStore.setState({ connected: true, connectionError: null, findings: [], dismissedFindingIds: [], investigations: [] });
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as never;
});
afterEach(() => { cleanup(); useAgentStore.getState().setPageContext(null); useFleetStore.setState({ activeClusterId: 'local' }); });

describe('findingContext helpers', () => {
  it('picks the newest completed investigation of the finding', () => {
    const list = [inv({ id: 'old', timestamp: now - 10 }), inv({ id: 'failed', status: 'failed', timestamp: now + 10 }), inv({ id: 'other', findingId: 'n2', timestamp: now + 20 }), inv()];
    expect(latestCompletedInvestigation(list as never, 'n1')?.id).toBe('inv-2');
    expect(findingRefFor({ id: 'n1' }, list as never)).toEqual({ findingId: 'n1', investigationId: 'inv-2' });
  });

  it('a finding not investigated yet sends only its id; no finding sends nothing', () => {
    expect(findingRefFor({ id: 'n1' }, [inv({ status: 'failed' })] as never)).toEqual({ findingId: 'n1' });
    expect(findingRefFor(null, [inv()] as never)).toBeUndefined();
  });

  it('attaches only the ids that are set and leaves the context alone otherwise', () => {
    const ctx = { kind: 'Pod', name: 'p', namespace: 'ns' };
    expect(withFindingRef(ctx, undefined)).toBe(ctx);
    expect(withFindingRef(ctx, { findingId: 'f' })).toEqual({ ...ctx, findingId: 'f' });
    expect(withFindingRef(ctx, { investigationId: 'i' })).toEqual({ ...ctx, investigationId: 'i' });
    expect(ctx).toEqual({ kind: 'Pod', name: 'p', namespace: 'ns' });
  });
});

describe('detail page with an open finding', () => {
  it('the dock context and the Ask Pulse card carry the finding and investigation ids', () => {
    useMonitorStore.setState({ findings: [nodeFinding] as never, investigations: [inv()] as never });
    renderNode();
    const expected = { kind: 'Node', name: 'worker-1', namespace: undefined, gvr: 'v1/nodes', findingId: 'n1', investigationId: 'inv-2' };
    expect(useAgentStore.getState().pageContext).toEqual(expected);
    fireEvent.click(screen.getByRole('button', { name: 'Why is this node unhealthy?' }));
    expect(askPulse).toHaveBeenCalledWith('Why is this node unhealthy?', expected);
  });

  it('the dock context picks up the investigation when it arrives', () => {
    useMonitorStore.setState({ findings: [nodeFinding] as never });
    renderNode();
    expect(useAgentStore.getState().pageContext).toMatchObject({ findingId: 'n1' });
    expect(useAgentStore.getState().pageContext?.investigationId).toBeUndefined();
    act(() => { useMonitorStore.setState({ investigations: [inv()] as never }); });
    expect(useAgentStore.getState().pageContext).toMatchObject({ findingId: 'n1', investigationId: 'inv-2' });
  });

  it('a dismissed finding or one about another node adds no ids', () => {
    useMonitorStore.setState({ findings: [nodeFinding, { ...nodeFinding, id: 'n2', resources: [{ kind: 'Node', name: 'worker-2' }] }] as never, dismissedFindingIds: ['n1'], investigations: [inv()] as never });
    renderNode();
    expect(useAgentStore.getState().pageContext).toEqual({ kind: 'Node', name: 'worker-1', namespace: undefined, gvr: 'v1/nodes' });
  });

  it('on a remote cluster the local monitor finding is not attached', () => {
    useFleetStore.setState({ activeClusterId: 'remote-1' });
    useMonitorStore.setState({ findings: [nodeFinding] as never, investigations: [inv()] as never });
    renderNode();
    expect(useAgentStore.getState().pageContext?.findingId).toBeUndefined();
  });
});

describe('Cause card: Ask Pulse to fix', () => {
  const match = { kind: 'Pod', name: 'api-x', namespace: 'payments', owner: { kind: 'Deployment', name: 'api' } };
  const finding = { ...nodeFinding, id: 'f1', resources: [{ kind: 'Deployment', name: 'api', namespace: 'payments' }] };
  const renderCard = () => render(<MemoryRouter><CauseCard match={match} noun="pod" /></MemoryRouter>);

  it('sends the question with the ids of the investigation the card shows', () => {
    useMonitorStore.setState({ findings: [finding] as never, investigations: [inv({ id: 'i1', findingId: 'f1' })] as never });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse to fix' }));
    expect(askPulse).toHaveBeenCalledWith(
      'How do I fix Pod payments/api-x? Start from the investigation you already ran.',
      { kind: 'Pod', name: 'api-x', namespace: 'payments', findingId: 'f1', investigationId: 'i1' },
    );
  });

  it('is not offered before there is a report', () => {
    useMonitorStore.setState({ findings: [finding] as never, investigations: [inv({ id: 'i1', findingId: 'f1', status: 'failed', error: 'timeout' })] as never });
    renderCard();
    expect(screen.queryByRole('button', { name: 'Ask Pulse to fix' })).toBeNull();
  });
});

describe('home attention rows', () => {
  it('a row carries its finding and investigation ids', () => {
    const f = { ...nodeFinding, severity: 'critical', resources: [{ kind: 'Deployment', name: 'web', namespace: 'shop' }] };
    const { rows } = rowsFromFindings([f] as never, [inv()] as never, [], { pods: [], deployments: [], nodes: [], pvcs: [], operators: [] } as never, new Set());
    expect(rows[0].investigationId).toBe('inv-2');
    expect(rowContext(rows[0])).toEqual({ kind: 'Deployment', name: 'web', namespace: 'shop', findingId: 'n1', investigationId: 'inv-2' });
  });

  it('falls back to the Inbox item\'s investigation, and a row without a resource has no context', () => {
    const f = { ...nodeFinding, severity: 'critical' };
    const item = { id: 'inb-1', finding_id: 'n1', resources: [], metadata: { investigation_id: 'inv-inbox', suspected_cause: 'x' } };
    const { rows } = rowsFromFindings([f] as never, [], [item] as never, { pods: [], deployments: [], nodes: [], pvcs: [], operators: [] } as never, new Set());
    expect(rows[0].investigationId).toBe('inv-inbox');
    expect(rowContext({ ...rows[0], resource: undefined })).toBeUndefined();
  });
});

describe('Inbox drawer: Ask Pulse to investigate', () => {
  const item = (over: Partial<InboxItem> = {}) => ({
    id: 'inb-1', finding_id: null, resources: [{ kind: 'Pod', name: 'web-1', namespace: 'shop' }], metadata: {}, ...over,
  }) as InboxItem;

  it('a monitor item sends its finding id and linked investigation', () => {
    expect(investigateContext(item({ finding_id: 'f9', metadata: { investigation_id: 'inv-9' } }))).toEqual({ kind: 'Pod', name: 'web-1', namespace: 'shop', findingId: 'f9', investigationId: 'inv-9' });
  });

  it('an item the monitor did not raise is the investigation\'s finding itself', () => {
    expect(investigateContext(item({ metadata: { investigation_id: 'inv-9' } }))).toEqual({ kind: 'Pod', name: 'web-1', namespace: 'shop', findingId: 'inb-1', investigationId: 'inv-9' });
  });

  it('no investigation: the resource only; no resource: no context', () => {
    expect(investigateContext(item())).toEqual({ kind: 'Pod', name: 'web-1', namespace: 'shop' });
    expect(investigateContext(item({ resources: [] }))).toBeUndefined();
    expect(investigateContext(item({ resources: [{ kind: 'Node', name: 'w', namespace: '' }] }))).toEqual({ kind: 'Node', name: 'w', namespace: undefined });
  });
});
