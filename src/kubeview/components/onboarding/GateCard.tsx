import React from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, ShieldOff,
  Loader2, RefreshCw, ShieldCheck, Bot, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import type { GateStatus, ReadinessGate, GateResult } from '../../engine/readiness/types';
import { askPulse } from '../../engine/askPulse';

interface GateCardProps {
  gate: ReadinessGate;
  result?: GateResult;
  waived?: boolean;
  waiverReason?: string;
  onReVerify?: (gateId: string) => void;
  onWaive?: (gateId: string) => void;
}

const STATUS_CONFIG: Record<GateStatus, {
  icon: React.ReactNode;
  color: string;
  label: string;
}> = {
  not_started: { icon: <HelpCircle className="w-4 h-4" />, color: 'text-slate-500', label: 'Not Started' },
  checking:    { icon: <Loader2 className="w-4 h-4 animate-spin" />, color: 'text-blue-400', label: 'Checking' },
  passed:      { icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-emerald-400', label: 'Passed' },
  needs_attention: { icon: <AlertTriangle className="w-4 h-4" />, color: 'text-amber-400', label: 'Needs Attention' },
  failed:      { icon: <XCircle className="w-4 h-4" />, color: 'text-red-400', label: 'Failed' },
  waived:      { icon: <ShieldOff className="w-4 h-4" />, color: 'text-slate-400', label: 'Waived' },
};

export function GateCard({ gate, result, waived, waiverReason, onReVerify, onWaive }: GateCardProps) {
  const go = useNavigateTab();
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
            <span className="text-xs text-slate-500 block truncate">{gate.whyItMatters}</span>
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
            <div className="text-xs bg-violet-950/30 border border-violet-900/40 rounded-md p-3">
              <div className="font-medium text-violet-300 mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Remediation
              </div>
              <p className="text-violet-300/80">{result.fixGuidance}</p>
              {result.fixLink && (
                <a href={result.fixLink} className="text-violet-400 hover:text-violet-300 underline mt-1 block">
                  Go to fix →
                </a>
              )}
            </div>
          )}

          {waived && waiverReason && (
            <div className="text-xs text-slate-500 italic">Waived: {waiverReason}</div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {(status === 'failed' || status === 'needs_attention') && (
              <button
                onClick={() => {
                  askPulse(
                    `Fix this production readiness issue:\n\n"${gate.title}": ${result?.detail || gate.whyItMatters}\n\n${result?.fixGuidance || ''}\n\nPlease fix this or generate the required YAML configuration.`
                  );
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-violet-600 hover:bg-violet-500 rounded-md transition-colors"
              >
                <Bot className="w-3 h-3" /> Fix with AI
              </button>
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
          </div>
        </div>
      )}
    </div>
  );
}
