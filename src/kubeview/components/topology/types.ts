import type { HealthScoreResult } from '../../engine/healthScore';

export type ZoomLevel = 'world' | 'cluster' | 'node';

export interface MapCluster {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  region: string;
  displayName: string;
  status: 'connected' | 'unreachable' | 'auth-expired' | 'unknown';
  healthScore: number;
  healthGrade: HealthScoreResult['grade'];
  nodeCount: number;
  environment?: string;
  version?: string;
}

/** A datacenter / availability zone with nodes in it */
export interface MapZone {
  id: string;            // region/zone key
  region: string;
  zone: string;
  latitude: number;
  longitude: number;
  displayName: string;
  provider: string;      // aws, azure, gcp, baremetal, etc.
  nodeCount: number;
  nodeNames: string[];
  healthScore: number;
  healthGrade: HealthScoreResult['grade'];
  podCount: number;
}

export interface MapNode {
  id: string;
  name: string;
  healthScore: number;
  healthGrade: HealthScoreResult['grade'];
  podCount: number;
  status: 'Ready' | 'NotReady';
  conditions: string[];
  region?: string;
  zone?: string;
  instanceType?: string;
  provider?: string;
}

export interface MapPod {
  name: string;
  namespace: string;
  phase: string;
  nodeName: string;
  restarts: number;
}

/** A recent event for the live event indicator */
export interface MapEvent {
  id: string;
  type: 'deploy' | 'scale' | 'restart' | 'alert' | 'eviction' | 'scheduled';
  message: string;
  nodeName?: string;
  zone?: string;
  timestamp: number;
}

/** Resource utilization for a zone */
export interface ZoneUtilization {
  zoneId: string;
  cpuPercent: number;    // 0-100
  memoryPercent: number; // 0-100
}

/** A pod movement event for real-time animation */
export interface PodMovement {
  podName: string;
  namespace: string;
  fromPhase: string;
  toPhase: string;
  nodeName: string;
  timestamp: number;
}
