import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '../primitives/Card';
import { Badge } from '../primitives/Badge';
import { GateCard } from './GateCard';
import { ReadinessScore } from './ReadinessScore';
import { WaiverDialog } from './WaiverDialog';
import type { ReadinessCategory, CategoryView, Waiver } from './types';
import type { WaiverStorage } from '../../engine/readiness/waivers';

interface ReadinessChecklistProps {
  score: number;
  categories: CategoryView[];
  /** Save a waiver; the dialog stays open, showing the error, if this throws. */
  onWaive: (gateId: string, reason: string, expiresAt: number | null) => void | Promise<void>;
  onReVerify: (gateId: string) => void;
  /** Waivers in force, keyed by gate id, for showing who waived what and when. */
  waivers?: Record<string, Waiver>;
  /** Where waivers are kept; told to the person waiving. */
  waiverStorage?: WaiverStorage;
  /** Why the waiver list could not be loaded, if it could not. */
  waiverLoadError?: string;
  onUnwaive?: (gateId: string) => void | Promise<void>;
  onSwitchToWizard: () => void;
}

/** Dashboard-style checklist with expandable category sections. */
export function ReadinessChecklist({ score, categories, onWaive, onReVerify, onSwitchToWizard, waivers, waiverStorage, waiverLoadError, onUnwaive }: ReadinessChecklistProps) {
  const [expanded, setExpanded] = React.useState<Set<ReadinessCategory>>(() => {
    // Auto-expand categories with failures
    const failing = new Set<ReadinessCategory>();
    for (const cat of categories) {
      if (cat.summary.failed > 0) {
        failing.add(cat.id);
      }
    }
    return failing;
  });
  const [waiverTarget, setWaiverTarget] = React.useState<string | null>(null);

  const toggle = (catId: ReadinessCategory) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const waiverGate = waiverTarget
    ? categories.flatMap((c) => c.gates).find((g) => g.id === waiverTarget)
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
      {/* Main checklist */}
      <div className="space-y-3">
        {categories.map((cat) => {
          const isOpen = expanded.has(cat.id);
          const { passed, failed, total } = cat.summary;

          return (
            <Card key={cat.id}>
              <button
                onClick={() => toggle(cat.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                  <div>
                    <span className="text-sm font-medium text-slate-200">
                      {cat.label}
                    </span>
                    <span className="text-xs text-faint ml-2">{cat.description}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="success" size="sm">{passed} passed</Badge>
                  {failed > 0 && <Badge variant="error" size="sm">{failed} failed</Badge>}
                  <span className="text-xs text-faint">
                    {passed}/{total}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-2 border-t border-slate-800 pt-3">
                  {cat.gates.map((gate) => (
                    <GateCard
                      key={gate.id}
                      gate={gate}
                      result={cat.results[gate.id]}
                      onReVerify={onReVerify}
                      onWaive={(gateId) => setWaiverTarget(gateId)}
                      waiver={waivers?.[gate.id]}
                      onUnwaive={onUnwaive}
                    />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Right sidebar — score */}
      <div className="space-y-4">
        <Card className="p-4">
          <ReadinessScore score={score} categories={categories} />
        </Card>

        <button
          onClick={onSwitchToWizard}
          className={cn(
            'w-full px-4 py-2 text-sm rounded-lg transition-colors',
            'text-blue-400 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20',
          )}
        >
          Open guided wizard
        </button>
      </div>

      {/* Waiver modal */}
      <WaiverDialog
        gateTitle={waiverGate?.title || ''}
        open={waiverTarget !== null}
        onClose={() => setWaiverTarget(null)}
        storage={waiverStorage}
        loadError={waiverLoadError}
        onConfirm={async (reason, expiresAt) => {
          if (!waiverTarget) return;
          await onWaive(waiverTarget, reason, expiresAt ?? null);
          setWaiverTarget(null);
        }}
      />
    </div>
  );
}
