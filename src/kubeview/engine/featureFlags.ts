/**
 * Feature Flags — localStorage-based feature flag system.
 *
 * Allows toggling experimental features at runtime via browser console
 * or settings UI. Flags default to disabled unless explicitly enabled.
 */

export type FeatureFlag =
  | 'incidentCenter'
  | 'identityView'
  | 'welcomeLaunchpad'
  | 'onboarding'
  | 'askPulse';

const STORAGE_KEY = 'openshiftpulse-feature-flags';

const ALL_FLAGS: readonly FeatureFlag[] = [
  'incidentCenter',
  'identityView',
  'welcomeLaunchpad',
  'onboarding',
  'askPulse',
] as const;

function loadFlags(): Record<FeatureFlag, boolean> {
  const defaults: Record<FeatureFlag, boolean> = {
    incidentCenter: true,
    identityView: true,
    welcomeLaunchpad: true,
    onboarding: true,
    askPulse: true,
  };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored);
    for (const flag of ALL_FLAGS) {
      if (typeof parsed[flag] === 'boolean') {
        defaults[flag] = parsed[flag];
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function saveFlags(flags: Record<FeatureFlag, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Check whether a feature flag is enabled. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return loadFlags()[flag];
}

/** Enable or disable a feature flag. */
export function setFeatureFlag(flag: FeatureFlag, enabled: boolean): void {
  const flags = loadFlags();
  flags[flag] = enabled;
  saveFlags(flags);
}

/** Return the current state of all feature flags. */
export function getAllFlags(): Record<FeatureFlag, boolean> {
  return loadFlags();
}
