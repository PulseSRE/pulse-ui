import { History, GitCompareArrows } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface VersionEntry {
  version: number;
  label: string;
  filename: string;
  timestamp: string;
  current: boolean;
}

export function VersionsPanel({ versions, onDiff }: { versions: VersionEntry[]; onDiff: (v1: string, v2: string) => void }) {
  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500">
        <History className="w-8 h-8 mx-auto mb-2 text-slate-600" />
        No version history yet. Edit and save the skill to create versions.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-slate-300">Version History</h3>
      {versions.map((v, i) => (
        <div key={v.filename} className={cn(
          'bg-slate-900 border rounded-lg p-3 flex items-center justify-between',
          v.current ? 'border-blue-800/50' : 'border-slate-800',
        )}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-100">{v.label}</span>
              {v.current && <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded-sm">current</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {new Date(v.timestamp).toLocaleString()}
            </div>
          </div>
          {!v.current && i > 0 && (
            <button
              onClick={() => onDiff(v.filename, 'skill.md')}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-sm"
            >
              <GitCompareArrows className="w-3 h-3" /> Diff vs current
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
