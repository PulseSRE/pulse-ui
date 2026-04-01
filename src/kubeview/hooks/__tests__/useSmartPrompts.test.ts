// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

// Mock useK8sListWatch
const useK8sListWatchMock = vi.fn();
vi.mock('../useK8sListWatch', () => ({
  useK8sListWatch: (opts: any) => useK8sListWatchMock(opts),
}));

// Mock clusterStore
vi.mock('../../store/clusterStore', () => ({
  useClusterStore: (sel: any) => sel({ clusterVersion: '4.14.5' }),
}));

// Mock uiStore
vi.mock('../../store/uiStore', () => ({
  useUIStore: (sel: any) => sel({ selectedNamespace: '*' }),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/pulse' }),
}));

// Mock smartPrompts engine
vi.mock('../../engine/smartPrompts', () => ({
  generateSmartPrompts: vi.fn(() => []),
}));

import { useSmartPrompts } from '../useSmartPrompts';

function makePod(name: string, namespace: string, phase: string, waitingReason?: string) {
  return {
    metadata: { name, namespace, uid: `uid-${name}` },
    kind: 'Pod',
    apiVersion: 'v1',
    status: {
      phase,
      containerStatuses: waitingReason
        ? [{ state: { waiting: { reason: waitingReason } } }]
        : [],
    },
  };
}

function makeDeployment(name: string, namespace: string, desired: number, ready: number) {
  return {
    metadata: { name, namespace, uid: `uid-${name}` },
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    spec: { replicas: desired },
    status: { readyReplicas: ready },
  };
}

function makePVC(name: string, namespace: string, phase: string) {
  return {
    metadata: { name, namespace, uid: `uid-${name}` },
    kind: 'PersistentVolumeClaim',
    apiVersion: 'v1',
    status: { phase },
  };
}

function makeEvent(type: string, ageMinutes: number) {
  const ts = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return {
    metadata: { name: `event-${Math.random()}`, uid: `uid-${Math.random()}`, creationTimestamp: ts },
    type,
    lastTimestamp: ts,
  };
}

