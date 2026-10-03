// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useDiscovery } from '../useDiscovery';
import { useClusterStore } from '../../store/clusterStore';

const runDiscoveryMock = vi.fn();

beforeEach(() => {
  runDiscoveryMock.mockReset();
  useClusterStore.setState({
    resourceRegistry: null,
    apiGroups: [],
    discoveryLoading: false,
    discoveryError: null,
    runDiscovery: runDiscoveryMock,
  });
});

afterEach(() => {
  cleanup();
});

describe('useDiscovery', () => {
  it('calls runDiscovery when registry is null', () => {
    renderHook(() => useDiscovery());
    expect(runDiscoveryMock).toHaveBeenCalledTimes(1);
  });

  it('does not call runDiscovery when registry exists', () => {
    useClusterStore.setState({ resourceRegistry: new Map(), discoveryClusterId: 'local' });
    renderHook(() => useDiscovery());
    expect(runDiscoveryMock).not.toHaveBeenCalled();
  });

  it('returns registry from store', () => {
    const registry = new Map([['v1/pods', { kind: 'Pod' }]]);
    useClusterStore.setState({ resourceRegistry: registry as any });

    const { result } = renderHook(() => useDiscovery());
    expect(result.current.resourceRegistry).toBe(registry);
  });

  it('returns loading state', () => {
    useClusterStore.setState({ discoveryLoading: true });
    const { result } = renderHook(() => useDiscovery());
    expect(result.current.isLoading).toBe(true);
  });

  it('returns error state', () => {
    useClusterStore.setState({ discoveryError: 'Network failed' });
    const { result } = renderHook(() => useDiscovery());
    expect(result.current.error).toBe('Network failed');
  });

  it('returns refresh function', () => {
    const { result } = renderHook(() => useDiscovery());
    expect(typeof result.current.refresh).toBe('function');
  });

  it('returns apiGroups', () => {
    const groups = [{ name: 'apps', versions: ['v1'], preferredVersion: 'v1' }];
    useClusterStore.setState({ apiGroups: groups });

    const { result } = renderHook(() => useDiscovery());
    expect(result.current.apiGroups).toEqual(groups);
  });
});
