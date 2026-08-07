import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import type { MetricExplanation } from '../../engine/analyticsExplanations';

export function StatCard({ label, value, icon, explanation }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  explanation?: MetricExplanation;
}) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 relative">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[11px] text-slate-400">{label}</span>
        {explanation && (
          <button
            onClick={() => setShowTip(!showTip)}
            className="ml-auto text-slate-600 hover:text-slate-400 transition-colors"
            aria-label={`Explain ${label}`}
          >
            <HelpCircle className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="text-lg font-semibold text-slate-100">{value}</div>
      {showTip && explanation && (
        <div className="mt-2 p-2 bg-slate-800 border border-slate-700 rounded-sm text-[10px] space-y-1">
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
    </div>
  );
}
