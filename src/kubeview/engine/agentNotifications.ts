/**
 * Agent Notifications — delegates to monitorStore for v2 real-time findings,
 * falling back to 5-minute polling for v1 agents.
 *
 * Toast notifications for critical/warning findings are handled via a
 * Zustand subscriber on the monitor store's findings array.
 */

import { AgentClient } from './agentClient';
import type { AgentEvent } from './agentClient';
import { useUIStore } from '../store/uiStore';
import { useAgentStore } from '../store/agentStore';
import { useMonitorStore } from '../store/monitorStore';
import type { Finding } from './monitorClient';

const DEFAULT_INTERVAL = 300_000; // 5 minutes
const PROMPT =
  'Briefly check for critical issues or anomalies. For each issue, name the affected resource and give a one-line fix. 3 sentences max. If nothing notable, respond with just "OK".';

let running = false;

// --- v1 fallback state ---
let intervalId: ReturnType<typeof setInterval> | null = null;
let polling = false; // guard against overlapping polls
let client: AgentClient | null = null;

// --- v2 toast subscriber ---
let unsubscribeMonitor: (() => void) | null = null;

const AGENT_BASE = '/api/agent';
const QUERY_TIMEOUT = 30_000; // 30s max per query

async function detectProtocol(): Promise<'2' | '1' | null> {
  try {
    const res = await fetch(`${AGENT_BASE}/version`);
    if (!res.ok) return '1'; // old agent without proper /version
    const data = await res.json();
    return data.protocol === '2' ? '2' : '1';
  } catch {
    return null; // agent unavailable
  }
}

// --- v2: Toast notifications for critical/warning findings ---

function showFindingToast(finding: Finding) {
  const store = useUIStore.getState();
  store.addToast({
    type: finding.severity === 'critical' ? 'error' : 'warning',
    title: `Monitor: ${finding.title}`,
    detail: finding.summary,
    duration: 15000,
    action: {
      label: 'Investigate',
      onClick: () => {
        store.openDock('agent');
        const agentStore = useAgentStore.getState();
        if (agentStore.connected) {
          agentStore.sendMessage(
            `The monitor detected this issue:\n\n"${finding.title}: ${finding.summary}"\n\nInvestigate this further. What is the root cause and what should I do to fix it?`,
          );
        }
      },
    },
  });
}

/**
 * Subscribe to monitorStore findings and fire toasts for new critical/warning entries.
 * Tracks seen finding IDs to avoid duplicate toasts on rehydration or re-renders.
 */
function subscribeToMonitorToasts() {
  // Seed with existing IDs so we don't toast on rehydration
  const toastedIds = new Set(
    useMonitorStore.getState().findings.map((f) => f.id),
  );
  let prevFindings = useMonitorStore.getState().findings;

  unsubscribeMonitor = useMonitorStore.subscribe((state) => {
    const findings = state.findings;
    if (findings === prevFindings) return;

    // Find newly added findings
    const prevIds = new Set(prevFindings.map((f) => f.id));
    for (const finding of findings) {
      if (!prevIds.has(finding.id) && !toastedIds.has(finding.id)) {
        toastedIds.add(finding.id);
        if (finding.severity === 'critical' || finding.severity === 'warning') {
          showFindingToast(finding);
        }
      }
    }
    prevFindings = findings;
  });
}

// --- v2: Toast notifications for action reports ---

let unsubscribeActionReports: (() => void) | null = null;

