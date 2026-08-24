import { useQuery } from '@tanstack/react-query';
import { k8sList } from '../engine/query';

/**
 * The OpenShiftPulse CR, shared between the About page and the update
 * indicator in the user menu. One query key, so however many places watch
 * it, the cluster answers once — and while an upgrade is in flight the
 * poll tightens to 5s so indicators track the rollout live.
 */

export interface PulseCR {
  metadata?: { namespace?: string };
  spec?: {
    agent?: {
      image?: string;
      trustLevel?: number;
      allowWriteOperations?: boolean;
      adminUsers?: string;
      mcp?: { enabled?: boolean };
    };
    ui?: { image?: string; replicas?: number };
    monitoring?: { enabled?: boolean };
    vertexAI?: { projectId?: string; region?: string };
  };
  status?: {
    phase?: string;
    agentHealthy?: boolean;
    agentVersion?: string;
    databaseReady?: boolean;
    uiAvailable?: boolean;
    routeHost?: string;
    upgradeStartedAt?: string;
    lastHealthyAgentImage?: string;
    lastHealthyUIImage?: string;
    lastUpgradeDurationSeconds?: number;
  };
}

/** The tag portion of an image reference, '' when there is none. */
export function imageTag(image?: string): string {
  if (!image) return '';
  const idx = image.lastIndexOf(':');
  return idx > 0 ? image.slice(idx + 1) : '';
}

export function usePulseCR(): PulseCR | null | undefined {
  const { data } = useQuery({
    queryKey: ['about', 'openshiftpulse-cr'],
    queryFn: async () => {
      const items = await k8sList<PulseCR>('/apis/pulse.ai/v1alpha1/openshiftpulses');
      return items[0] ?? null;
    },
    refetchInterval: (query) => (query.state.data?.status?.phase === 'Upgrading' ? 5_000 : 60_000),
  });
  return data;
}

export type PulseHealth = 'healthy' | 'updating' | 'unhealthy' | 'unknown';

export interface PulseUpgradeStatus {
  phase: string;
  upgrading: boolean;
  /** Human-readable moves, e.g. "agent v2.22.0 → v2.22.1". */
  moves: string[];
  /** Rolled-up health for the header indicator. */
  health: PulseHealth;
  /** One line of per-component detail for tooltips. */
  detail: string;
}

/**
 * What's changing right now, from→to, straight off the CR: the operator
 * stamps lastHealthy*Image with what ran before the change.
 */
export function upgradeMovesFor(cr: PulseCR | null | undefined): string[] {
  if (cr?.status?.phase !== 'Upgrading') return [];
  const moves: string[] = [];
  const agentFrom = imageTag(cr.status?.lastHealthyAgentImage);
  const agentTo = imageTag(cr.spec?.agent?.image);
  if (agentTo && agentFrom !== agentTo) moves.push(`agent ${agentFrom || '?'} → ${agentTo}`);
  const uiFrom = imageTag(cr.status?.lastHealthyUIImage);
  const uiTo = imageTag(cr.spec?.ui?.image);
  if (uiTo && uiFrom !== uiTo) moves.push(`console ${uiFrom || '?'} → ${uiTo}`);
  return moves;
}

/**
 * Roll the operator's phase up to one of three states an operator can act
 * on — plus 'unknown' when the CR is unreadable, which must never be
 * painted as either healthy or unhealthy: absence of an answer is not an
 * answer.
 */
export function healthFor(cr: PulseCR | null | undefined): PulseHealth {
  const phase = cr?.status?.phase;
  if (!phase) return 'unknown';
  if (phase === 'Running') return 'healthy';
  if (phase === 'Upgrading') return 'updating';
  return 'unhealthy'; // Degraded, Installing, anything the operator invents later
}

export function healthDetailFor(cr: PulseCR | null | undefined): string {
  const s = cr?.status;
  if (!s?.phase) return 'Pulse status unavailable';
  const parts = [
    `agent ${s.agentHealthy ? 'healthy' : 'unhealthy'}`,
    `database ${s.databaseReady ? 'ready' : 'not ready'}`,
    `console ${s.uiAvailable ? 'available' : 'unavailable'}`,
  ];
  return `${s.phase} — ${parts.join(' · ')}`;
}

export function usePulseUpgrade(): PulseUpgradeStatus {
  const cr = usePulseCR();
  const phase = cr?.status?.phase ?? '';
  return {
    phase,
    upgrading: phase === 'Upgrading',
    moves: upgradeMovesFor(cr),
    health: healthFor(cr),
    detail: healthDetailFor(cr),
  };
}
