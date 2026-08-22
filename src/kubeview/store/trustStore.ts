/**
 * Trust Store — tracks agent confirmation history and progressive trust levels.
 *
 * The ladder below is written from what the agent actually does, verified by
 * running `auto_fix` at each level. The previous version described a different
 * product:
 *
 *   1 was "CONFIRM — all actions require confirmation". In fact `auto_fix` is
 *   only entered at `trust_level >= 2`, so level 1 never proposes anything.
 *   There is nothing to confirm. An operator who wanted supervised remediation
 *   read that label, chose 1, and got an agent that did nothing at all — which
 *   is exactly the `total_actions: 0` symptom measured on the reference
 *   cluster.
 *
 *   2 was "BATCH — LOW risk auto-approved". In fact level 2 proposes *every*
 *   fix and waits for a human. It is the level that actually confirms.
 *
 *   3 and 4 promised LOW/MEDIUM/HIGH risk tiers. No such tiering exists in the
 *   fix path — `risk_level` appears only in LLM investigation output, and
 *   `auto_fix` never consults it. What 3 really does is filter by category.
 *
 * The ladder is monotonic and the levels are genuinely distinct; only the
 * names were wrong. Behaviour is deliberately unchanged here: making level 1
 * act as its old label promised would start remediation on every cluster
 * currently configured at 1, on upgrade, without anyone asking for it.
 *
 * This file is the single source for the ladder. Render from these maps rather
 * than restating the levels, which is how the two copies drifted apart.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TrustLevel = 0 | 1 | 2 | 3 | 4;

export const TRUST_LABELS: Record<TrustLevel, string> = {
  0: 'Observe',
  1: 'Manual',
  2: 'Propose',
  3: 'Bounded',
  4: 'Autonomous',
};

/** Short form for the badge tooltip. Same ladder, fewer words. */
export const TRUST_HINTS: Record<TrustLevel, string> = {
  0: 'watches only, writes blocked',
  1: 'you act, the agent does not',
  2: 'proposes fixes, you approve',
  3: 'fixes allowed categories itself',
  4: 'fixes anything it can itself',
};

export const TRUST_DESCRIPTIONS: Record<TrustLevel, string> = {
  0: 'Agent explains what it would do and never acts. Action buttons that write are blocked too.',
  1: 'You act, the agent does not. Action buttons work; the agent never remediates on its own.',
  2: 'The agent proposes every fix and waits for your approval before anything runs.',
  3: 'The agent applies fixes without asking, limited to the categories you allow.',
  4: 'The agent applies any fix it can, without asking. All actions are logged.',
};

export type CommunicationStyle = 'brief' | 'detailed' | 'technical';
export type MinSeverity = 'critical' | 'warning' | 'info';

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

  // Preferences
  communicationStyle: CommunicationStyle;
  minSeverity: MinSeverity;

  recordConfirmation: (record: Omit<ConfirmationRecord, 'id'>) => void;
  setTrustLevel: (level: TrustLevel) => void;
  setAutoFixCategories: (categories: string[]) => void;
  setCommunicationStyle: (style: CommunicationStyle) => void;
  setMinSeverity: (severity: MinSeverity) => void;
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
      communicationStyle: 'detailed' as CommunicationStyle,
      minSeverity: 'warning' as MinSeverity,

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

      setCommunicationStyle: (style) => set({ communicationStyle: style }),
      setMinSeverity: (severity) => set({ minSeverity: severity }),

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
      // Key trust by hostname so trust earned on staging doesn't carry over to production
      name: `openshiftpulse-trust-${typeof window !== 'undefined' ? window.location.hostname : 'default'}`,
      partialize: (state) => ({
        trustLevel: state.trustLevel,
        history: state.history.slice(-MAX_HISTORY),
        autoFixCategories: state.autoFixCategories,
        communicationStyle: state.communicationStyle,
        minSeverity: state.minSeverity,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Validate trustLevel is in valid range 0-4; reset to 0 if corrupted
        if (
          typeof state.trustLevel !== 'number' ||
          state.trustLevel < 0 ||
          state.trustLevel > 4 ||
          !Number.isInteger(state.trustLevel)
        ) {
          state.trustLevel = 0 as TrustLevel;
        }
      },
    },
  ),
);
