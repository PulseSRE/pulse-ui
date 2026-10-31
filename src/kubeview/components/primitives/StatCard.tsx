import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_CLASSES, type StatusTone } from '../../engine/statusColors';
import type { MetricExplanation } from '../../engine/analyticsExplanations';

/**
 * One stat tile. Replaces the private StatCards in views/toolbox and
 * views/compute (the compute one put onClick on a div, so it could not be
 * reached by keyboard, and used yellow where everything else used amber).
 */
export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Colour the value. Kept for existing callers; `tone` is the general form. */
  variant?: 'default' | 'success' | 'warning' | 'error';
  /** Colour the value (and the highlight border) from engine/statusColors. */
  tone?: StatusTone;
  /** Highlight the card border in the value's tone. */
  highlight?: boolean;
  icon?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** A count of problems: shown as a red chip and highlights the card in warning. */
  issues?: number;
  /** A 0–100 usage bar under the value. `null`/undefined hides it. */
  bar?: number | null;
  barTone?: StatusTone;
  /** "What does this mean?" toggle. */
  explanation?: MetricExplanation;
  /** Makes the card a real <button>. */
  onClick?: () => void;
  /** Smaller value text for dense analytics grids. */
  size?: 'md' | 'sm';
  className?: string;
}

const VARIANT_TONE: Record<NonNullable<StatCardProps['variant']>, StatusTone | null> = {
  default: null,
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

export function UsageBar({ pct, tone = 'progress', className }: { pct: number; tone?: StatusTone; className?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={cn('w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden', className)}
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full transition-all', TONE_CLASSES[tone].solid)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function StatCard({
  label,
  value,
  variant = 'default',
  tone,
  highlight,
  icon,
  subtitle,
  issues,
  bar,
  barTone,
  explanation,
  onClick,
  size = 'md',
  className,
}: StatCardProps) {
  const [showTip, setShowTip] = useState(false);
  const valueTone = tone ?? VARIANT_TONE[variant];
  const borderTone: StatusTone | null = issues ? 'warning' : highlight && valueTone ? valueTone : null;

  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className={cn('text-slate-400', size === 'sm' ? 'text-[11px]' : 'text-xs')}>{label}</span>
        {issues ? (
          <span className={cn('ml-auto text-xs px-1.5 py-0.5 rounded-sm', TONE_CLASSES.danger.chip)} aria-label={`${issues} issues`}>
            {issues}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          size === 'sm' ? 'text-lg font-semibold' : 'text-xl font-bold',
          valueTone ? TONE_CLASSES[valueTone].text : 'text-slate-100',
        )}
      >
        {value}
      </div>
      {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      {bar !== null && bar !== undefined && <UsageBar pct={bar} tone={barTone} className="mt-2" />}
    </>
  );

  return (
    <div
      className={cn(
        'relative bg-slate-900 rounded-lg border',
        borderTone ? TONE_CLASSES[borderTone].cardBorder : 'border-slate-800',
        onClick && 'hover:border-slate-600 transition-colors',
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="block w-full p-3 text-left rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {body}
        </button>
      ) : (
        <div className="p-3">{body}</div>
      )}
      {explanation && (
        <>
          <button
            type="button"
            onClick={() => setShowTip((v) => !v)}
            className="absolute top-3 right-3 text-slate-600 hover:text-slate-400 transition-colors"
            aria-label={`Explain ${label}`}
            aria-expanded={showTip}
          >
            <HelpCircle className="w-3 h-3" />
          </button>
          {showTip && (
            <div className="mx-3 mb-3 p-2 bg-slate-800 border border-slate-700 rounded-sm text-[10px] space-y-1">
              <div className="text-slate-300">{explanation.what}</div>
              <div className="text-emerald-400/80">{explanation.good}</div>
              <div className="text-red-400/80">{explanation.bad}</div>
              {explanation.actionLink ? (
                <a href={explanation.actionLink} className="text-blue-400 hover:underline block">{explanation.action}</a>
              ) : (
                <div className="text-slate-500">{explanation.action}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
