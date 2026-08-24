// @vitest-environment jsdom
/**
 * The About page answers "what exactly is running on this cluster" from the
 * cluster itself: the OpenShiftPulse CR (images, health, config), the
 * operator's CSV, and the agent's /version endpoint. Only the console's own
 * build version is baked in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../engine/query', () => ({ k8sList: vi.fn() }));
vi.mock('../../engine/safeQuery', () => ({ agentFetch: vi.fn() }));

import { k8sList } from '../../engine/query';
import { agentFetch } from '../../engine/safeQuery';
import AboutView from '../AboutView';

const CR = {
  metadata: { namespace: 'openshiftpulse' },
  spec: {
    agent: {
      image: 'quay.io/amobrem/pulse-agent:v2.22.1',
      trustLevel: 2,
      allowWriteOperations: true,
      adminUsers: 'kube:admin',
      mcp: { enabled: true },
    },
    ui: { image: 'quay.io/amobrem/openshiftpulse:v2.21.1', replicas: 2 },
    monitoring: { enabled: true },
    vertexAI: { projectId: 'my-project', region: 'global' },
  },
  status: {
    phase: 'Ready',
    agentHealthy: true,
    agentVersion: 'v2.22.1',
    databaseReady: true,
    uiAvailable: true,
    routeHost: 'pulse.apps.example.com',
  },
};

const CSV = {
  metadata: { name: 'pulse-operator.v0.4.2' },
  spec: { version: '0.4.2' },
  status: { phase: 'Succeeded' },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AboutView />
    </QueryClientProvider>
  );
}

describe('AboutView', () => {
  beforeEach(() => {
    vi.mocked(k8sList).mockImplementation(async (path: string) => {
      if (path.includes('openshiftpulses')) return [CR];
      if (path.includes('clusterserviceversions')) return [CSV];
      return [];
    });
    vi.mocked(agentFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ protocol: 2, agent: 'v2.22.1', tools: 105, skills: 8 }),
    } as unknown as Response);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows every component with the version the cluster reports', async () => {
    renderPage();
    // The row names are static; the versions arrive with the queries — wait
    // on a version, not a label, or the assertions race the fetch.
    await waitFor(() => expect(screen.getByText('v2.22.1')).toBeDefined());
    await waitFor(() => expect(screen.getByText('v0.4.2')).toBeDefined());
    expect(screen.getByText('Pulse Operator')).toBeDefined();
    expect(screen.getByText('PostgreSQL')).toBeDefined();
  });

  it('shows the exact image references so an operator can copy them', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('quay.io/amobrem/pulse-agent:v2.22.1')).toBeDefined()
    );
    expect(screen.getByText('quay.io/amobrem/openshiftpulse:v2.21.1')).toBeDefined();
  });

  it('links each component to its source at the running tag', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Source at v2.22.1')).toBeDefined());
    const link = screen.getByText('Source at v2.22.1').closest('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/PulseSRE/pulse-agent/tree/v2.22.1');
  });

  it('states the write-operations posture in plain words', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Write operations enabled/)).toBeDefined());
  });

  it('says diagnose-only when write operations are off', async () => {
    const readOnly = {
      ...CR,
      spec: { ...CR.spec, agent: { ...CR.spec.agent, allowWriteOperations: false } },
    };
    vi.mocked(k8sList).mockImplementation(async (path: string) =>
      path.includes('openshiftpulses') ? [readOnly] : [CSV]
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/Write operations disabled/)).toBeDefined());
    expect(screen.getByText(/diagnose-only/)).toBeDefined();
  });

  it('summarizes the agent runtime from its /version endpoint', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Protocol v2 · 105 tools · 8 skills/)).toBeDefined());
  });

  it('survives a cluster that will not answer', async () => {
    vi.mocked(k8sList).mockRejectedValue(new Error('forbidden'));
    vi.mocked(agentFetch).mockRejectedValue(new Error('agent offline'));
    renderPage();
    // The page still renders its skeleton — the console's own version is the
    // one fact that needs no cluster.
    await waitFor(() => expect(screen.getByText('Console (this UI)')).toBeDefined());
    expect(screen.getByText('Project links')).toBeDefined();
  });
});

describe('AboutView upgrade banner', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function mockUpgrading() {
    const upgradingCR = {
      ...CR,
      spec: { ...CR.spec, agent: { ...CR.spec.agent, image: 'quay.io/amobrem/pulse-agent:v2.23.0' } },
      status: {
        ...CR.status,
        phase: 'Upgrading',
        upgradeStartedAt: new Date(Date.now() - 30_000).toISOString(),
        lastHealthyAgentImage: 'quay.io/amobrem/pulse-agent:v2.22.1',
        lastHealthyUIImage: 'quay.io/amobrem/openshiftpulse:v2.21.1',
        lastUpgradeDurationSeconds: 95,
      },
    };
    const rollingDeploy = {
      metadata: { name: 'pulse-openshift-sre-agent' },
      spec: { replicas: 1 },
      status: { replicas: 1, updatedReplicas: 0, readyReplicas: 0 },
    };
    vi.mocked(k8sList).mockImplementation(async (path: string) => {
      if (path.includes('openshiftpulses')) return [upgradingCR];
      if (path.includes('clusterserviceversions')) return [CSV];
      if (path.includes('/deployments')) return [rollingDeploy];
      return [];
    });
    vi.mocked(agentFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ protocol: 2, agent: 'v2.22.1', tools: 105, skills: 8 }),
    } as unknown as Response);
  }

  it('shows what is moving from where to where, with rollout progress', async () => {
    mockUpgrading();
    renderPage();
    await waitFor(() => expect(screen.getByText('Update in progress')).toBeDefined());
    expect(screen.getByText(/agent v2\.22\.1 → v2\.23\.0/)).toBeDefined();
    // JSX interpolation splits these lines into several text nodes — match
    // on the whole element's textContent instead.
    await waitFor(() =>
      expect(
        screen.getAllByText(
          (_, el) => el?.textContent === 'pulse-openshift-sre-agent: 0/1 updated, 0 ready' && el?.tagName === 'DIV'
        ).length
      ).toBeGreaterThan(0)
    );
    expect(
      screen.getAllByText(
        (_, el) => (el?.textContent ?? '').includes('previous upgrade took 95s') && el?.tagName === 'DIV'
      ).length
    ).toBeGreaterThan(0);
  });

  it('a healthy cluster shows no upgrade banner', async () => {
    vi.mocked(k8sList).mockImplementation(async (path: string) => {
      if (path.includes('openshiftpulses')) return [{ ...CR, status: { ...CR.status, phase: 'Running' } }];
      if (path.includes('clusterserviceversions')) return [CSV];
      return [];
    });
    vi.mocked(agentFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ protocol: 2, agent: 'v2.22.1', tools: 105, skills: 8 }),
    } as unknown as Response);
    renderPage();
    await waitFor(() => expect(screen.getByText('v0.4.2')).toBeDefined());
    expect(screen.queryByText('Update in progress')).toBeNull();
  });

  it('a degraded cluster is named, not hidden', async () => {
    vi.mocked(k8sList).mockImplementation(async (path: string) => {
      if (path.includes('openshiftpulses'))
        return [{ ...CR, status: { ...CR.status, phase: 'Degraded', agentHealthy: false } }];
      if (path.includes('clusterserviceversions')) return [CSV];
      return [];
    });
    vi.mocked(agentFetch).mockResolvedValue({ ok: false } as unknown as Response);
    renderPage();
    // "Degraded" legitimately appears in both the banner and the phase line.
    await waitFor(() => expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0));
  });
});