function subscribeToActionReportToasts() {
  const toastedActionIds = new Set(
    useMonitorStore.getState().recentActions.map((a) => a.id),
  );
  let prevActions = useMonitorStore.getState().recentActions;

  unsubscribeActionReports = useMonitorStore.subscribe((state) => {
    const actions = state.recentActions;
    if (actions === prevActions) return;

    const prevIds = new Set(prevActions.map((a) => a.id));
    for (const action of actions) {
      if (!prevIds.has(action.id) && !toastedActionIds.has(action.id)) {
        toastedActionIds.add(action.id);
        const store = useUIStore.getState();
        if (action.status === 'completed') {
          const resource = action.findingId; // best available resource identifier
          store.addToast({
            type: 'success',
            title: `Auto-fix: ${action.tool} completed on ${resource}`,
            detail: action.reasoning ?? '',
            duration: 10000,
          });
        } else if (action.status === 'failed') {
          store.addToast({
            type: 'error',
            title: `Auto-fix failed: ${action.error ?? 'Unknown error'}`,
            detail: `Tool: ${action.tool}`,
            duration: 15000,
          });
        }
      }
    }
    prevActions = actions;
  });
}

// --- v1: Polling fallback ---

function query(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const c = new AgentClient('sre');
    client = c;

    function cleanup() {
      if (!settled) {
        settled = true;
        unsub();
        c.disconnect();
        client = null;
      }
    }

    const unsub = c.on((event: AgentEvent) => {
      if (settled) return;
      switch (event.type) {
        case 'connected':
          c.send(PROMPT);
          break;
        case 'done':
          cleanup();
          resolve(event.full_response);
          break;
        case 'error':
          cleanup();
          reject(new Error(event.message));
          break;
        case 'disconnected':
          cleanup();
          reject(new Error('Disconnected'));
          break;
      }
    });

    // Timeout to prevent leaked connections
    setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error('Query timed out'));
      }
    }, QUERY_TIMEOUT);

    c.connect();
  });
}

async function poll() {
  if (polling) return; // previous poll still running
  polling = true;
  try {
    const response = await query();
    const trimmed = response.trim();

    // Only notify if the agent found something notable
    if (trimmed && trimmed !== 'OK' && trimmed.toLowerCase() !== 'ok') {
      const store = useUIStore.getState();
      store.addToast({
        type: 'warning',
        title: 'AI Insight',
        detail: trimmed,
        duration: 15000,
        action: {
          label: 'Investigate',
          onClick: () => {
            store.openDock('agent');
            // Send the insight to the agent so it continues the thread
            const agentStore = useAgentStore.getState();
            if (agentStore.connected) {
              agentStore.sendMessage(
                `The background health check found this issue:\n\n"${trimmed}"\n\nInvestigate this further. What is the root cause and what should I do to fix it?`,
              );
            }
          },
        },
      });
    }
  } catch {
    // Silently skip — agent may be unavailable
  } finally {
    polling = false;
  }
}

// --- Public API ---

export async function startAgentNotifications(intervalMs = DEFAULT_INTERVAL) {
  if (running) return;
  running = true;

  const protocol = await detectProtocol();

  if (protocol === '2') {
    // Delegate to monitorStore — single WebSocket connection
    useMonitorStore.getState().connect();
    // Subscribe to findings for toast notifications
    subscribeToMonitorToasts();
    // Subscribe to action reports for auto-fix toasts
    subscribeToActionReportToasts();
    useUIStore.getState().removeDegradedReason('polling_fallback');
    useUIStore.getState().removeDegradedReason('agent_unreachable');
  } else if (protocol === '1') {
    // Fall back to existing polling — mark as degraded
    useUIStore.getState().addDegradedReason('polling_fallback');
    useUIStore.getState().removeDegradedReason('agent_unreachable');
    intervalId = setInterval(poll, intervalMs);
  } else {
    // Agent unavailable
    useUIStore.getState().addDegradedReason('agent_unreachable');
  }
}

export function stopAgentNotifications() {
  running = false;
  useUIStore.getState().removeDegradedReason('polling_fallback');
  // Stop v2 monitor
  if (unsubscribeMonitor) {
    unsubscribeMonitor();
    unsubscribeMonitor = null;
  }
  if (unsubscribeActionReports) {
    unsubscribeActionReports();
    unsubscribeActionReports = null;
  }
  useMonitorStore.getState().disconnect();
  // Also stop v1 polling
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (client) {
    client.disconnect();
    client = null;
  }
  polling = false;
}

export function isAgentNotificationsRunning(): boolean {
  return running;
}
