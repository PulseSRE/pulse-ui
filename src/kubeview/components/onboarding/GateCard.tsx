import React from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, ShieldOff,
  Loader2, RefreshCw, ShieldCheck, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import type { GateStatus, ReadinessGate, GateResult, Waiver } from '../../engine/readiness/types';
import { AskPulseButton } from '../agent/AskPulseButton';
import { formatDate as formatDateOnly } from '../../engine/format';

interface GateCardProps {
  gate: ReadinessGate;
  result?: GateResult;
  waived?: boolean;
  waiverReason?: string;
  /** The waiver in force for this gate: who waived it, when, why and until when. */
  waiver?: Waiver;
  onReVerify?: (gateId: string) => void;
  onWaive?: (gateId: string) => void;
  /** Lift the waiver. If it throws, the error is shown on the card and the waiver stays. */
  onUnwaive?: (gateId: string) => void | Promise<void>;
}

function formatDate(ms: number): string {
  return formatDateOnly(ms);
}

const STATUS_CONFIG: Record<GateStatus, {
  icon: React.ReactNode;
  color: string;
  label: string;
}> = {
  not_started: { icon: <HelpCircle className="w-4 h-4" />, color: 'text-faint', label: 'Not Started' },
  checking:    { icon: <Loader2 className="w-4 h-4 animate-spin" />, color: 'text-blue-400', label: 'Checking' },
  passed:      { icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-emerald-400', label: 'Passed' },
  needs_attention: { icon: <AlertTriangle className="w-4 h-4" />, color: 'text-amber-400', label: 'Needs Attention' },
  failed:      { icon: <XCircle className="w-4 h-4" />, color: 'text-red-400', label: 'Failed' },
  waived:      { icon: <ShieldOff className="w-4 h-4" />, color: 'text-slate-400', label: 'Waived' },
};

export function GateCard({ gate, result, waived, waiverReason, waiver, onReVerify, onWaive, onUnwaive }: GateCardProps) {
  const go = useNavigateTab();
  const [unwaiving, setUnwaiving] = React.useState(false);
  const [unwaiveError, setUnwaiveError] = React.useState<string | null>(null);
  const handleUnwaive = async () => {
    if (!onUnwaive) return;
    setUnwaiving(true);
    setUnwaiveError(null);
    try {
      await onUnwaive(gate.id);
    } catch (err) {
      setUnwaiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnwaiving(false);
    }
  };
  const status: GateStatus = waived ? 'waived' : (result?.status ?? 'not_started');
  const cfg = STATUS_CONFIG[status];
  const [expanded, setExpanded] = React.useState(status === 'failed' || status === 'needs_attention');

  return (
    <div
      className={cn(
        'rounded-lg border transition-colors',
        status === 'failed'
          ? 'border-red-900/60 bg-red-950/20'
          : status === 'needs_attention'
            ? 'border-amber-900/60 bg-amber-950/20'
            : 'border-slate-800 bg-slate-900/50',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={cfg.color}>{cfg.icon}</span>
          <div className="min-w-0">
            <span className="text-sm font-medium text-slate-200 block truncate">{gate.title}</span>
            <span className="text-xs text-faint block truncate">{gate.whyItMatters}</span>
          </div>
        </div>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-sm', cfg.color, 'bg-slate-800')}>
          {cfg.label}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-800/50 pt-3">
          {result?.detail && (
            <div className="text-xs text-slate-400 bg-slate-800/50 rounded-md p-3">
              <div className="font-medium text-slate-300 mb-1">Evidence</div>
              <p>{result.detail}</p>
            </div>
          )}

          {result?.fixGuidance && (status === 'failed' || status === 'needs_attention') && (
            <div className="text-xs bg-blue-950/30 border border-blue-900/40 rounded-md p-3">
              <div className="font-medium text-blue-300 mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Remediation
              </div>
              <p className="text-blue-300/80">{result.fixGuidance}</p>
              {result.fixLink && (
                <a href={result.fixLink} className="text-blue-400 hover:text-blue-300 underline mt-1 block">
                  Go to fix →
                </a>
              )}
            </div>
          )}

          {waived && waiverReason && !waiver && (
            <div className="text-xs text-faint italic">Waived: {waiverReason}</div>
          )}

          {status === 'passed' && waiver && (
            <div className="text-xs text-slate-400 bg-slate-800/50 rounded-md p-3 space-y-1" data-testid="waiver-details">
              {/* Not counted while the gate passes, but it still stands: if the gate
                  breaks again it would come back as "Waived" with this reason. */}
              <div className="font-medium text-slate-300">
                This gate now passes; its waiver is no longer needed.
              </div>
              <p>
                Still on file: waived{waiver.approvedBy ? ` by ${waiver.approvedBy}` : ''}
                {waiver.createdAt ? ` on ${formatDate(waiver.createdAt)}` : ''}
                {waiver.expiresAt !== null ? `, expires ${formatDate(waiver.expiresAt)}` : ', no expiry'}
                {' '}(<span className="italic">{waiver.reason}</span>). If the gate fails again it will be waived
                with this reason unless you remove it.
              </p>
              {unwaiveError && (
                <p role="alert" className="text-red-300">{unwaiveError}</p>
              )}
            </div>
          )}

          {status === 'waived' && waiver && (
            <div className="text-xs text-slate-400 bg-slate-800/50 rounded-md p-3 space-y-1" data-testid="waiver-details">
              <div className="font-medium text-slate-300">
                Waived{waiver.approvedBy ? ` by ${waiver.approvedBy}` : ''}
                {waiver.createdAt ? ` on ${formatDate(waiver.createdAt)}` : ''}
                {waiver.expiresAt !== null ? ` · expires ${formatDate(waiver.expiresAt)}` : ' · no expiry'}
              </div>
              <p className="italic">{waiver.reason}</p>
              {unwaiveError && (
                <p role="alert" className="text-red-300 not-italic">{unwaiveError}</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {(status === 'failed' || status === 'needs_attention') && (
              <AskPulseButton
                suffix="to fix"
                prompt={() => (
                  `Fix this production readiness issue:\n\n"${gate.title}": ${result?.detail || gate.whyItMatters}\n\n${result?.fixGuidance || ''}\n\nPlease fix this or generate the required YAML configuration.`
                )}
              />
            )}
            {result?.action && (
              <button
                onClick={() => go(result.action!.path, result.action!.label)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-300 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-800/40 rounded-md transition-colors"
              >
                {result.action.label} <ArrowRight className="w-3 h-3" />
              </button>
            )}
            {onReVerify && (
              <button
                onClick={() => onReVerify(gate.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Re-verify
              </button>
            )}
            {onWaive && status !== 'passed' && status !== 'waived' && (
              <button
                onClick={() => onWaive(gate.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-800 rounded-md transition-colors"
              >
                <ShieldOff className="w-3 h-3" /> Waive
              </button>
            )}
            {onUnwaive && waiver && (status === 'waived' || status === 'passed') && (
              <button
                onClick={handleUnwaive}
                disabled={unwaiving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-800 rounded-md transition-colors disabled:opacity-60"
              >
                <ShieldCheck className="w-3 h-3" /> {unwaiving ? 'Removing…' : 'Remove waiver'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
