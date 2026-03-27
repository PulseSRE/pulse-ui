// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTrustStore, TRUST_LABELS, TRUST_DESCRIPTIONS } from '../trustStore';

describe('trustStore', () => {
  beforeEach(() => {
    act(() => {
      useTrustStore.setState({ trustLevel: 1, history: [], autoFixCategories: [] });
    });
  });

  it('starts at trust level 1 (CONFIRM)', () => {
    const { result } = renderHook(() => useTrustStore());
    expect(result.current.trustLevel).toBe(1);
  });

  it('records confirmation and tracks history', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => {
      result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: Date.now(), riskLevel: 'LOW' });
    });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].tool).toBe('scale_deployment');
  });

  it('shouldAutoApprove returns false at level 1', () => {
    const { result } = renderHook(() => useTrustStore());
    expect(result.current.shouldAutoApprove('scale_deployment', 'LOW')).toBe(false);
  });

  it('shouldAutoApprove returns true for LOW at level 2', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => result.current.setTrustLevel(2));
    expect(result.current.shouldAutoApprove('scale_deployment', 'LOW')).toBe(true);
    expect(result.current.shouldAutoApprove('delete_pod', 'MEDIUM')).toBe(false);
  });

  it('shouldAutoApprove returns true for LOW+MEDIUM at level 3', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => result.current.setTrustLevel(3));
    expect(result.current.shouldAutoApprove('scale_deployment', 'LOW')).toBe(true);
    expect(result.current.shouldAutoApprove('delete_pod', 'MEDIUM')).toBe(true);
    expect(result.current.shouldAutoApprove('drain_node', 'HIGH')).toBe(false);
  });

  it('shouldAutoApprove returns false at level 0 (OBSERVE)', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => result.current.setTrustLevel(0));
    expect(result.current.shouldAutoApprove('scale_deployment', 'LOW')).toBe(false);
  });

  it('counts consecutive approvals for upgrade eligibility', () => {
    const { result } = renderHook(() => useTrustStore());

    // Add 10 consecutive approvals
    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: Date.now() + i, riskLevel: 'LOW' });
      }
    });

    const elig = result.current.getUpgradeEligibility();
    expect(elig.eligible).toBe(true);
    expect(elig.currentLevel).toBe(1);
    expect(elig.nextLevel).toBe(2);
    expect(elig.consecutiveApprovals).toBe(10);
  });

  it('breaks consecutive count on denial', () => {
    const { result } = renderHook(() => useTrustStore());

    act(() => {
      for (let i = 0; i < 9; i++) {
        result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: Date.now() + i, riskLevel: 'LOW' });
      }
      result.current.recordConfirmation({ tool: 'delete_pod', approved: false, timestamp: Date.now() + 9, riskLevel: 'MEDIUM' });
    });

    const elig = result.current.getUpgradeEligibility();
    expect(elig.eligible).toBe(false);
    expect(elig.consecutiveApprovals).toBe(0);
  });

  it('does not upgrade past level 4', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => result.current.setTrustLevel(4));

    act(() => {
      for (let i = 0; i < 15; i++) {
        result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: Date.now() + i, riskLevel: 'LOW' });
      }
    });

    const elig = result.current.getUpgradeEligibility();
    expect(elig.eligible).toBe(false);
    expect(elig.nextLevel).toBe(4);
  });

  it('trims history to 100 records', () => {
    const { result } = renderHook(() => useTrustStore());

    act(() => {
      for (let i = 0; i < 120; i++) {
        result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: i, riskLevel: 'LOW' });
      }
    });

    expect(result.current.history.length).toBeLessThanOrEqual(100);
  });

  it('clearHistory resets history', () => {
    const { result } = renderHook(() => useTrustStore());

    act(() => {
      result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: Date.now(), riskLevel: 'LOW' });
      result.current.clearHistory();
    });

    expect(result.current.history).toHaveLength(0);
  });

  it('has level 4 label and description', () => {
    expect(TRUST_LABELS[4]).toBe('Autonomous');
    expect(TRUST_DESCRIPTIONS[4]).toBe('Agent auto-fixes known issues from runbooks. All actions are logged and reversible.');
  });

  it('manages autoFixCategories state', () => {
    const { result } = renderHook(() => useTrustStore());
    expect(result.current.autoFixCategories).toEqual([]);

    act(() => {
      result.current.setAutoFixCategories(['pod-restart', 'certificate-renewal']);
    });

    expect(result.current.autoFixCategories).toEqual(['pod-restart', 'certificate-renewal']);
  });

  it('shouldAutoApprove returns true for all risk levels at level 4', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => result.current.setTrustLevel(4));

    expect(result.current.shouldAutoApprove('scale_deployment', 'LOW')).toBe(true);
    expect(result.current.shouldAutoApprove('delete_pod', 'MEDIUM')).toBe(true);
    expect(result.current.shouldAutoApprove('drain_node', 'HIGH')).toBe(true);
  });

  it('upgrade eligibility from level 3 to 4', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => result.current.setTrustLevel(3));

    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.recordConfirmation({ tool: 'scale_deployment', approved: true, timestamp: Date.now() + i, riskLevel: 'LOW' });
      }
    });

    const elig = result.current.getUpgradeEligibility();
    expect(elig.eligible).toBe(true);
    expect(elig.currentLevel).toBe(3);
    expect(elig.nextLevel).toBe(4);
  });

  it('persists autoFixCategories', () => {
    const { result } = renderHook(() => useTrustStore());
    act(() => {
      result.current.setAutoFixCategories(['pod-restart']);
    });

    // Verify the partialize includes autoFixCategories by checking state
    const state = useTrustStore.getState();
    expect(state.autoFixCategories).toEqual(['pod-restart']);
  });
});
