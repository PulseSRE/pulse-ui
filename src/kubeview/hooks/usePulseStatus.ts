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

export interface PulseUpgradeStatus {
  phase: string;
  upgrading: boolean;
  /** Human-readable moves, e.g. "agent v2.22.0 → v2.22.1". */
  moves: string[];
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

export function usePulseUpgrade(): PulseUpgradeStatus {
  const cr = usePulseCR();
  const phase = cr?.status?.phase ?? '';
  return {
    phase,
    upgrading: phase === 'Upgrading',
    moves: upgradeMovesFor(cr),
  };
}
