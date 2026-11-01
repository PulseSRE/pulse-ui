// @vitest-environment jsdom
/**
 * Wave 9a, infrastructure pages: Workloads, Builds, Networking, Compute
 * (machines, autoscaling, health checks, capacity), Storage (CSI drivers,
 * snapshots), the shared audit panel and workload logs — rendered with their
 * reads really failing (403 and 500). A failed read must show the error or
 * "unknown", never "none", 0, a green dot or a passing audit check.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, cleanup, waitFor, render, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

vi.mock('../engine/watch', () => ({ watchManager: { watch: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../hooks/useNavigateTab', () => ({ useNavigateTab: () => vi.fn() }));
vi.mock('../components/metrics/Sparkline', () => ({
  MetricCard: ({ title, query }: { title: string; query: string }) => <div data-testid="metric-card" data-query={query}>{title}</div>,
  Sparkline: () => <div />,
}));

import { mockFetchRoutes, renderWithClient, renderWithFailedRequests, expectNoAllClear } from './helpers/honestStates';
import { HealthAuditPanel } from '../components/audit/HealthAuditPanel';
import type { AuditCheck } from '../components/audit/types';
import WorkloadsView from '../views/WorkloadsView';
import BuildsView from '../views/BuildsView';
import NetworkingView from '../views/NetworkingView';
import ComputeView from '../views/ComputeView';
import StorageView from '../views/StorageView';
import LogsView from '../views/LogsView';
import { CapacityTab } from '../views/compute/CapacityTab';
import { IncidentContext } from '../views/detail/IncidentContext';

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const STATUSES = [403, 500] as const;
const list = (items: unknown[]) => ({ body: { kind: 'List', items } });

/** The audit row (title + status line) for a check. */
function auditRow(title: string) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-audit-outcome]'));
  const row = rows.find((r) => r.querySelector('span.text-sm')?.textContent === title);
  if (!row) throw new Error(`no audit row "${title}" in ${rows.map((r) => r.querySelector('span.text-sm')?.textContent).join(', ')}; page: ${document.body.textContent?.slice(0, 1500)}`);
  return row;
}

function card(label: string) {
  // Stat cards: the label's nearest card container.
  return screen.getAllByText(label).map((el) => el.closest('button, .p-3')).find(Boolean) as HTMLElement;
}

// ---------------------------------------------------------------------------