describe('useSmartPrompts', () => {
  beforeEach(() => {
    useK8sListWatchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  function setupMocks(overrides: {
    pods?: any[];
    deployments?: any[];
    events?: any[];
    pvcs?: any[];
    isLoading?: boolean;
  } = {}) {
    useK8sListWatchMock.mockImplementation((opts: { apiPath: string }) => {
      if (opts.apiPath.includes('pods')) return { data: overrides.pods ?? [], isLoading: overrides.isLoading ?? false };
      if (opts.apiPath.includes('deployments')) return { data: overrides.deployments ?? [], isLoading: false };
      if (opts.apiPath.includes('events')) return { data: overrides.events ?? [], isLoading: false };
      if (opts.apiPath.includes('persistentvolumeclaims')) return { data: overrides.pvcs ?? [], isLoading: false };
      return { data: [], isLoading: false };
    });
  }

  it('returns healthy cluster prompts when no issues detected', () => {
    setupMocks();
    const { result } = renderHook(() => useSmartPrompts());

    expect(result.current.length).toBeGreaterThanOrEqual(1);
    expect(result.current[0].prompt).toContain('healthy');
  });

  it('returns empty array while loading', () => {
    setupMocks({ isLoading: true });
    const { result } = renderHook(() => useSmartPrompts());
    expect(result.current).toEqual([]);
  });

  it('detects CrashLoopBackOff pods', () => {
    setupMocks({
      pods: [makePod('bad-pod', 'default', 'Running', 'CrashLoopBackOff')],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const crashPrompt = result.current.find((p) => p.prompt.includes('crash-looping'));
    expect(crashPrompt).toBeDefined();
    expect(crashPrompt!.priority).toBe(100);
    expect(crashPrompt!.context).toContain('default/bad-pod');
  });

  it('detects ImagePullBackOff pods', () => {
    setupMocks({
      pods: [makePod('img-pod', 'test-ns', 'Pending', 'ImagePullBackOff')],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const imgPrompt = result.current.find((p) => p.prompt.includes('image pull'));
    expect(imgPrompt).toBeDefined();
    expect(imgPrompt!.priority).toBe(95);
  });

  it('detects Failed pods', () => {
    setupMocks({
      pods: [makePod('fail-pod', 'prod', 'Failed')],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const failPrompt = result.current.find((p) => p.prompt.includes('Failed state'));
    expect(failPrompt).toBeDefined();
    expect(failPrompt!.priority).toBe(90);
  });

  it('detects pending pods', () => {
    setupMocks({
      pods: [makePod('pend-1', 'ns1', 'Pending'), makePod('pend-2', 'ns2', 'Pending')],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const pendingPrompt = result.current.find((p) => p.prompt.includes('stuck pending'));
    expect(pendingPrompt).toBeDefined();
    expect(pendingPrompt!.prompt).toContain('2 pods');
    expect(pendingPrompt!.priority).toBe(85);
  });

  it('detects unhealthy deployments (single)', () => {
    setupMocks({
      deployments: [makeDeployment('web', 'default', 3, 1)],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const depPrompt = result.current.find((p) => p.prompt.includes('replicas ready'));
    expect(depPrompt).toBeDefined();
    expect(depPrompt!.prompt).toContain('web');
    expect(depPrompt!.prompt).toContain('1/3');
  });

  it('detects unhealthy deployments (multiple)', () => {
    setupMocks({
      deployments: [
        makeDeployment('web', 'default', 3, 1),
        makeDeployment('api', 'default', 2, 0),
      ],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const depPrompt = result.current.find((p) => p.prompt.includes('deployments have unavailable'));
    expect(depPrompt).toBeDefined();
    expect(depPrompt!.prompt).toContain('2 deployments');
  });

  it('detects pending PVCs', () => {
    setupMocks({
      pvcs: [makePVC('data-pvc', 'storage-ns', 'Pending')],
    });
    const { result } = renderHook(() => useSmartPrompts());
    const pvcPrompt = result.current.find((p) => p.prompt.includes('PVC'));
    expect(pvcPrompt).toBeDefined();
    expect(pvcPrompt!.priority).toBe(70);
  });

  it('detects high warning event count', () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent('Warning', 5));
    setupMocks({ events });
    const { result } = renderHook(() => useSmartPrompts());
    const eventPrompt = result.current.find((p) => p.prompt.includes('warning events'));
    expect(eventPrompt).toBeDefined();
    expect(eventPrompt!.prompt).toContain('10');
  });

  it('ignores old warning events (>30 min)', () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent('Warning', 60));
    setupMocks({ events });
    const { result } = renderHook(() => useSmartPrompts());
    const eventPrompt = result.current.find((p) => p.prompt.includes('warning events'));
    expect(eventPrompt).toBeUndefined();
  });

  it('sorts prompts by priority descending', () => {
    setupMocks({
      pods: [
        makePod('crash', 'ns1', 'Running', 'CrashLoopBackOff'),
        makePod('pend', 'ns2', 'Pending'),
      ],
      deployments: [makeDeployment('web', 'default', 3, 1)],
    });
    const { result } = renderHook(() => useSmartPrompts());
    for (let i = 1; i < result.current.length; i++) {
      expect(result.current[i - 1].priority).toBeGreaterThanOrEqual(result.current[i].priority);
    }
  });

  it('returns SmartPromptItem shape', () => {
    setupMocks();
    const { result } = renderHook(() => useSmartPrompts());
    for (const item of result.current) {
      expect(item).toHaveProperty('prompt');
      expect(item).toHaveProperty('context');
      expect(item).toHaveProperty('priority');
      expect(typeof item.prompt).toBe('string');
      expect(typeof item.context).toBe('string');
      expect(typeof item.priority).toBe('number');
    }
  });
});
