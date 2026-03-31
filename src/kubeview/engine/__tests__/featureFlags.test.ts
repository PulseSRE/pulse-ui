// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { isFeatureEnabled, setFeatureFlag, getAllFlags } from '../featureFlags';

const STORAGE_KEY = 'openshiftpulse-feature-flags';

describe('featureFlags', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  describe('isFeatureEnabled', () => {
    it('returns true for all flags by default', () => {
      expect(isFeatureEnabled('incidentCenter')).toBe(true);
      expect(isFeatureEnabled('identityView')).toBe(true);
      expect(isFeatureEnabled('welcomeLaunchpad')).toBe(true);
      expect(isFeatureEnabled('onboarding')).toBe(true);
    });

    it('returns true after a flag is enabled', () => {
      setFeatureFlag('incidentCenter', true);
      expect(isFeatureEnabled('incidentCenter')).toBe(true);
    });

    it('returns false after a flag is disabled', () => {
      setFeatureFlag('onboarding', true);
      setFeatureFlag('onboarding', false);
      expect(isFeatureEnabled('onboarding')).toBe(false);
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json');
      expect(isFeatureEnabled('incidentCenter')).toBe(true);
    });
  });

  describe('setFeatureFlag', () => {
    it('persists flag state to localStorage', () => {
      setFeatureFlag('identityView', true);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.identityView).toBe(true);
    });

    it('does not affect other flags when setting one', () => {
      setFeatureFlag('incidentCenter', true);
      setFeatureFlag('welcomeLaunchpad', true);
      expect(isFeatureEnabled('incidentCenter')).toBe(true);
      expect(isFeatureEnabled('welcomeLaunchpad')).toBe(true);
      expect(isFeatureEnabled('identityView')).toBe(true);
    });
  });

  describe('getAllFlags', () => {
    it('returns all flags with defaults when nothing is stored', () => {
      const flags = getAllFlags();
      expect(flags).toEqual({
        incidentCenter: true,
        identityView: true,
        welcomeLaunchpad: true,
        onboarding: true,
        askPulse: true,
      });
    });

    it('reflects enabled flags', () => {
      setFeatureFlag('incidentCenter', true);
      setFeatureFlag('onboarding', true);
      const flags = getAllFlags();
      expect(flags).toEqual({
        incidentCenter: true,
        identityView: true,
        welcomeLaunchpad: true,
        onboarding: true,
        askPulse: true,
      });
    });

    it('ignores unknown keys in localStorage', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ incidentCenter: true, unknownFlag: true }),
      );
      const flags = getAllFlags();
      expect(flags.incidentCenter).toBe(true);
      expect((flags as Record<string, unknown>)['unknownFlag']).toBeUndefined();
    });
  });
});
