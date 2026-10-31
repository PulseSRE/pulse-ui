import { useState, useCallback } from 'react';
import { Lightbulb, X, Radar, MessageSquare } from 'lucide-react';
import { Card } from '../../components/primitives/Card';
import type { Recommendation } from '../../engine/analyticsApi';
import { askPulse } from '../../engine/askPulse';

const DISMISSED_KEY = 'openshiftpulse-dismissed-recommendations';

interface CapabilityDiscoveryProps {
  recommendations: Recommendation[];
}

export function CapabilityDiscovery({ recommendations }: CapabilityDiscoveryProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      return new Set(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set();
    }
  });

  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const recKey = (r: Recommendation) => `${r.type}:${r.title}`;
  const visible = recommendations.filter((r) => !dismissed.has(recKey(r)));

  if (visible.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-400" />
        You could also be using...
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visible.slice(0, 4).map((rec) => (
          <Card key={recKey(rec)}>
            <div className="p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {rec.type === 'scanner' ? (
                    <Radar className="w-4 h-4 text-blue-400 shrink-0" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-violet-400 shrink-0" />
                  )}
                  <h3 className="text-sm font-medium text-slate-200">{rec.title}</h3>
                </div>
                <button
                  onClick={() => dismiss(recKey(rec))}
                  className="text-slate-600 hover:text-slate-400 p-0.5"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{rec.description}</p>
              {/* "Enable scanner" is not offered: the agent has no endpoint to
                  enable a scanner from the UI yet, and a button that does
                  nothing is worse than none. */}
              {rec.action.kind === 'chat_prompt' && rec.action.prompt && (
                <button
                  onClick={() => askPulse(rec.action.prompt!)}
                  className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                >
                  Try in chat &rarr;
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
