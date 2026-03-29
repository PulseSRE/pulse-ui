import React from 'react';
import { Activity, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../primitives/Card';
import type { AuditItem, HealthAuditPanelProps } from './types';

/**
 * Shared health-audit panel used by domain views (Workloads, Storage, Compute,
 * Networking, Access Control). Each view builds its own `AuditCheck[]` array
 * with domain-specific logic, then delegates all rendering to this component.
 */
export function HealthAuditPanel({
  checks,
  title,
  iconColorClass = 'text-blue-400',
  onNavigateItem,
  navigateLabel,
  renderItemBadges,
  maxFailingItems = 10,
}: HealthAuditPanelProps) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = checks.length > 0 ? Math.round((totalPassing / checks.length) * 100) : 100;

  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className={cn('w-4 h-4', iconColorClass)} /> {title}
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold', score === 100 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400')}>
            {score}%
          </span>
          <span className="text-xs text-slate-500">{totalPassing}/{checks.length} passing</span>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {checks.map((check) => {
          const pass = check.failing.length === 0;
          const expanded = expandedCheck === check.id;
          return (
            <div key={check.id}>
              <button
                onClick={() => setExpandedCheck(expanded ? null : check.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {pass
                    ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                    : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div>
                    <span className="text-sm text-slate-200">{check.title}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {pass
                        ? `${check.passing.length} pass`
                        : `${check.failing.length} of ${check.failing.length + check.passing.length} need attention`}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-600">{expanded ? '\u25BE' : '\u25B8'}</span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-slate-400">{check.description}</p>

                  {/* Why it matters */}
                  <div className="bg-blue-950/20 border border-blue-900/50 rounded p-3">
                    <div className="text-xs font-medium text-blue-300 mb-1">Why it matters</div>
                    <p className="text-xs text-slate-400">{check.why}</p>
                  </div>

                  {/* Failing items */}
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">
                        {check.failingLabel ?? `Missing (${check.failing.length})`}
                      </div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, maxFailingItems).map((item, idx) => {
                          const displayName = itemName(item, idx);
                          const ns = item.metadata?.namespace;
                          const label = navigateLabel ? navigateLabel(check, item) : 'View';

                          return (
                            <button
                              key={item.metadata?.uid || idx}
                              onClick={() => onNavigateItem?.(check, item, idx)}
                              className="flex items-center justify-between w-full py-1 px-2 rounded hover:bg-slate-800/50 text-left transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-xs text-slate-300">{displayName}</span>
                                {ns && <span className="text-xs text-slate-600">{ns}</span>}
                                {renderItemBadges?.(check, item)}
                              </div>
                              {onNavigateItem && <span className="text-xs text-blue-400">{label} &rarr;</span>}
                            </button>
                          );
                        })}
                        {check.failing.length > maxFailingItems && (
                          <div className="text-xs text-slate-600 px-2">+{check.failing.length - maxFailingItems} more</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Passing items */}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">
                        {check.passingLabel ?? `Passing (${check.passing.length})`}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((item, idx) => (
                          <span key={item.metadata?.uid || idx} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">
                            {itemName(item, idx)}
                          </span>
                        ))}
                        {check.passing.length > 8 && (
                          <span className="text-xs text-slate-600">+{check.passing.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* YAML example */}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">
                      {check.fixLabel ?? 'How to fix:'}
                    </div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto whitespace-pre-wrap">{check.yamlExample}</pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Resolve a display name for an audit item. */
function itemName(item: AuditItem, idx: number): string {
  return item.metadata?.name || item.name || `item-${idx}`;
}
