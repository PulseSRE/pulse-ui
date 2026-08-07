import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DiffPreviewProps {
  original: string;
  modified: string;
  onApply: () => void;
  onDiscard: () => void;
  loading?: boolean;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

interface DiffChange {
  path: string;
  type: 'added' | 'removed' | 'modified';
}

function computeDiff(original: string, modified: string): DiffLine[] {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  // Simple LCS-based diff algorithm
  const n = origLines.length;
  const m = modLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      result.push({ type: 'unchanged', content: origLines[i - 1], lineNumber: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', content: modLines[j - 1], lineNumber: j });
      j--;
    } else {
      result.push({ type: 'removed', content: origLines[i - 1], lineNumber: i });
      i--;
    }
  }

  return result.reverse();
}

function extractChangedPaths(diff: DiffLine[]): DiffChange[] {
  const changes: DiffChange[] = [];
  const pathRegex = /^(\s*)(\w+):/;

  for (const line of diff) {
    if (line.type === 'unchanged') continue;

    const match = line.content.match(pathRegex);
    if (match) {
      const path = match[2];
      const existing = changes.find(c => c.path === path);

      if (!existing) {
        changes.push({
          path,
          type: line.type === 'added' ? 'added' : line.type === 'removed' ? 'removed' : 'modified',
        });
      } else if (existing.type !== line.type) {
        existing.type = 'modified';
      }
    }
  }

  return changes;
}

export default function DiffPreview({
  original,
  modified,
  onApply,
  onDiscard,
  loading = false,
}: DiffPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const diff = useMemo(() => computeDiff(original, modified), [original, modified]);
  const changes = useMemo(() => extractChangedPaths(diff), [diff]);

  const stats = useMemo(() => {
    const added = diff.filter(l => l.type === 'added').length;
    const removed = diff.filter(l => l.type === 'removed').length;
    return { added, removed };
  }, [diff]);

  const changeSummary = useMemo(() => {
    if (changes.length === 0) return 'No changes detected';
    if (changes.length <= 3) {
      return changes.map(c => c.path).join(', ');
    }
    return `${changes.slice(0, 2).map(c => c.path).join(', ')} and ${changes.length - 2} more`;
  }, [changes]);

  return (
    <div className="border-t border-slate-700 bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/50">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium text-slate-200 hover:text-white transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <span>Changes: </span>
          <span className="text-emerald-400">+{stats.added}</span>
          <span className="text-slate-500">/</span>
          <span className="text-red-400">-{stats.removed}</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 mr-2">{changeSummary}</span>
          <button
            onClick={onDiscard}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5" />
            Discard
          </button>
          <button
            onClick={onApply}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Apply
              </>
            )}
          </button>
        </div>
      </div>

      {/* Diff Content */}
      {isExpanded && (
        <div className="max-h-96 overflow-y-auto border-t border-slate-700">
          <div className="font-mono text-xs">
            {diff.map((line, idx) => {
              // Only show changed lines and a bit of context
              const prevLine = diff[idx - 1];
              const nextLine = diff[idx + 1];
              const isContext = line.type === 'unchanged' &&
                               (!prevLine || prevLine.type === 'unchanged') &&
                               (!nextLine || nextLine.type === 'unchanged');

              if (isContext) return null;

              return (
                <div
                  key={idx}
                  className={cn(
                    'flex px-4 py-0.5 border-l-2',
                    line.type === 'added' && 'bg-emerald-950/30 border-emerald-500 text-emerald-400',
                    line.type === 'removed' && 'bg-red-950/30 border-red-500 text-red-400',
                    line.type === 'unchanged' && 'border-transparent text-slate-500'
                  )}
                >
                  <span className="w-6 shrink-0 text-slate-600 select-none">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre">{line.content || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
