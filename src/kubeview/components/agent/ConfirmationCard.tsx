import { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle, XCircle, ShieldAlert, ShieldCheck, Shield } from 'lucide-react';
import type { ConfirmRequest } from '../../engine/agentClient';
import { describeToolAction, riskLevel } from './MessageBubble';
import { useTrustStore, TRUST_LABELS } from '../../store/trustStore';
import { useUIStore } from '../../store/uiStore';
import { cn } from '@/lib/utils';
import { WriteChange, WriteFacts, WriteWhere, type DryRunState } from '../primitives/WriteConfirmDialog';
import { useCanI } from '../../hooks/useCanI';
import { useFleetStore } from '../../store/fleetStore';
import { LOCAL_CLUSTER_ID } from '../../engine/clusterConnection';
import { SilencePreview, silencePreviewInvalid } from './SilencePreview';
import { RestartConsumersPreview, restartCount, restartPreviewInvalid } from './RestartConsumersPreview';
import { networkPolicyImpact } from './networkPolicyImpact';

const SILENCE_TOOLS = new Set(['create_silence', 'expire_silence']);

/** Tools that can be easily rolled back */
const ROLLBACK_INFO: Record<string, string> = {
  scale_deployment: 'Scale back to the original replica count',
  cordon_node: 'Uncordon the node to restore scheduling',
  uncordon_node: 'Cordon the node again',
  restart_deployment: 'No rollback needed — pods restart with the same image',
  rollback_deployment: 'Roll forward to the version you just rolled back from',
  expire_silence: 'Create the silence again with the same matchers',
  restart_consumers: 'No rollback needed — pods restart with the same spec',
};

/** Estimate what will happen for each tool */
function impactDescription(tool: string, input: Record<string, unknown>): string | null {
  switch (tool) {
    case 'scale_deployment':
      return `${Number(input.replicas) > 0 ? `${input.replicas} pod(s) will be scheduled` : 'All pods will be terminated'}`;
    case 'delete_pod':
      return 'The pod will be terminated. If managed by a controller, a replacement will be created.';
    case 'drain_node':
      return 'All pods on this node will be evicted, respecting PodDisruptionBudgets.';
    case 'cordon_node':
      return 'No new pods will be scheduled on this node. Existing pods are unaffected.';
    case 'apply_yaml':
      return input.dry_run ? 'Dry-run only — no changes will be applied.' : 'The resource will be created or updated in the cluster.';
    case 'create_network_policy':
      return networkPolicyImpact(input);
    case 'rollback_deployment':
      return `The deployment will revert to revision ${input.revision || 'previous'}, triggering a rolling update.`;
    case 'restart_deployment':
      return 'A rolling restart will cycle all pods with the current spec.';
    case 'create_silence':
      return 'Alerts matching these matchers stop notifying until the silence ends. They still show in Alerts as silenced.';
    case 'expire_silence':
      return 'The silence ends now and the alerts it muted notify again.';
    case 'restart_consumers':
      return 'Each listed workload gets a rolling restart so its pods start with the current values. The restarts start one after another; Pulse does not wait for each rollout.';
    default:
      return null;
  }
}

/**
 * The access review for a chat write the agent runs with the person's
 * forwarded token. Only tools whose single Kubernetes call is known are
 * checked; anything else is left to the API server, which refuses it itself.
 */
function accessFor(tool: string, input: Record<string, unknown>): { verb: string; group: string; resource: string; namespace?: string; subresource?: string } | null {
  const ns = typeof input.namespace === 'string' ? input.namespace : undefined;
  switch (tool) {
    case 'scale_deployment': return ns ? { verb: 'patch', group: 'apps', resource: 'deployments', namespace: ns, subresource: 'scale' } : null;
    case 'restart_deployment': return ns ? { verb: 'patch', group: 'apps', resource: 'deployments', namespace: ns } : null;
    case 'delete_pod': return ns ? { verb: 'delete', group: '', resource: 'pods', namespace: ns } : null;
    case 'cordon_node':
    case 'uncordon_node': return { verb: 'patch', group: '', resource: 'nodes' };
    default: return null;
  }
}

interface ConfirmationCardProps {
  /** `clusterId`: where the write lands (the agent's cluster). */
  confirm: ConfirmRequest & { clusterId?: string };
  onConfirm: (approved: boolean) => void;
}

