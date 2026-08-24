// @vitest-environment jsdom
/**
 * The shared CR hook behind the About page and the header's update chip.
 * upgradeMovesFor derives "what is moving from where to where" from the
 * operator's lastHealthy*Image stamps.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../engine/query', () => ({ k8sList: vi.fn() }));
import { k8sList } from '../../engine/query';
import { upgradeMovesFor, usePulseUpgrade, imageTag } from '../usePulseStatus';

const UPGRADING = {
  spec: {
    agent: { image: 'quay.io/amobrem/pulse-agent:v2.23.0' },
    ui: { image: 'quay.io/amobrem/openshiftpulse:v2.22.1' },
  },
  status: {
    phase: 'Upgrading',
    lastHealthyAgentImage: 'quay.io/amobrem/pulse-agent:v2.22.1',
    lastHealthyUIImage: 'quay.io/amobrem/openshiftpulse:v2.22.1',
  },
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('imageTag', () => {
  it('extracts the tag and tolerates registries with ports', () => {
    expect(imageTag('quay.io/a/b:v1.2.3')).toBe('v1.2.3');
    expect(imageTag(undefined)).toBe('');
  });
});

describe('upgradeMovesFor', () => {
  it('names only the components that are actually changing', () => {
    // UI images match — only the agent is moving.
    expect(upgradeMovesFor(UPGRADING)).toEqual(['agent v2.22.1 → v2.23.0']);
  });

  it('is empty unless the operator says Upgrading', () => {
    expect(upgradeMovesFor({ ...UPGRADING, status: { ...UPGRADING.status, phase: 'Running' } })).toEqual([]);
    expect(upgradeMovesFor(null)).toEqual([]);
  });
});

describe('usePulseUpgrade', () => {
  it('reports an in-flight upgrade with its moves', async () => {
    vi.mocked(k8sList).mockResolvedValue([UPGRADING]);
    const { result } = renderHook(() => usePulseUpgrade(), { wrapper });
    await waitFor(() => expect(result.current.upgrading).toBe(true));
    expect(result.current.moves).toEqual(['agent v2.22.1 → v2.23.0']);
  });

  it('stays quiet on a healthy cluster', async () => {
    vi.mocked(k8sList).mockResolvedValue([{ ...UPGRADING, status: { phase: 'Running' } }]);
    const { result } = renderHook(() => usePulseUpgrade(), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe('Running'));
    expect(result.current.upgrading).toBe(false);
    expect(result.current.moves).toEqual([]);
  });
});

describe('healthFor', () => {
  it('maps the operator phases onto three actionable states', async () => {
    const { healthFor } = await import('../usePulseStatus');
    expect(healthFor({ status: { phase: 'Running' } })).toBe('healthy');
    expect(healthFor({ status: { phase: 'Upgrading' } })).toBe('updating');
    expect(healthFor({ status: { phase: 'Degraded' } })).toBe('unhealthy');
    expect(healthFor({ status: { phase: 'Installing' } })).toBe('unhealthy');
  });

  it('an unreadable CR is unknown, never healthy or unhealthy', async () => {
    const { healthFor } = await import('../usePulseStatus');
    expect(healthFor(null)).toBe('unknown');
    expect(healthFor(undefined)).toBe('unknown');
    expect(healthFor({})).toBe('unknown');
  });
});

describe('healthDetailFor', () => {
  it('names each component state in one tooltip line', async () => {
    const { healthDetailFor } = await import('../usePulseStatus');
    const detail = healthDetailFor({
      status: { phase: 'Degraded', agentHealthy: false, databaseReady: true, uiAvailable: true },
    });
    expect(detail).toBe('Degraded — agent unhealthy · database ready · console available');
  });
});
