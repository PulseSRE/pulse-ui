import type { HealthScoreResult } from '../../engine/healthScore';

export const HEALTH_COLORS: Record<HealthScoreResult['grade'], string> = {
  healthy: '#10b981',
  warning: '#f59e0b',
  degraded: '#f97316',
  critical: '#ef4444',
};

export const HEALTH_PULSE: Record<HealthScoreResult['grade'], boolean> = {
  healthy: false,
  warning: false,
  degraded: false,
  critical: true,
};

/** Map dimensions */
export const MAP_HEIGHT = 420;
export const MAP_ASPECT = 2; // width:height

/** Cluster pin sizing */
export const PIN_RADIUS_MIN = 8;
export const PIN_RADIUS_MAX = 22;

/** Zoom transition duration (ms) */
export const FLY_DURATION = 600;