describe('HealthAuditPanel', () => {
  const base = { description: 'd', why: 'w', yamlExample: 'y' };

  it('never counts an empty or unreadable check as a pass', () => {
    const checks: AuditCheck[] = [
      { ...base, id: 'a', title: 'Passing check', passing: [{ name: 'x' }], failing: [] },
      { ...base, id: 'b', title: 'Empty check', passing: [], failing: [] },
      { ...base, id: 'c', title: 'Unreadable check', passing: [], failing: [], state: 'unknown', stateReason: 'Routes could not be read' },
      { ...base, id: 'd', title: 'N/A check', passing: [], failing: [], state: 'notApplicable', stateReason: 'no multi-replica Deployments' },
    ];
    render(<HealthAuditPanel checks={checks} title="Audit" />);
    expect(auditRow('Passing check').dataset.auditOutcome).toBe('pass');
    expect(auditRow('Empty check').dataset.auditOutcome).toBe('notApplicable');
    expect(auditRow('Empty check').textContent).toMatch(/Not applicable — nothing to check/);
    expect(auditRow('Unreadable check').dataset.auditOutcome).toBe('unknown');
    expect(auditRow('Unreadable check').textContent).toMatch(/Could not check — Routes could not be read/);
    expect(within(auditRow('Unreadable check')).getByLabelText('Unknown')).toBeTruthy();
    expect(auditRow('N/A check').textContent).toMatch(/Not applicable — no multi-replica Deployments/);
    // Only the one answered check is scored.
    expect(screen.getByText(/1\/1 passing/)).toBeTruthy();
    expect(screen.getByText(/1 could not be checked/)).toBeTruthy();
    // No green pass icon on the empty or unknown rows.
    for (const t of ['Empty check', 'Unreadable check', 'N/A check']) {
      expect(within(auditRow(t)).queryByLabelText('pass'), t).toBeNull();
      expect(auditRow(t).textContent, t).not.toMatch(/\bpass\b/);
    }
  });

  it('shows "—", not 100%, when no check could be answered', () => {
    render(<HealthAuditPanel title="Audit" checks={[{ ...base, id: 'c', title: 'Unreadable', passing: [], failing: [], state: 'unknown' }]} />);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText(/Nothing checked/)).toBeTruthy();
  });

  it('hides the passing list of an unknown check (it was computed from nothing)', () => {
    render(<HealthAuditPanel title="Audit" checks={[{ ...base, id: 'c', title: 'Unreadable', passing: [{ name: 'stale' }], failing: [], state: 'unknown' }]} />);
    screen.getByText('Unreadable').closest('button')!.click();
    return waitFor(() => {
      expect(screen.getByText('w')).toBeTruthy();
      expect(screen.queryByText('stale')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------

describe.each(STATUSES)('WorkloadsView with every list failing (%i)', (status) => {
  it('shows the error and "—" counts — no green dots, no "No StatefulSets", no audit pass', async () => {
    renderWithFailedRequests(<WorkloadsView />, { status });
    await waitFor(() => expect(screen.getByText('Deployments, StatefulSets, DaemonSets, Pods, Jobs, CronJobs could not be loaded')).toBeTruthy());
    for (const label of ['Deployments', 'StatefulSets', 'DaemonSets', 'Pods', 'Jobs', 'CronJobs']) {
      const stat = screen.getAllByText(label).map((el) => el.closest('button')).find((b) => b && b.className.includes('rounded-lg'))!;
      expect(stat.textContent, label).toContain('—');
      expect(stat.textContent, label).not.toMatch(/\b0\b/);
    }
    expect(screen.queryAllByLabelText('healthy')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/No StatefulSets|No deployments|No DaemonSets|No CronJobs|No Jobs/);
    expect(screen.getByText('StatefulSets could not be loaded')).toBeTruthy();
    // Audit: every check unknown, nothing passing.
    await waitFor(() => expect(auditRow('Liveness Probes').dataset.auditOutcome).toBe('unknown'));
    expect(auditRow('PodDisruptionBudgets').dataset.auditOutcome).toBe('unknown');
    expect(document.querySelectorAll('[data-audit-outcome="pass"]')).toHaveLength(0);
    expect(screen.getByText(/Pod status unknown/)).toBeTruthy();
    expectNoAllClear();
  });
});

describe('WorkloadsView happy path', () => {
  it('shows real counts, the healthy dot and a passing audit', async () => {
    const dep = {
      metadata: { name: 'api', namespace: 'shop', uid: 'd1' },
      spec: { replicas: 2, selector: { matchLabels: { app: 'api' } }, template: { spec: { containers: [{ name: 'api', livenessProbe: {}, readinessProbe: {}, resources: { requests: { cpu: '1' }, limits: { memory: '1Gi' } } }] } } },
      status: { replicas: 2, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 2, conditions: [{ type: 'Available', status: 'True' }] },
    };
    mockFetchRoutes({
      '/apis/apps/v1/deployments': list([dep]),
      '/apis/apps/v1/statefulsets': list([]),
      '/apis/apps/v1/daemonsets': list([]),
      '/api/v1/pods': list([]),
      '/apis/batch/v1/jobs': list([]),
      '/apis/batch/v1/cronjobs': list([]),
      '/apis/policy/v1/poddisruptionbudgets': list([]),
    });
    renderWithClient(<WorkloadsView />);
    await waitFor(() => expect(auditRow('Liveness Probes').dataset.auditOutcome).toBe('pass'));
    expect(screen.getByText('No StatefulSets')).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
    expect(screen.getAllByLabelText('healthy').length).toBeGreaterThan(0);
    // 2 replicas, no PDB: the PDB check is answered, and fails.
    expect(auditRow('PodDisruptionBudgets').dataset.auditOutcome).toBe('fail');
  });
});

// ---------------------------------------------------------------------------

describe.each(STATUSES)('BuildsView with its lists failing (%i)', (status) => {
  it('shows errors and "—", never "No builds" or 0', async () => {
    renderWithFailedRequests(<BuildsView />, { status });
    await waitFor(() => expect(screen.getByText('Builds could not be loaded')).toBeTruthy());
    expect(screen.getByText('BuildConfigs could not be loaded')).toBeTruthy();
    expect(screen.getByText('ImageStreams could not be loaded')).toBeTruthy();
    for (const label of ['BuildConfigs', 'Builds', 'ImageStreams', 'Image Tags']) {
      const stat = screen.getAllByText(label).find((el) => el.className.includes('text-xs'))!.closest('button, .p-3')!;
      expect(stat.textContent, label).toContain('—');
    }
    expect(document.body.textContent).not.toMatch(/No builds|No BuildConfigs|No ImageStreams/);
    expectNoAllClear();
  });
});

describe('BuildsView happy path', () => {
  it('shows the empty states when the reads succeed with nothing', async () => {
    mockFetchRoutes({
      '/apis/build.openshift.io/v1/builds': list([]),
      '/apis/build.openshift.io/v1/buildconfigs': list([]),
      '/apis/image.openshift.io/v1/imagestreams': list([]),
    });
    renderWithClient(<BuildsView />);
    await waitFor(() => expect(screen.getByText('No builds')).toBeTruthy());
    expect(screen.getByText('No BuildConfigs')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe.each(STATUSES)('NetworkingView with its reads failing (%i)', (status) => {
  it('does not warn "no network policies", and the audit is unknown, not passing', async () => {
    renderWithFailedRequests(<NetworkingView />, { status });
    await waitFor(() => expect(screen.getByText('Services, Ingresses, Routes, NetworkPolicies, Endpoints could not be loaded')).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/No network policies configured|None yet|No exposed endpoints|No services/);
    for (const label of ['Services', 'Routes', 'Ingresses', 'Network Policies', 'Endpoints']) {
      expect(card(label).textContent, label).toContain('—');
    }
    await waitFor(() => expect(auditRow('Ingress Controller Health').dataset.auditOutcome).toBe('unknown'));
    for (const t of ['TLS on Routes', 'Network Policies', 'Avoid NodePort Services', 'Route Admission', 'Egress Network Policies']) {
      expect(auditRow(t).dataset.auditOutcome, t).toBe('unknown');
    }
    expect(screen.getByText('IngressControllers could not be loaded')).toBeTruthy();
    expectNoAllClear();
  });
});

describe('NetworkingView happy path', () => {
  it('warns about missing network policies only after reading them, and a missing IngressController API is not applicable', async () => {
    mockFetchRoutes({
      '/api/v1/services': list([{ metadata: { name: 'web', namespace: 'shop', uid: 's1' }, spec: { type: 'ClusterIP' } }]),
      '/apis/networking.k8s.io/v1/ingresses': list([]),
      '/apis/route.openshift.io/v1/routes': list([]),
      '/apis/networking.k8s.io/v1/networkpolicies': list([]),
      '/api/v1/endpoints': list([]),
      'ingresscontrollers': { status: 404, body: { code: 404 } },
    });
    renderWithClient(<NetworkingView />);
    await waitFor(() => expect(screen.getByText('No network policies configured — all pod traffic is unrestricted')).toBeTruthy());
    expect(auditRow('Network Policies').dataset.auditOutcome).toBe('fail');
    expect(auditRow('Ingress Controller Health').dataset.auditOutcome).toBe('notApplicable');
    expect(auditRow('Avoid NodePort Services').dataset.auditOutcome).toBe('pass');
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe.each(STATUSES)('ComputeView with its reads failing (%i)', (status) => {
  it('shows errors and unknown checks, never "not configured" or 0/0 nodes', async () => {
    renderWithFailedRequests(<ComputeView />, { status });
    await waitFor(() => expect(screen.getByText('Nodes and Pods could not be loaded')).toBeTruthy());
    const nodesCard = screen.getByText('Nodes').closest('button, div.rounded-lg, div')!.parentElement!;
    expect(nodesCard.textContent).toContain('—');
    expect(document.body.textContent).not.toMatch(/0\/0/);
    await waitFor(() => expect(screen.getByText('MachineHealthChecks could not be loaded')).toBeTruthy());
    expect(screen.getByText('Machines could not be loaded')).toBeTruthy();
    expect(screen.getByText('MachineSets could not be loaded')).toBeTruthy();
    expect(screen.getByText('ClusterAutoscalers and MachineAutoscalers could not be loaded')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/No health checks configured|Autoscaling is not configured|No MachineHealthChecks configured|Autoscaling not configured|No Machines|No MachineSets/);
    expect(auditRow('MachineHealthChecks').dataset.auditOutcome).toBe('unknown');
    expect(auditRow('Cluster Autoscaling').dataset.auditOutcome).toBe('unknown');
    expect(auditRow('HA Control Plane').dataset.auditOutcome).toBe('unknown');
    expect(document.querySelectorAll('[data-audit-outcome="pass"], [data-audit-outcome="fail"]')).toHaveLength(0);
    expectNoAllClear();
  });
});

describe('ComputeView happy path', () => {
  it('reports no health checks and no autoscaling only after reading them', async () => {
    const node = (name: string, role: string) => ({
      metadata: { name, uid: name, labels: { [`node-role.kubernetes.io/${role}`]: '' } },
      status: { conditions: [{ type: 'Ready', status: 'True' }], capacity: { cpu: '4', memory: '16Gi', pods: '110' }, allocatable: { pods: '110' }, nodeInfo: { kubeletVersion: 'v1.30.0' } },
    });
    mockFetchRoutes({
      '/api/v1/nodes': list([node('m1', 'master'), node('m2', 'master'), node('m3', 'master'), node('w1', 'worker'), node('w2', 'worker')]),
      '/api/v1/pods': list([]),
      '/machine.openshift.io/v1beta1/machines': list([]),
      '/machine.openshift.io/v1beta1/machinesets': list([]),
      '/machine.openshift.io/v1beta1/machinehealthchecks': list([]),
      '/autoscaling.openshift.io/v1beta1/machineautoscalers': list([]),
      '/autoscaling.openshift.io/v1/clusterautoscalers': list([]),
    });
    renderWithClient(<ComputeView />);
    await waitFor(() => expect(auditRow('MachineHealthChecks').dataset.auditOutcome).toBe('fail'));
    expect(screen.getByText('No health checks configured')).toBeTruthy();
    expect(screen.getByText('Autoscaling is not configured')).toBeTruthy();
    expect(auditRow('HA Control Plane').dataset.auditOutcome).toBe('pass');
    expect(screen.queryByText(/Nodes and Pods could not be loaded|could not be loaded/)).toBeNull();
  });
});

describe('CapacityTab', () => {
  it.each(STATUSES)('says a failed Prometheus query is unknown, with the reason (%i)', async (status) => {
    renderWithFailedRequests(<CapacityTab />, { status });
    await waitFor(() => expect(screen.getAllByText('Unknown')).toHaveLength(4));
    expect(screen.getAllByText(/Prometheus query failed/)).toHaveLength(4);
    expect(screen.queryByText('Stable')).toBeNull();
    expect(screen.queryByText('No data')).toBeNull();
  });

  it('says why there is no data when Prometheus answers with no series', async () => {
    mockFetchRoutes({ '/api/prometheus': { body: { status: 'success', data: { resultType: 'vector', result: [] } } } });
    renderWithClient(<CapacityTab />);
    await waitFor(() => expect(screen.getAllByText('No data')).toHaveLength(4));
    expect(screen.getAllByText('Prometheus returned no usage series')).toHaveLength(4);
    expect(screen.queryByText('Stable')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe.each(STATUSES)('StorageView CSI drivers and snapshots failing (%i)', (status) => {
  it('shows errors, not "No CSI drivers found" or "VolumeSnapshot CRDs not installed"', async () => {
    renderWithFailedRequests(<StorageView />, {
      status,
      routes: {
        '/apis/storage.k8s.io/v1/storageclasses': list([{ metadata: { name: 'gp3', uid: 'sc1', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }, provisioner: 'ebs' }]),
        '/api/v1/persistentvolumeclaims': list([]),
        '/api/v1/persistentvolumes': list([]),
      },
    });
    await waitFor(() => expect(screen.getByText('CSI drivers could not be loaded')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('VolumeSnapshots could not be loaded')).toBeTruthy());
    expect(screen.queryByText('No CSI drivers found')).toBeNull();
    await waitFor(() => expect(auditRow('Volume Snapshot Support').dataset.auditOutcome).toBe('unknown'));
    expect(document.body.textContent).not.toMatch(/VolumeSnapshot CRDs not installed/);
  });
});

describe('StorageView CSI drivers and snapshots happy path', () => {
  it('reports no CSI drivers and no snapshot support when the reads succeed empty', async () => {
    mockFetchRoutes({
      '/apis/storage.k8s.io/v1/storageclasses': list([{ metadata: { name: 'gp3', uid: 'sc1', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }, provisioner: 'ebs' }]),
      '/api/v1/persistentvolumeclaims': list([]),
      '/api/v1/persistentvolumes': list([]),
      '/apis/storage.k8s.io/v1/csidrivers': list([]),
      '/volumesnapshots': list([]),
      '/volumesnapshotclasses': list([]),
      '/api/v1/resourcequotas': list([]),
    });
    renderWithClient(<StorageView />);
    await waitFor(() => expect(screen.getByText('No CSI drivers found')).toBeTruthy());
    await waitFor(() => expect(auditRow('Volume Snapshot Support').dataset.auditOutcome).toBe('fail'));
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('Workload logs pod list', () => {
  const route = '/logs/shop/api?selector=app%3Dapi&kind=Deployment';
  const ui = <Routes><Route path="/logs/:ns/:name" element={<LogsView namespace="shop" podName="api" />} /></Routes>;

  it.each(STATUSES)('shows the error, not "No pods found", when the pod list fails (%i)', async (status) => {
    renderWithFailedRequests(ui, { status, route });
    await waitFor(() => expect(screen.getByText('Could not list the pods of Deployment api')).toBeTruthy());
    expect(screen.queryByText('No pods found')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows "No pods found" when the list succeeds empty', async () => {
    mockFetchRoutes({ '/api/v1/namespaces/shop/pods': list([]) });
    renderWithClient(ui, { route });
    await waitFor(() => expect(screen.getByText('No pods found')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('IncidentContext resource usage', () => {
  const pod = (name: string, crash = false) => ({
    apiVersion: 'v1', kind: 'Pod',
    metadata: { name, namespace: 'shop', uid: name },
    spec: { containers: [{ name: 'api' }] },
    status: { phase: 'Running', containerStatuses: [{ name: 'api', ready: !crash, restartCount: crash ? 9 : 0, state: crash ? { waiting: { reason: 'CrashLoopBackOff' } } : { running: {} } }] },
  });

  it("scopes a workload's CPU and memory to its own pods, not the namespace", async () => {
    mockFetchRoutes({}, 404);
    const deploy = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'shop', uid: 'd1' } };
    renderWithClient(
      <IncidentContext resource={deploy as never} managedPods={[pod('api-1', true), pod('api-2')] as never} events={[]} namespace="shop" go={vi.fn()} />,
    );
    const cards = await screen.findAllByTestId('metric-card');
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      const q = c.getAttribute('data-query')!;
      expect(q).toContain('namespace="shop",pod=~"api-1|api-2"');
    }
    expect(screen.getByText(/2 pods of this Deployment/)).toBeTruthy();
  });

  it('scopes a pod to itself', async () => {
    mockFetchRoutes({}, 404);
    renderWithClient(<IncidentContext resource={pod('api-1') as never} managedPods={[]} events={[]} namespace="shop" go={vi.fn()} />);
    const cards = await screen.findAllByTestId('metric-card');
    for (const c of cards) expect(c.getAttribute('data-query')).toContain('namespace="shop",pod="api-1"');
  });
});