export function ConfirmationCard({ confirm, onConfirm }: ConfirmationCardProps) {
  const risk = riskLevel(confirm.tool, confirm.input);
  const description = describeToolAction(confirm.tool, confirm.input);
  const impact = impactDescription(confirm.tool, confirm.input);
  const rollback = ROLLBACK_INFO[confirm.tool];
  const isSilence = SILENCE_TOOLS.has(confirm.tool);
  const isRestart = confirm.tool === 'restart_consumers';
  // The agent already said the tool will refuse: approving would only run a refusal.
  const refused = isSilence ? silencePreviewInvalid(confirm.preview) : isRestart ? restartPreviewInvalid(confirm.preview) : null;
  // A silence's preview is the agent's check of the exact request, and a restart's carries a
  // server-side dry run of every patch: show either as the dry run.
  const restarts = restartCount(confirm.preview);
  const dryRun: DryRunState = !(isSilence || isRestart) || !confirm.preview ? { state: 'unavailable' }
    : refused ? { state: 'failed', message: refused }
    : isRestart ? { state: 'passed', message: `Passed · the API server accepted ${restarts === 1 ? 'the restart' : `all ${restarts ?? 0} restarts`} as you (dry run)` }
    : { state: 'passed', message: "Passed · Pulse's preview accepts this silence" };

  const trustLevel = useTrustStore((s) => s.trustLevel);
  const shouldAutoApprove = useTrustStore((s) => s.shouldAutoApprove);
  const recordConfirmation = useTrustStore((s) => s.recordConfirmation);
  const addToast = useUIStore((s) => s.addToast);
  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  const targetClusterId = confirm.clusterId ?? LOCAL_CLUSTER_ID;
  // The person's own permission, asked of the cluster the write lands on (when that is the one shown).
  const access = accessFor(confirm.tool, confirm.input);
  const can = useCanI(access?.verb ?? 'patch', access?.group ?? '', access?.resource ?? '', access?.namespace, access?.subresource, { enabled: !!access && activeClusterId === targetClusterId });
  const rbacBlock = !access || activeClusterId !== targetClusterId ? null
    : can.isLoading ? 'Checking your permission…'
    : can.allowed ? null
    : `You do not have permission to ${access.verb} ${access.resource}${access.subresource ? `/${access.subresource}` : ''}${access.namespace ? ` in ${access.namespace}` : ''}. Approving would ask the agent to do what you are not allowed to do.`;

  const RiskIcon = risk.level === 'HIGH' ? ShieldAlert : risk.level === 'MEDIUM' ? Shield : ShieldCheck;
  const riskBg = risk.level === 'HIGH' ? 'bg-red-950/40' : risk.level === 'MEDIUM' ? 'bg-amber-950/30' : 'bg-slate-800';
  const riskBorder = risk.level === 'HIGH' ? 'border-red-700' : risk.level === 'MEDIUM' ? 'border-amber-700' : 'border-slate-700';

  // Auto-approve based on trust level (fire once per confirm request)
  const autoApprovedRef = useRef(false);
  useEffect(() => {
    if (autoApprovedRef.current) return;
    // A silence hides alerts from the on-call: always a person's decision, at every trust level.
    if (refused || isSilence) return;
    if (shouldAutoApprove(confirm.tool, risk.level)) {
      autoApprovedRef.current = true;
      recordConfirmation({ tool: confirm.tool, approved: true, timestamp: Date.now(), riskLevel: risk.level as 'LOW' | 'MEDIUM' | 'HIGH' });
      addToast({
        type: 'success',
        title: `Auto-approved (Trust Level ${trustLevel})`,
        detail: description,
        duration: 3000,
      });
      onConfirm(true);
    }
  }, [confirm.tool]);

  const handleApprove = useCallback(() => {
    if (trustLevel === 0 || refused) return;
    recordConfirmation({ tool: confirm.tool, approved: true, timestamp: Date.now(), riskLevel: risk.level as 'LOW' | 'MEDIUM' | 'HIGH' });
    onConfirm(true);
  }, [trustLevel, refused, confirm.tool, risk.level, recordConfirmation, onConfirm]);

  const handleDeny = useCallback(() => {
    recordConfirmation({ tool: confirm.tool, approved: false, timestamp: Date.now(), riskLevel: risk.level as 'LOW' | 'MEDIUM' | 'HIGH' });
    onConfirm(false);
  }, [confirm.tool, risk.level, recordConfirmation, onConfirm]);

  // Keyboard shortcuts — only active when no text input is focused, and never
  // from inside another modal: Y in an open dialog must not approve this write.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const modal = e.target instanceof Element ? e.target.closest('[aria-modal="true"]') : null;
      if (modal && modal !== cardRef.current) return;
      if (risk.level === 'HIGH') return; // HIGH risk: no keyboard shortcuts
      if (trustLevel !== 0 && !rbacBlock && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); handleApprove(); }
      if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') { e.preventDefault(); handleDeny(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [risk.level, trustLevel, rbacBlock, handleApprove, handleDeny]);

  // Don't render if auto-approved
  if (shouldAutoApprove(confirm.tool, risk.level) && !refused && !isSilence) return null;

  // Trust Level 0 (Observe) — auto-deny, don't show action buttons
  const isObserveMode = trustLevel === 0;

  return (
    <div className={cn('rounded-lg border p-4', riskBorder, riskBg, risk.level === 'HIGH' && 'animate-pulse-subtle')}>
      <div className="flex items-start gap-3" ref={cardRef} role="alertdialog" aria-modal="true" aria-label="Confirm write operation">
        <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 space-y-3">
          {/* Title + description */}
          <div>
            <h3 className="text-sm font-medium text-amber-200 mb-1">Confirm write operation</h3>
            <p className="text-sm text-slate-200">{description}</p>
          </div>

          {/* Risk badge + trust level */}
          <div className="flex items-center gap-2">
            <span className={cn(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-medium',
              risk.level === 'HIGH' && 'bg-red-900/50 text-red-300',
              risk.level === 'MEDIUM' && 'bg-amber-900/50 text-amber-300',
              risk.level === 'LOW' && 'bg-green-900/50 text-green-300',
            )}>
              <RiskIcon className="h-3 w-3" aria-hidden="true" />
              {risk.level} RISK
            </span>
            <span className="text-xs text-faint">
              Trust: {TRUST_LABELS[trustLevel]} (L{trustLevel})
            </span>
          </div>

          {/* Where it lands, as the write-confirm dialog says it */}
          <p className="text-xs text-slate-300">
            <WriteWhere namespace={typeof confirm.input.namespace === 'string' ? confirm.input.namespace : undefined} clusterId={targetClusterId} actingAs="agent-user" />
          </p>

          {/* What will change: the agent sends no diff, so the tool and its parameters */}
          <WriteChange params={{ action: confirm.tool, input: confirm.input }} collapsed />

          {isSilence && <SilencePreview tool={confirm.tool} input={confirm.input} preview={confirm.preview} />}
          {isRestart && <RestartConsumersPreview input={confirm.input} preview={confirm.preview} />}

          {/* Impact, dry run and undo (rollback), as the write-confirm dialog shows them */}
          <WriteFacts impact={impact ?? undefined} dryRun={dryRun} undo={rollback} />

          {/* Action buttons */}
          {isObserveMode || rbacBlock ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-400">{isObserveMode ? 'Observe mode — write operations are blocked. Change trust level to enable actions.' : rbacBlock}</p>
              <button
                onClick={handleDeny}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 text-slate-300 rounded-sm transition-colors"
              >
                Dismiss
              </button>
            </div>
          ) : (
          <div className="flex items-center gap-2">
            {risk.level === 'HIGH' ? (
              <>
                <button
                  onClick={handleDeny}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-sm transition-colors"
                  aria-label="Deny operation"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Deny
                </button>
                <button
                  onClick={handleApprove}
                  disabled={!!refused}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Approve high-risk operation"
                >
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Approve
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleApprove}
                  disabled={!!refused}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Approve operation (Y)"
                >
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Approve <kbd className="ml-1 text-xs opacity-60 bg-green-900 px-1 rounded-sm">Y</kbd>
                </button>
                <button
                  onClick={handleDeny}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded-sm transition-colors"
                  aria-label="Deny operation (N)"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Deny <kbd className="ml-1 text-xs opacity-60 bg-red-900 px-1 rounded-sm">N</kbd>
                </button>
              </>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
