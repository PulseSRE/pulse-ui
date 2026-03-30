import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, ShieldAlert, ShieldCheck, Shield, FlaskConical, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ConfirmRequest } from '../../engine/agentClient';
import { describeToolAction, riskLevel } from './MessageBubble';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useTrustStore, TRUST_LABELS } from '../../store/trustStore';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useUIStore } from '../../store/uiStore';
import { cn } from '@/lib/utils';

/** Tools that can be easily rolled back */
const ROLLBACK_INFO: Record<string, string> = {
  scale_deployment: 'Scale back to the original replica count',
  cordon_node: 'Uncordon the node to restore scheduling',
  uncordon_node: 'Cordon the node again',
  restart_deployment: 'No rollback needed — pods restart with the same image',
  rollback_deployment: 'Roll forward to the version you just rolled back from',
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
      return `A ${input.policy_type} NetworkPolicy will control traffic in ${input.namespace}.`;
    case 'rollback_deployment':
      return `The deployment will revert to revision ${input.revision || 'previous'}, triggering a rolling update.`;
    case 'restart_deployment':
      return 'A rolling restart will cycle all pods with the current spec.';
    default:
      return null;
  }
}

interface ConfirmationCardProps {
  confirm: ConfirmRequest;
  onConfirm: (approved: boolean) => void;
}

