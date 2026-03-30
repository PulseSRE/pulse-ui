import { MessageSquare, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useTrustStore,
  TRUST_LABELS,
  TRUST_DESCRIPTIONS,
  type TrustLevel,
  type CommunicationStyle,
} from '../../store/trustStore';

const COMM_OPTIONS: { value: CommunicationStyle; label: string; description: string }[] = [
  { value: 'brief', label: 'Brief', description: 'Short, actionable answers' },
  { value: 'detailed', label: 'Detailed', description: 'Full explanations with context' },
  { value: 'technical', label: 'Technical', description: 'Deep technical detail, CLI examples' },
];

export function PreferencesPanel() {
  const trustLevel = useTrustStore((s) => s.trustLevel);
  const setTrustLevel = useTrustStore((s) => s.setTrustLevel);
  const communicationStyle = useTrustStore((s) => s.communicationStyle);
  const setCommunicationStyle = useTrustStore((s) => s.setCommunicationStyle);

  return (
    <div className="space-y-6">
      {/* Trust Level */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-100">Trust Level</h3>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {([0, 1, 2, 3, 4] as TrustLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setTrustLevel(level)}
              className={cn(
                'px-2 py-2 rounded text-xs text-center transition-colors',
                trustLevel === level
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
              )}
            >
              <div className="font-medium">{level}</div>
              <div className="text-xs opacity-75">{TRUST_LABELS[level]}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">{TRUST_DESCRIPTIONS[trustLevel]}</p>
      </div>

      {/* Communication Style */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-100">Communication Style</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {COMM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setCommunicationStyle(opt.value)}
              className={cn(
                'px-3 py-2 rounded text-xs text-center transition-colors',
                communicationStyle === opt.value
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
              )}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-xs opacity-75 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        Preferences are saved locally and sent to the agent on each connection.
      </p>
    </div>
  );
}
