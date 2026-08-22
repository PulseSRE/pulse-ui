import { useState } from 'react';
import { Shield, Eye, MessageSquare, Zap, Activity, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../../components/primitives/Card';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { useShallow } from 'zustand/react/shallow';
import { useTrustStore, TRUST_LABELS, TRUST_DESCRIPTIONS, type TrustLevel, type CommunicationStyle } from '../../store/trustStore';
import type { FixHistorySummary } from '../../engine/analyticsApi';

const TRUST_ICONS = [Eye, MessageSquare, Shield, Zap, Activity] as const;

const DEFAULT_AUTOFIX_CATEGORIES: AutofixCategory[] = [
  { id: 'crashloop', label: 'Crashlooping pods', description: 'Delete crashlooping pods (controller recreates)' },
  { id: 'workloads', label: 'Failed deployments', description: 'Rolling restart for degraded deployments' },
  { id: 'image_pull', label: 'Image pull errors', description: 'Restart deployment to clear image pull errors' },
];

interface AutofixCategory {
  id: string;
  label: string;
  description: string;
}

const COMM_STYLES: Array<{ id: CommunicationStyle; label: string; description: string }> = [
  { id: 'brief', label: 'Brief', description: 'Short, actionable answers' },
  { id: 'detailed', label: 'Detailed', description: 'Full explanations with context' },
  { id: 'technical', label: 'Technical', description: 'Deep detail, CLI examples' },
];

const LEVEL_CATEGORIES: Record<number, string[]> = {
  0: [],
  1: [],
  2: [],
  3: ['crashloop', 'workloads'],
  4: ['crashloop', 'workloads', 'image_pull'],
};

interface TrustPolicyProps {
  maxTrustLevel: number;
  /**
   * The level the agent's scan loop is actually running at.
   *
   * Distinct from the selected level, which is this browser's stored
   * preference: `useTrustStore` is zustand `persist` on localStorage, sent to
   * the agent on connect and never read back. The front-door badge was fixed
   * to read the server value; this page — the one that *configures* trust —
   * was still describing the browser's.
   *
   * Optional, because an agent too old to report it leaves the page no worse
   * off than before.
   */
  effectiveTrustLevel?: number;
  scannerCount: number;
  fixSummary: FixHistorySummary | null;
  supportedAutoFixCategories?: string[];
}

function buildCategoryLabel(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveCategories(serverCategories?: string[]): AutofixCategory[] {
  if (!serverCategories || serverCategories.length === 0) return DEFAULT_AUTOFIX_CATEGORIES;
  const defaultMap = new Map(DEFAULT_AUTOFIX_CATEGORIES.map((c) => [c.id, c]));
  return serverCategories.map((id) =>
    defaultMap.get(id) ?? { id, label: buildCategoryLabel(id), description: `Auto-fix for ${id.replace(/_/g, ' ')} issues` },
  );
}

export function TrustPolicy({ maxTrustLevel, effectiveTrustLevel, scannerCount, fixSummary, supportedAutoFixCategories }: TrustPolicyProps) {
  const { trustLevel, setTrustLevel, autoFixCategories, setAutoFixCategories, communicationStyle, setCommunicationStyle } =
    useTrustStore(useShallow((s) => ({
      trustLevel: s.trustLevel, setTrustLevel: s.setTrustLevel,
      autoFixCategories: s.autoFixCategories, setAutoFixCategories: s.setAutoFixCategories,
      communicationStyle: s.communicationStyle, setCommunicationStyle: s.setCommunicationStyle,
    })));

  const autofixCategories_ = resolveCategories(supportedAutoFixCategories);

  const [confirmLevel, setConfirmLevel] = useState<TrustLevel | null>(null);
  const [hoveredLevel, setHoveredLevel] = useState<TrustLevel | null>(null);
  const [autofixPaused, setAutofixPaused] = useState(false);

  const togglePause = async () => {
    const endpoint = autofixPaused ? '/api/agent/monitor/resume' : '/api/agent/monitor/pause';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.ok) setAutofixPaused(!autofixPaused);
    } catch { /* ignore */ }
  };

  const handleLevelClick = (level: TrustLevel) => {
    if (level > maxTrustLevel) return;
    if (level >= 3 && trustLevel < 3) {
      setConfirmLevel(level);
    } else {
      setTrustLevel(level);
    }
  };

  const previewLevel = hoveredLevel ?? trustLevel;
  // Describe what the agent is actually doing, not what this browser asked
  // for — except while hovering another level, where the point is to preview it.
  const describedLevel =
    hoveredLevel ?? ((effectiveTrustLevel ?? trustLevel) as TrustLevel);
  const policySummary = buildPolicySummary(describedLevel, scannerCount, autoFixCategories, communicationStyle);
  const runningElsewhere =
    effectiveTrustLevel !== undefined && effectiveTrustLevel !== trustLevel ? effectiveTrustLevel : null;
  const impactPreview = hoveredLevel !== null && hoveredLevel !== trustLevel
    ? buildImpactPreview(trustLevel, hoveredLevel, fixSummary)
    : null;

  return (
    <Card>
      <div className="p-5 space-y-5">
        {/* Emergency Pause */}
        {trustLevel >= 3 && (
          <button
            onClick={togglePause}
            className={cn(
              'w-full py-2 px-4 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors',
              autofixPaused
                ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/50 hover:bg-emerald-900/50'
                : 'bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-900/50',
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {autofixPaused ? 'Resume Auto-Fix' : 'Pause Auto-Fix (Emergency Kill Switch)'}
          </button>
        )}

        {/* Trust Level Selector */}
        <div>
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Trust Level</h2>
          <div className="flex gap-1">
            {([0, 1, 2, 3, 4] as TrustLevel[]).map((level) => {
              const Icon = TRUST_ICONS[level];
              const disabled = level > maxTrustLevel;
              const active = level === trustLevel;
              return (
                <button
                  key={level}
                  onClick={() => handleLevelClick(level)}
                  onMouseEnter={() => !disabled && setHoveredLevel(level)}
                  onMouseLeave={() => setHoveredLevel(null)}
                  disabled={disabled}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-1 rounded-lg px-3 py-3 text-xs transition-all border',
                    active
                      ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                      : disabled
                        ? 'opacity-30 cursor-not-allowed border-slate-800'
                        : 'border-slate-800 hover:border-slate-600 text-slate-400 hover:text-slate-200 cursor-pointer',
                  )}
                  title={disabled ? `Capped by server (max: ${maxTrustLevel})` : TRUST_DESCRIPTIONS[level]}
                >
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{TRUST_LABELS[level]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Policy Summary */}
        <p className="text-sm text-slate-300 leading-relaxed">{policySummary}</p>
        {runningElsewhere !== null && (
          <p className="mt-2 text-xs text-amber-400/90">
            This browser has {TRUST_LABELS[trustLevel]} ({trustLevel}) selected, but the agent is
            running at {TRUST_LABELS[runningElsewhere as TrustLevel]} ({runningElsewhere}), set on
            the server. The description above is the agent's.
          </p>
        )}

        {/* Impact Preview (on hover) */}
        {impactPreview && (
          <div className="flex items-start gap-2 text-xs text-amber-300/80 bg-amber-500/5 rounded-md px-3 py-2 border border-amber-500/10">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{impactPreview}</span>
          </div>
        )}

        {/* Auto-fix Categories */}
        <div className={cn('space-y-2', trustLevel < 2 && 'opacity-40')}>
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Auto-fix categories</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            When the monitor detects these issues, the agent applies a fix automatically. Each fix is recorded with a before-state snapshot for rollback. If a fix fails, the agent stops and surfaces the finding to you — it won't retry or escalate on its own.
          </p>
          <div className="space-y-1.5">
            {autofixCategories_.map((cat) => {
              const enabled = autoFixCategories.includes(cat.id);
              const disabled = trustLevel < 2;
              return (
                <button
                  key={cat.id}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setAutoFixCategories(
                      enabled
                        ? autoFixCategories.filter((c) => c !== cat.id)
                        : [...autoFixCategories, cat.id],
                    );
                  }}
                  className={cn(
                    'flex items-start gap-3 w-full rounded-md px-3 py-2 text-left text-xs border transition-colors',
                    enabled && !disabled
                      ? 'bg-violet-500/10 border-violet-500/40 text-violet-300'
                      : 'border-slate-700/50 text-slate-500',
                    !disabled && 'hover:border-slate-500 cursor-pointer',
                  )}
                >
                  <div className={cn('mt-0.5 w-3 h-3 rounded-sm border shrink-0', enabled && !disabled ? 'bg-violet-500 border-violet-400' : 'border-slate-600')} />
                  <div>
                    <div className="font-medium">{cat.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{cat.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Communication Style */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Style:</span>
          <div className="flex gap-1">
            {COMM_STYLES.map((style) => (
              <button
                key={style.id}
                onClick={() => setCommunicationStyle(style.id)}
                className={cn(
                  'px-2.5 py-1 rounded-sm text-xs transition-colors',
                  communicationStyle === style.id
                    ? 'bg-slate-700 text-slate-200'
                    : 'text-slate-500 hover:text-slate-300',
                )}
                title={style.description}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        {/* Warning banner for trust >= 3 */}
        {trustLevel >= 3 && (
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/5 rounded-md px-3 py-2 border border-amber-500/10">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Auto-fixes execute automatically and are recorded in Fix History. Some actions cannot be rolled back.</span>
          </div>
        )}
      </div>

      {/* Confirmation dialog for level 3+ */}
      <ConfirmDialog
        open={confirmLevel !== null}
        onClose={() => setConfirmLevel(null)}
        onConfirm={() => { if (confirmLevel !== null) setTrustLevel(confirmLevel); setConfirmLevel(null); }}
        title="Enable Auto-Fix?"
        description={`At Trust Level ${confirmLevel ?? 3}, the agent will automatically fix certain issues without asking. You can configure which categories below.`}
        confirmLabel="Enable"
        variant="warning"
      />
    </Card>
  );
}

function buildPolicySummary(level: TrustLevel, scanners: number, categories: string[], style: CommunicationStyle): string {
  const catNames = categories.length > 0 ? categories.join(', ').replace(/_/g, ' ') : 'none';

  switch (level) {
    case 0:
      return `Your agent monitors ${scanners} scanners and reports findings. It takes no actions. Communication: ${style}.`;
    case 1:
      // Level 1 does not suggest fixes. `auto_fix` is only entered at trust
      // >= 2, so nothing is ever proposed and there is nothing to approve.
      // This sentence was the same falsehood as the old "Confirm" label, in a
      // second copy of the ladder that the relabel missed.
      return `Your agent monitors ${scanners} scanners and reports findings. You act on them; it never remediates on its own. Communication: ${style}.`;
    case 2:
      return `Your agent monitors ${scanners} scanners and proposes fixes for your review before acting. Communication: ${style}.`;
    case 3:
      return `Your agent monitors ${scanners} scanners, auto-fixes ${catNames}, and asks before anything risky. Communication: ${style}.`;
    case 4:
      return `Your agent monitors ${scanners} scanners and auto-fixes all enabled categories (${catNames}). All actions are logged. Communication: ${style}.`;
    default:
      return '';
  }
}

function buildImpactPreview(current: TrustLevel, target: TrustLevel, fixSummary: FixHistorySummary | null): string | null {
  if (!fixSummary || fixSummary.total_actions === 0) {
    if (target > current) {
      const newCats = LEVEL_CATEGORIES[target]?.filter((c) => !(LEVEL_CATEGORIES[current] || []).includes(c)) || [];
      if (newCats.length > 0) {
        return `Moving to Level ${target} would also auto-fix: ${newCats.join(', ').replace(/_/g, ' ')}.`;
      }
    }
    return `Level ${target}: ${TRUST_DESCRIPTIONS[target]}`;
  }

  if (target > current) {
    const newCats = LEVEL_CATEGORIES[target]?.filter((c) => !(LEVEL_CATEGORIES[current] || []).includes(c)) || [];
    const additionalFixes = (fixSummary.by_category ?? [])
      .filter((c) => newCats.includes(c.category))
      .reduce((sum, c) => sum + c.confirmation_required, 0);

    if (additionalFixes > 0) {
      return `Moving to Level ${target} would also auto-fix ${newCats.join(', ').replace(/_/g, ' ')}. Last week, this would have resolved ${additionalFixes} additional incidents without asking.`;
    }
  }
  return `Level ${target}: ${TRUST_DESCRIPTIONS[target]}`;
}
