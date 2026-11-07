export type DegradedReason =
  | 'agent_unreachable'
  | 'protocol_mismatch'
  | 'polling_fallback'
  | 'rbac_denied'
  | 'observability_unavailable'
  | 'session_expired';

export const DEGRADED_MESSAGES: Record<DegradedReason, { title: string; description: string }> = {
  agent_unreachable: {
    title: 'Agent Unreachable',
    description: 'Cannot connect to Pulse AI. Monitoring and AI features are unavailable.',
  },
  protocol_mismatch: {
    title: 'Protocol Mismatch',
    description: 'Agent protocol version does not match. Some features may not work correctly.',
  },
  polling_fallback: {
    title: 'Polling Mode',
    description: 'WebSocket connection failed. Using polling fallback with reduced update frequency.',
  },
  rbac_denied: {
    title: 'Permission Denied',
    description: 'Insufficient RBAC permissions. Some resources may not be visible.',
  },
  observability_unavailable: {
    title: 'Monitoring Unavailable',
    description: 'Cannot reach Prometheus or Alertmanager. Alert data may be stale or missing.',
  },
  session_expired: {
    title: 'Session Expired',
    description: 'Your OAuth session has expired. Click to re-authenticate.',
  },
};
