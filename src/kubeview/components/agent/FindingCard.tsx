import { useState } from 'react';
import { AlertTriangle, Info, Search, X, Wrench, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../../engine/formatters';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import type { Finding } from '../../engine/monitorClient';

export type { Finding };

export interface FindingCardProps {
  finding: Finding;
  onInvestigate?: (finding: Finding) => void;
  onDismiss?: (id: string) => void;
  onAutoFix?: (id: string) => void;
  compact?: boolean;
}

const SEVERITY_BORDER: Record<Finding['severity'], string> = {
  critical: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
};

const SEVERITY_BADGE: Record<Finding['severity'], { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-900/50', text: 'text-red-300', label: 'Critical' },
  warning: { bg: 'bg-amber-900/50', text: 'text-amber-300', label: 'Warning' },
  info: { bg: 'bg-blue-900/50', text: 'text-blue-300', label: 'Info' },
};

const SEVERITY_ICON: Record<Finding['severity'], typeof AlertTriangle> = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};


export function FindingCard({ finding, onInvestigate, onDismiss, onAutoFix, compact }: FindingCardProps) {
  const badge = SEVERITY_BADGE[finding.severity];
  const Icon = SEVERITY_ICON[finding.severity];
  const isNoisy = (finding.noiseScore ?? 0) >= 0.5;
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirmAutoFix, setConfirmAutoFix] = useState(false);
  const maxResources = 3;
  const visibleResources = finding.resources.slice(0, maxResources);
  const remaining = finding.resources.length - maxResources;

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-700 border-l-4 bg-slate-800',
        SEVERITY_BORDER[finding.severity],
        isNoisy && 'opacity-50',
        compact ? 'px-3 py-2' : 'p-4',
      )}
      data-testid={`finding-card-${finding.id}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <Icon className={cn('shrink-0', badge.text, compact ? 'h-3.5 w-3.5 mt-0.5' : 'h-4 w-4 mt-0.5')} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 font-medium', badge.bg, badge.text, compact ? 'text-xs' : 'text-xs')}>
              {badge.label}
            </span>
            <span className="text-xs text-slate-500">{finding.category}</span>
            {finding.confidence != null && (
              <span
                className={cn(
                  'text-xs font-mono',
                  finding.confidence >= 0.8 ? 'text-slate-400' : finding.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400',
                )}
                title={`Agent confidence: ${Math.round(finding.confidence * 100)}%`}
                aria-label={`Agent confidence: ${Math.round(finding.confidence * 100)}%`}
              >
                {Math.round(finding.confidence * 100)}%
              </span>
            )}
            <span className="ml-auto flex items-center gap-1 text-xs text-slate-500 shrink-0">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatRelativeTime(finding.timestamp)}
            </span>
          </div>
          <h4 className={cn('font-medium text-slate-100 mt-1', compact ? 'text-xs' : 'text-sm')}>
            {finding.title}
          </h4>

          {/* Summary - hidden in compact mode */}
          {!compact && (
            <p className="mt-1 text-sm text-slate-400">{finding.summary}</p>
          )}

          {/* Resources */}
          {visibleResources.length > 0 && (
            <div className={cn('flex flex-wrap gap-1.5', compact ? 'mt-1' : 'mt-2')}>
              {visibleResources.map((r) => (
                <span
                  key={`${r.kind}-${r.namespace || ''}-${r.name}`}
                  className="inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 text-xs font-mono text-slate-300"
                >
                  {r.kind}/{r.namespace ? `${r.namespace}/` : ''}{r.name}
                </span>
              ))}
              {remaining > 0 && (
                <span className="inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 text-xs text-slate-500">
                  +{remaining} more
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className={cn('flex items-center gap-2', compact ? 'mt-1.5' : 'mt-3')}>
            {onInvestigate && (
              <button
                onClick={() => onInvestigate(finding)}
                className={cn(
                  'flex items-center gap-1 rounded bg-slate-700 text-slate-200 transition-colors hover:bg-slate-600',
                  compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
                )}
              >
                <Search className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} aria-hidden="true" />
                Investigate
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => setConfirmDismiss(true)}
                className={cn(
                  'flex items-center gap-1 rounded bg-slate-700 text-slate-400 transition-colors hover:bg-slate-600 hover:text-slate-200',
                  compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
                )}
              >
                <X className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} aria-hidden="true" />
                Dismiss
              </button>
            )}
            {finding.autoFixable && onAutoFix && (
              <button
                onClick={() => setConfirmAutoFix(true)}
                className={cn(
                  'flex items-center gap-1 rounded bg-emerald-700 text-white transition-colors hover:bg-emerald-600',
                  compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
                )}
              >
                <Wrench className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')} aria-hidden="true" />
                Auto-Fix
              </button>
            )}
          </div>
        </div>
      </div>

      {onDismiss && (
        <ConfirmDialog
          open={confirmDismiss}
          onClose={() => setConfirmDismiss(false)}
          onConfirm={() => { onDismiss(finding.id); setConfirmDismiss(false); }}
          title="Dismiss Finding"
          description={`Dismiss "${finding.title}"? It will be hidden until it reappears on the next scan.`}
          confirmLabel="Dismiss"
          variant="warning"
        />
      )}
      {onAutoFix && (
        <ConfirmDialog
          open={confirmAutoFix}
          onClose={() => setConfirmAutoFix(false)}
          onConfirm={() => { onAutoFix(finding.id); setConfirmAutoFix(false); }}
          title="Auto-Fix Finding"
          description={`Apply automatic fix for "${finding.title}"?\n\nCategory: ${finding.category}\nResources: ${finding.resources.map(r => `${r.kind}/${r.name}`).join(', ')}\n\nThe agent will attempt to resolve this by restarting or deleting the affected resource. This action is logged and rollbackable for deployment restarts.`}
          confirmLabel="Apply Fix"
          variant="warning"
        />
      )}
    </div>
  );
}