export function ConfirmationCard({ confirm, onConfirm }: ConfirmationCardProps) {
  const risk = riskLevel(confirm.tool, confirm.input);
  const description = describeToolAction(confirm.tool, confirm.input);
  const impact = impactDescription(confirm.tool, confirm.input);
  const rollback = ROLLBACK_INFO[confirm.tool];

  const trustLevel = useTrustStore((s) => s.trustLevel);
  const shouldAutoApprove = useTrustStore((s) => s.shouldAutoApprove);
  const recordConfirmation = useTrustStore((s) => s.recordConfirmation);
  const addToast = useUIStore((s) => s.addToast);

  // "What If" simulation state
  const [showSimulation, setShowSimulation] = useState(false);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);
  const simulation = useAgentSession({ autoConnect: false });

  const RiskIcon = risk.level === 'HIGH' ? ShieldAlert : risk.level === 'MEDIUM' ? Shield : ShieldCheck;
  const riskBg = risk.level === 'HIGH' ? 'bg-red-950/40' : risk.level === 'MEDIUM' ? 'bg-amber-950/30' : 'bg-slate-800';
  const riskBorder = risk.level === 'HIGH' ? 'border-red-700' : risk.level === 'MEDIUM' ? 'border-amber-700' : 'border-slate-700';

  // Auto-approve based on trust level (fire once per confirm request)
  const autoApprovedRef = useRef(false);
  useEffect(() => {
    if (autoApprovedRef.current) return;
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

  // Keyboard shortcuts — only active when no text input is focused
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (risk.level === 'HIGH') return; // HIGH risk: no keyboard shortcuts
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); handleApprove(); }
      if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') { e.preventDefault(); handleDeny(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onConfirm, risk.level]);

  // Watch simulation responses
  useEffect(() => {
    if (simulation.messages.length > 0) {
      const lastMsg = simulation.messages[simulation.messages.length - 1];
      if (lastMsg.role === 'assistant') {
        setSimulationResult(lastMsg.content);
      }
    }
  }, [simulation.messages]);

  const handleApprove = () => {
    recordConfirmation({ tool: confirm.tool, approved: true, timestamp: Date.now(), riskLevel: risk.level as 'LOW' | 'MEDIUM' | 'HIGH' });
    onConfirm(true);
  };

  const handleDeny = () => {
    recordConfirmation({ tool: confirm.tool, approved: false, timestamp: Date.now(), riskLevel: risk.level as 'LOW' | 'MEDIUM' | 'HIGH' });
    onConfirm(false);
  };

  const [simulationError, setSimulationError] = useState(false);

  const handleSimulate = () => {
    setShowSimulation(true);
    setSimulationResult(null);
    setSimulationError(false);
    simulation.send(`What would happen if I ${description}? Don't execute — just predict the impact on the cluster. Be specific about affected resources and risks.`);

    // Timeout after 30s
    setTimeout(() => {
      if (!simulationResult) {
        setSimulationError(true);
      }
    }, 30000);
  };

  // Don't render if auto-approved
  if (shouldAutoApprove(confirm.tool, risk.level)) return null;

  // Trust Level 0 (Observe) — auto-deny, don't show action buttons
  const isObserveMode = trustLevel === 0;

  return (
    <div className={cn('rounded-lg border p-4', riskBorder, riskBg, risk.level === 'HIGH' && 'animate-pulse-subtle')}>
      <div className="flex items-start gap-3" role="alertdialog" aria-modal="true" aria-label="Confirm write operation">
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
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
              risk.level === 'HIGH' && 'bg-red-900/50 text-red-300',
              risk.level === 'MEDIUM' && 'bg-amber-900/50 text-amber-300',
              risk.level === 'LOW' && 'bg-green-900/50 text-green-300',
            )}>
              <RiskIcon className="h-3 w-3" aria-hidden="true" />
              {risk.level} RISK
            </span>
            <span className="text-xs text-slate-500">
              Trust: {TRUST_LABELS[trustLevel]} (L{trustLevel})
            </span>
          </div>

          {/* What will happen */}
          {impact && (
            <div className="rounded bg-slate-900/50 border border-slate-700 px-3 py-2">
              <h4 className="text-xs font-medium text-slate-400 mb-1">What will happen</h4>
              <p className="text-xs text-slate-300">{impact}</p>
            </div>
          )}

          {/* Rollback info */}
          {rollback && (
            <div className="rounded bg-slate-900/50 border border-slate-700 px-3 py-2">
              <h4 className="text-xs font-medium text-slate-400 mb-1">Rollback</h4>
              <p className="text-xs text-slate-300">{rollback}</p>
            </div>
          )}

          {/* "What If" Simulation */}
          {showSimulation && (
            <div className="rounded bg-slate-900/50 border border-blue-800 px-3 py-2">
              <button
                onClick={() => setShowSimulation(!showSimulation)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-300 mb-1 w-full"
              >
                <FlaskConical className="h-3 w-3" />
                Predicted Impact
                {simulationResult ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
              </button>
              {simulation.streaming && !simulationResult && !simulationError && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Simulating...
                </div>
              )}
              {(simulationError || simulation.error) && !simulationResult && (
                <div className="flex items-center gap-2 text-xs text-red-400 mt-1">
                  <span>{simulation.error || 'Simulation timed out'}</span>
                  <button onClick={handleSimulate} className="text-blue-400 hover:text-blue-300 underline">Retry</button>
                </div>
              )}
              {simulationResult && (
                <div className="text-xs text-slate-300 mt-1">
                  <MarkdownRenderer content={simulationResult} />
                </div>
              )}
            </div>
          )}

          {/* Raw parameters */}
          <details>
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">Show raw parameters</summary>
            <pre className="text-xs text-slate-400 bg-slate-900 rounded p-2 mt-1 overflow-auto max-h-32">
              {JSON.stringify(confirm.input, null, 2)}
            </pre>
          </details>

          {/* Action buttons */}
          {isObserveMode ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-400">Observe mode — write operations are blocked. Change trust level to enable actions.</p>
              <button
                onClick={handleDeny}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 text-slate-300 rounded transition-colors"
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
                  aria-label="Deny operation"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Deny
                </button>
                {!showSimulation && (
                  <button
                    onClick={handleSimulate}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
                    aria-label="Simulate impact"
                  >
                    <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                    What If?
                  </button>
                )}
                <button
                  onClick={handleApprove}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded transition-colors"
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
                  aria-label="Approve operation (Y)"
                >
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Approve <kbd className="ml-1 text-xs opacity-60 bg-green-900 px-1 rounded">Y</kbd>
                </button>
                {!showSimulation && (
                  <button
                    onClick={handleSimulate}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
                    aria-label="Simulate impact"
                  >
                    <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                    What If?
                  </button>
                )}
                <button
                  onClick={handleDeny}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                  aria-label="Deny operation (N)"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Deny <kbd className="ml-1 text-xs opacity-60 bg-red-900 px-1 rounded">N</kbd>
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
