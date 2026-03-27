/**
 * Trust Store — tracks agent confirmation history and progressive trust levels.
 *
 * Trust levels:
 *   0 OBSERVE     — Agent explains, no action buttons
 *   1 CONFIRM     — All actions require confirmation (default)
 *   2 BATCH       — LOW risk auto-approved
 *   3 BOUNDED     — LOW + MEDIUM auto-approved, only HIGH requires confirmation
 *   4 AUTONOMOUS  — Agent auto-fixes known issues from runbooks (all actions logged & reversible)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TrustLevel = 0 | 1 | 2 | 3 | 4;

export const TRUST_LABELS: Record<TrustLevel, string> = {
  0: 'Observe',
  1: 'Confirm',
  2: 'Batch',
  3: 'Bounded',
  4: 'Autonomous',
};

export const TRUST_DESCRIPTIONS: Record<TrustLevel, string> = {
  0: 'Agent explains what it would do. No actions executed.',
  1: 'Every action requires your explicit approval.',
  2: 'Low-risk actions auto-approved. Medium and high require confirmation.',
  3: 'Low and medium auto-approved. Only high-risk actions require confirmation.',
  4: 'Agent auto-fixes known issues from runbooks. All actions are logged and reversible.',
};

export interface ConfirmationRecord {
  id: string;
  tool: string;
  approved: boolean;
  timestamp: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

const UPGRADE_THRESHOLD = 10;
const MAX_HISTORY = 100;

interface TrustState {
  trustLevel: TrustLevel;
  history: ConfirmationRecord[];
  autoFixCategories: string[];

  recordConfirmation: (record: Omit<ConfirmationRecord, 'id'>) => void;
  setTrustLevel: (level: TrustLevel) => void;
  setAutoFixCategories: (categories: string[]) => void;
  shouldAutoApprove: (tool: string, riskLevel: string) => boolean;
  getUpgradeEligibility: () => {
    eligible: boolean;
    currentLevel: TrustLevel;
    nextLevel: TrustLevel;
    consecutiveApprovals: number;
    approvalsNeeded: number;
  };
  clearHistory: () => void;
}

function countConsecutiveApprovals(history: ConfirmationRecord[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].approved) count++;
    else break;
  }
  return count;
}

export const useTrustStore = create<TrustState>()(
  persist(
    (set, get) => ({
      trustLevel: 1 as TrustLevel,
      history: [],
      autoFixCategories: [],

      recordConfirmation: (record) => {
        const entry: ConfirmationRecord = {
          ...record,
          id: `conf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        };
        set((state) => ({
          history: [...state.history, entry].slice(-MAX_HISTORY),
        }));
      },

      setTrustLevel: (level) => {
        set({ trustLevel: level });
      },

      setAutoFixCategories: (categories) => {
        set({ autoFixCategories: categories });
      },

      shouldAutoApprove: (_tool: string, riskLevel: string) => {
        const { trustLevel } = get();
        if (trustLevel === 0) return false; // observe mode — no actions
        if (trustLevel === 1) return false; // all confirm
        if (trustLevel === 2) return riskLevel === 'LOW';
        if (trustLevel === 3) return riskLevel === 'LOW' || riskLevel === 'MEDIUM';
        if (trustLevel === 4) return true;
        return false;
      },

      getUpgradeEligibility: () => {
        const { trustLevel, history } = get();
        const consecutive = countConsecutiveApprovals(history);
        const nextLevel = Math.min(trustLevel + 1, 4) as TrustLevel;
        const approvalsNeeded = Math.max(0, UPGRADE_THRESHOLD - consecutive);

        return {
          eligible: trustLevel < 4 && consecutive >= UPGRADE_THRESHOLD,
          currentLevel: trustLevel,
          nextLevel,
          consecutiveApprovals: consecutive,
          approvalsNeeded,
        };
      },

      clearHistory: () => {
        set({ history: [] });
      },
    }),
    {
      name: 'openshiftpulse-trust',
      partialize: (state) => ({
        trustLevel: state.trustLevel,
        history: state.history.slice(-MAX_HISTORY),
        autoFixCategories: state.autoFixCategories,
      }),
    },
  ),
);
