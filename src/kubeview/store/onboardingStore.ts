/**
 * Onboarding Store — tracks first-run state for AI features.
 * Persisted to localStorage so onboarding hints show once.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WaiverEntry {
  reason: string;
  waivedAt: number;
  /** Who waived it ('' when the signed-in user could not be looked up). */
  approvedBy?: string;
}

interface OnboardingState {
  /** Whether the user has seen the main AI onboarding card */
  aiOnboardingSeen: boolean;
  /** Readiness gate waivers keyed by gate ID */
  waivers: Record<string, WaiverEntry>;
  /** Dismiss the onboarding (set to seen) */
  dismissOnboarding: () => void;
  /** Add a waiver for a readiness gate */
  addWaiver: (gateId: string, reason: string, approvedBy?: string) => void;
  /** Remove a waiver */
  removeWaiver: (gateId: string) => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      aiOnboardingSeen: false,
      waivers: {},
      dismissOnboarding: () => set({ aiOnboardingSeen: true }),
      addWaiver: (gateId, reason, approvedBy = '') => set((s) => ({
        waivers: { ...s.waivers, [gateId]: { reason, waivedAt: Date.now(), approvedBy } },
      })),
      removeWaiver: (gateId) => set((s) => {
        const { [gateId]: _, ...rest } = s.waivers;
        return { waivers: rest };
      }),
    }),
    { name: 'openshiftpulse-onboarding' },
  ),
);
