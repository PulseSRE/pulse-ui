// @vitest-environment jsdom
/**
 * Ask Pulse and the open finding on every resource page, not only Pods and
 * workloads: the generic detail layout sets the dock's page context for any
 * kind (cluster-scoped too), shows the Cause card when the monitor has a
 * finding about the resource, and asks kind-specific questions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useK8sListWatch', () => ({ useK8sListWatch: () => ({ data: [], isLoading: false }) }));
vi.mock('../../../hooks/useCanI', () => ({ useCanI: () => ({ allowed: false, isLoading: false }) }));
vi.mock('../KindSections', () => ({ KindSections: () => null }));
vi.mock('../../../components/DataEditor', () => ({ default: () => null }));
const askPulse = vi.fn();
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import { GenericDetailLayout } from '../GenericDetailLayout';
import { ASK_PULSE_PROMPTS, askPulsePromptsFor } from '../askPulsePrompts';
import { useAgentStore } from '../../../store/agentStore';
import { useMonitorStore } from '../../../store/monitorStore';
import { useFleetStore } from '../../../store/fleetStore';

const node = { apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-1', uid: 'u1' }, spec: {}, status: {} };
const configMap = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'app-config', namespace: 'shop', uid: 'u2' }, data: { a: '1' } };

function renderLayout(resource: Record<string, unknown>, opts: { namespace?: string; gvrKey: string; isWorkload?: boolean }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GenericDetailLayout
          resource={resource as never}
          namespace={opts.namespace}
          gvrKey={opts.gvrKey}
          apiPath="/x"
          events={[]}
          managedPods={[]}
          relatedResources={[]}
          isWorkload={opts.isWorkload ?? false}
          metaTarget={{ apiPath: '/x', group: '', plural: 'x' }}
          onSwitchToEvents={vi.fn()}
          go={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nodeFinding = { id: 'n1', severity: 'warning', category: 'node_pressure', title: 'worker-1 has memory pressure', summary: 'MemoryPressure=True', resources: [{ kind: 'Node', name: 'worker-1' }], autoFixable: false, timestamp: Date.now() };

beforeEach(() => {
  askPulse.mockReset();
  useFleetStore.setState({ activeClusterId: 'local' });
  useMonitorStore.setState({ connected: true, connectionError: null, findings: [], dismissedFindingIds: [], investigations: [] });
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as never;
});
afterEach(() => { cleanup(); useAgentStore.getState().setPageContext(null); useFleetStore.setState({ activeClusterId: 'local' }); });

describe('generic detail page', () => {
  it('a cluster-scoped Node sets the dock context (no namespace) and clears it on leave', () => {
    const { unmount } = renderLayout(node, { gvrKey: 'v1/nodes' });
    expect(useAgentStore.getState().pageContext).toEqual({ kind: 'Node', name: 'worker-1', namespace: undefined, gvr: 'v1/nodes' });
    unmount();
    expect(useAgentStore.getState().pageContext).toBeNull();
  });

  it('a namespaced non-workload (ConfigMap) sets the dock context too', () => {
    renderLayout(configMap, { namespace: 'shop', gvrKey: 'v1/configmaps' });
    expect(useAgentStore.getState().pageContext).toMatchObject({ kind: 'ConfigMap', name: 'app-config', namespace: 'shop' });
  });

  it('shows the Cause card for a Node with an open finding', () => {
    useMonitorStore.setState({ findings: [nodeFinding] as never });
    renderLayout(node, { gvrKey: 'v1/nodes' });
    expect(screen.getByRole('heading', { name: 'Pulse found a problem' })).toBeDefined();
    expect(screen.getByText('worker-1 has memory pressure')).toBeDefined();
  });

  it('no Cause card without a finding, or for a finding about another node', () => {
    useMonitorStore.setState({ findings: [{ ...nodeFinding, resources: [{ kind: 'Node', name: 'worker-2' }] }] as never });
    renderLayout(node, { gvrKey: 'v1/nodes' });
    expect(screen.queryByRole('heading', { name: /Pulse found/ })).toBeNull();
    expect(screen.queryByText(/No open monitor finding/)).toBeNull();
  });

  it('asks the kind-specific questions with the resource attached', () => {
    renderLayout(configMap, { namespace: 'shop', gvrKey: 'v1/configmaps' });
    expect(screen.getByRole('heading', { name: 'Ask Pulse about this ConfigMap' })).toBeDefined();
    expect((screen.getByLabelText('Question for Pulse') as HTMLInputElement).placeholder).toBe('Who uses this and what restarts if I change it?');
    fireEvent.click(screen.getByRole('button', { name: 'Who uses this and what restarts if I change it?' }));
    expect(askPulse).toHaveBeenCalledWith('Who uses this and what restarts if I change it?', { kind: 'ConfigMap', name: 'app-config', namespace: 'shop', gvr: 'v1/configmaps' });
  });

  it('on a remote cluster: no finding shown, questions disabled with the local-only note', () => {
    useFleetStore.setState({ activeClusterId: 'remote-1' });
    useMonitorStore.setState({ findings: [nodeFinding] as never });
    renderLayout(node, { gvrKey: 'v1/nodes' });
    expect(screen.queryByRole('heading', { name: /Pulse found/ })).toBeNull();
    const chip = screen.getByRole('button', { name: 'Why is this node unhealthy?' }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(askPulse).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask-pulse-note').textContent).toMatch(/local cluster/i);
  });
});

describe('askPulsePromptsFor', () => {
  it('has one map with the kind-specific questions', () => {
    expect(askPulsePromptsFor('ConfigMap')[0]).toBe('Who uses this and what restarts if I change it?');
    expect(askPulsePromptsFor('Secret')[0]).toBe('Who uses this and what restarts if I change it?');
    expect(askPulsePromptsFor('HorizontalPodAutoscaler')).toEqual(expect.arrayContaining(['Why is this scaled the way it is?', 'Is it maxed out?']));
    expect(askPulsePromptsFor('ClusterOperator')[0]).toBe("Why is this degraded and what's blocking it?");
    expect(askPulsePromptsFor('Node')[0]).toBe('Why is this node unhealthy?');
    expect(askPulsePromptsFor('Route')[0]).toBe("Why can't this be reached?");
    expect(askPulsePromptsFor('Service')[0]).toBe("Why can't this be reached?");
    expect(askPulsePromptsFor('PersistentVolumeClaim')).toEqual(expect.arrayContaining(['Why is this pending?', 'Is it filling up?']));
    expect(askPulsePromptsFor('InstallPlan')[0]).toBe('What does this change?');
  });

  it('falls back to workload questions for workloads and a neutral question otherwise', () => {
    expect(askPulsePromptsFor('StatefulSet')[0]).toBe('Why is this StatefulSet unhealthy?');
    expect(askPulsePromptsFor('StorageClass')[0]).toBe('What is this StorageClass for, and is anything wrong with it?');
  });

  it('returns a copy, so a caller cannot change the map', () => {
    askPulsePromptsFor('Node').push('x');
    expect(ASK_PULSE_PROMPTS.Node).not.toContain('x');
  });
});
