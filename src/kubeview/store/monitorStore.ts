/**
 * Monitor Store — manages state for the autonomous SRE agent monitor channel.
 * Receives findings, predictions, and action reports over WebSocket.
 * Persists user preferences and recent data to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  MonitorClient,
  type MonitorEvent,
  type Finding,
  type ActionReport,
  type Prediction,
  type InvestigationReport,
  type VerificationReport,
  type Resolution,
  type ScanReport,
} from '../engine/monitorClient';
import {
  fetchFixHistory,
  type ActionRecord,
  type FixHistoryFilters,
} from '../engine/fixHistory';
import { useTrustStore } from './trustStore';
import { useUIStore } from './uiStore';
import { handleAuthError } from '../engine/auth';

const MAX_FINDINGS = 200;
const MAX_PREDICTIONS = 50;
const MAX_INVESTIGATIONS = 100;
const MAX_VERIFICATIONS = 200;
const MAX_RECENT_ACTIONS = 50;
const MAX_RESOLUTIONS = 50;

interface MonitorState {
  // Connection
  connected: boolean;
  connectionError: string | null;
  lastScanTime: number;
  nextScanTime: number;
  activeWatches: string[];
  scanReport: ScanReport | null;

  // Data
  findings: Finding[];
  dismissedFindingIds: string[];
  acknowledgedIds: string[];
  predictions: Prediction[];
  investigations: InvestigationReport[];
  verifications: VerificationReport[];
  pendingActions: ActionReport[];
  recentActions: ActionReport[];
  resolutions: Resolution[];

  // Fix history (REST-loaded)
  fixHistory: ActionRecord[];
  fixHistoryTotal: number;
  fixHistoryPage: number;
  fixHistoryLoading: boolean;

  // Skill activity
  activeSkill: string | null;
  skillHandoffs: Array<{ from: string; to: string; timestamp: number }>;

  // Preferences
  monitorEnabled: boolean;

  // UI
  unreadCount: number;
  notificationCenterOpen: boolean;

  // Actions
  connect: () => void;
  disconnect: () => void;
  triggerScan: () => void;
  setDisabledScanners: (scannerIds: string[]) => void;
  dismissFinding: (id: string) => void;
  acknowledgeFinding: (id: string) => void;
  unacknowledgeFinding: (id: string) => void;
  approveAction: (actionId: string) => void;
  rejectAction: (actionId: string) => void;
  setMonitorEnabled: (enabled: boolean) => void;
  loadFixHistory: (page?: number, filters?: FixHistoryFilters) => void;
  markAllRead: () => void;
  toggleNotificationCenter: () => void;
}

let client: MonitorClient | null = null;
let unsubscribe: (() => void) | null = null;
// H10: request counter to prevent stale fix history responses from overwriting newer data
let _fixHistoryRequestId = 0;

function capArray<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(-max) : arr;
}

export const useMonitorStore = create<MonitorState>()(
  persist(
    (set, get) => ({
      // Connection
      connected: false,
      connectionError: null,
      lastScanTime: 0,
      nextScanTime: 0,
      activeWatches: [],
      scanReport: null,

      // Data
      findings: [],
      dismissedFindingIds: [],
      acknowledgedIds: [],
      predictions: [],
      investigations: [],
      verifications: [],
      pendingActions: [],
      recentActions: [],
      resolutions: [],

      // Fix history
      fixHistory: [],
      fixHistoryTotal: 0,
      fixHistoryPage: 1,
      fixHistoryLoading: false,

      // Skill activity
      activeSkill: null,
      skillHandoffs: [],

      // Preferences
      monitorEnabled: true,
      // UI
      unreadCount: 0,
      notificationCenterOpen: false,

      connect: () => {
        if (client && client.connected && get().connected) return;
        if (unsubscribe) unsubscribe();
        if (client) client.disconnect();

        client = new MonitorClient();

        unsubscribe = client.on((event: MonitorEvent) => {
          switch (event.type) {
            case 'connected':
              set({ connected: true, connectionError: null });
              break;

            case 'disconnected':
              set({ connected: false });
              break;

            case 'finding': {
              const { type: _, ...finding } = event;
              const dismissed = get().dismissedFindingIds;
              if (dismissed.includes(finding.id)) break;
              set((s) => ({
                findings: capArray([...s.findings, finding], MAX_FINDINGS),
                unreadCount: s.unreadCount + 1,
              }));
              break;
            }

            case 'action_report': {
              const { type: _, ...report } = event;
              if (report.status === 'proposed') {
                // Only add if not already pending (dedup by ID)
                set((s) => {
                  if (s.pendingActions.some((a) => a.id === report.id)) return s;
                  return {
                    pendingActions: [...s.pendingActions, report],
                    unreadCount: s.unreadCount + 1,
                  };
                });
              } else {
                // Move from pending to recent on status change (dedup by ID)
                set((s) => {
                  const alreadyRecent = s.recentActions.some((a) => a.id === report.id);
                  return {
                    pendingActions: s.pendingActions.filter(
                      (a) => a.id !== report.id,
                    ),
                    recentActions: alreadyRecent
                      ? s.recentActions.map((a) => (a.id === report.id ? report : a))
                      : capArray(
                          [...s.recentActions, report],
                          MAX_RECENT_ACTIONS,
                        ),
                  };
                });
              }
              break;
            }

            case 'prediction': {
              const { type: _, ...prediction } = event;
              set((s) => ({
                predictions: capArray(
                  [...s.predictions, prediction],
                  MAX_PREDICTIONS,
                ),
                unreadCount: s.unreadCount + 1,
              }));
              break;
            }

            case 'investigation_report': {
              const { type: _, ...report } = event;
              set((s) => ({
                investigations: capArray([...s.investigations, report], MAX_INVESTIGATIONS),
                unreadCount: s.unreadCount + 1,
              }));
              break;
            }

            case 'verification_report': {
              const { type: _, ...report } = event;
              set((s) => ({
                verifications: capArray([...s.verifications, report], MAX_VERIFICATIONS),
                recentActions: s.recentActions.map((action) => (
                  action.id === report.actionId
                    ? {
                      ...action,
                      verificationStatus: report.status,
                      verificationEvidence: report.evidence,
                      verificationTimestamp: report.timestamp,
                    }
                    : action
                )),
                unreadCount: s.unreadCount + 1,
              }));
              break;
            }

            case 'resolution': {
              const { type: _, ...resolution } = event;
              set((s) => ({
                resolutions: capArray([...s.resolutions, resolution], MAX_RESOLUTIONS),
                findings: s.findings.filter((f) => f.id !== resolution.findingId),
                unreadCount: s.unreadCount + 1,
              }));
              // Only toast auto-fix resolutions — self-healed is too noisy
              // (scanner frequency tiers cause findings to appear/disappear)
              if (resolution.resolvedBy === 'auto-fix') {
                useUIStore.getState().addToast({
                  type: 'success',
                  tier: 'system',
                  title: `${resolution.title || 'Issue resolved'}`,
                  detail: 'Auto-fixed',
                });
              }
              break;
            }

            case 'findings_snapshot': {
              const activeIds = new Set(event.activeIds);
              set((s) => ({
                findings: s.findings.filter((f) => activeIds.has(f.id)),
              }));
              break;
            }

            case 'monitor_status': {
              set({
                activeWatches: event.activeWatches,
                lastScanTime: event.lastScan,
                nextScanTime: event.nextScan,
              });
              break;
            }

            case 'scan_report': {
              set({ scanReport: event });
              break;
            }

            case 'investigation_progress': {
              set((s) => ({
                findings: s.findings.map((f) =>
                  f.id === event.findingId
                    ? { ...f, investigationPhases: event.phases, planId: event.planId, planName: event.planName }
                    : f,
                ),
              }));
              break;
            }

            case 'skill_activity': {
              set((s) => ({
                activeSkill: event.skill_name,
                ...(event.handoff_from && event.handoff_to ? {
                  skillHandoffs: [...s.skillHandoffs.slice(-19), { from: event.handoff_from, to: event.handoff_to, timestamp: event.timestamp }],
                } : {}),
              }));
              break;
            }

            case 'inbox_item_created': {
              import('./inboxStore').then(({ useInboxStore }) => {
                useInboxStore.getState().refreshStats();
                useInboxStore.getState().refresh();
              });
              if (event.severity === 'critical') {
                useUIStore.getState().addToast({
                  type: 'warning',
                  tier: 'system',
                  title: event.title || 'New critical inbox item',
                });
              }
              break;
            }

            case 'inbox_item_updated':
            case 'inbox_item_claimed':
            case 'inbox_item_resolved': {
              import('./inboxStore').then(({ useInboxStore }) => {
                useInboxStore.getState().refreshStats();
                useInboxStore.getState().refresh();
              });
              break;
            }

            case 'error':
              console.error('Monitor error:', event.message);
              handleAuthError(event.message);
              set({ connectionError: event.message || 'Unknown monitor error' });
              break;
          }
        });

        // H11: read autoFixCategories from trustStore (single source of truth)
        const { trustLevel, autoFixCategories } = useTrustStore.getState();
        client.connect(
          trustLevel,
          autoFixCategories,
        );
      },

      disconnect: () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (client) {
          client.disconnect();
          client = null;
        }
        set({ connected: false });
      },

      triggerScan: () => {
        if (client) client.triggerScan();
      },

      setDisabledScanners: (scannerIds: string[]) => {
        if (client) client.setDisabledScanners(scannerIds);
      },

      dismissFinding: (id) => {
        set((s) => {
          const dismissed = [...s.dismissedFindingIds, id];
          return {
            findings: s.findings.filter((f) => f.id !== id),
            dismissedFindingIds: dismissed.slice(-500), // keep last 500
          };
        });
      },

      acknowledgeFinding: (id) => {
        set((s) => ({
          acknowledgedIds: s.acknowledgedIds.includes(id)
            ? s.acknowledgedIds
            : [...s.acknowledgedIds, id].slice(-500),
        }));
      },

      unacknowledgeFinding: (id) => {
        set((s) => ({
          acknowledgedIds: s.acknowledgedIds.filter((ackId) => ackId !== id),
        }));
      },

      approveAction: (actionId) => {
        if (client) client.approveAction(actionId);
      },

      rejectAction: (actionId) => {
        if (client) client.rejectAction(actionId);
        set((s) => ({
          pendingActions: s.pendingActions.filter((a) => a.id !== actionId),
        }));
      },

      setMonitorEnabled: (enabled) => {
        set({ monitorEnabled: enabled });
        if (enabled) {
          get().connect();
        } else {
          get().disconnect();
        }
      },

      loadFixHistory: async (page = 1, filters?) => {
        // H10: track request ID to discard stale responses
        const requestId = ++_fixHistoryRequestId;
        set({ fixHistoryLoading: true });
        try {
          const response = await fetchFixHistory({ page, filters });
          if (requestId !== _fixHistoryRequestId) return; // stale response
          set({
            fixHistory: response.actions,
            fixHistoryTotal: response.total,
            fixHistoryPage: response.page,
            fixHistoryLoading: false,
          });
        } catch (err) {
          if (requestId !== _fixHistoryRequestId) return; // stale
          console.error('Failed to load fix history:', err);
          set({ fixHistoryLoading: false });
        }
      },

      markAllRead: () => {
        set({ unreadCount: 0 });
      },

      toggleNotificationCenter: () => {
        set((s) => ({
          notificationCenterOpen: !s.notificationCenterOpen,
          // Mark as read when opening
          unreadCount: s.notificationCenterOpen ? s.unreadCount : 0,
        }));
      },
    }),
    {
      name: 'openshiftpulse-monitor',
      partialize: (state) => ({
        monitorEnabled: state.monitorEnabled,
        // H11: autoFixCategories persisted via trustStore, not here
        dismissedFindingIds: state.dismissedFindingIds,
        acknowledgedIds: state.acknowledgedIds,
        findings: state.findings.slice(-MAX_FINDINGS),
        predictions: state.predictions.slice(-MAX_PREDICTIONS),
        investigations: state.investigations.slice(-MAX_INVESTIGATIONS),
        verifications: state.verifications.slice(-MAX_VERIFICATIONS),
        recentActions: state.recentActions.slice(-MAX_RECENT_ACTIONS),
        resolutions: state.resolutions.slice(-MAX_RESOLUTIONS),
      }),
    },
  ),
);
