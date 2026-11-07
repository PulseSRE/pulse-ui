import { cn } from '@/lib/utils';
import type { VersionEntry } from './VersionsPanel';

export function DiffPanel({
  versions, diffFiles, diffResult, onLoadDiff,
}: {
  versions: VersionEntry[];
  diffFiles: { v1: string; v2: string } | null;
  diffResult: string;
  onLoadDiff: (v1: string, v2: string) => void;
}) {
  const archived = versions.filter((v) => !v.current);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-300">Compare Versions</h3>

      {archived.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {archived.map((v) => (
            <button
              key={v.filename}
              onClick={() => onLoadDiff(v.filename, 'skill.md')}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-md transition-colors',
                diffFiles?.v1 === v.filename
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200',
              )}
            >
              {v.label} vs current
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xs text-faint">No previous versions to compare. Edit and save the skill to start tracking versions.</div>
      )}

      {diffResult && (
        <pre className="w-full max-h-[600px] overflow-auto px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg whitespace-pre-wrap">
          {diffResult.split('\n').map((line, i) => (
            <div
              key={i}
              className={cn(
                line.startsWith('+') && !line.startsWith('+++') ? 'text-emerald-400 bg-emerald-950/30' :
                line.startsWith('-') && !line.startsWith('---') ? 'text-red-400 bg-red-950/30' :
                line.startsWith('@@') ? 'text-blue-400' :
                'text-slate-400',
              )}
            >
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
