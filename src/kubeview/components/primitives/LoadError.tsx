import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeReadError } from '../../engine/readError';

interface LoadErrorProps {
  /** What could not be loaded or done, e.g. "Learned runbooks could not be loaded". */
  title: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  /** Smaller type and padding, for a metric card or other tight slot. */
  compact?: boolean;
}

/**
 * An inline, announced error state.
 *
 * The alternative several views used was to fall through to their empty state,
 * which told an operator "nothing has been learned" when the truth was "this
 * could not be read". Those are different answers, and only one is reassuring.
 *
 * The reason comes from `describeReadError`: known failures (an HTML page
 * where JSON was expected, 401/403, timeouts, network errors) read as a plain
 * sentence, and the raw text — a parser message is no use to an operator —
 * sits behind a "Details" disclosure for whoever is debugging.
 */
export function LoadError({ title, error, onRetry, className, compact = false }: LoadErrorProps) {
  const { reason, detail } = describeReadError(error);
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start rounded border border-red-900/60 bg-red-950/30',
        compact ? 'gap-2 px-2.5 py-2 text-xs' : 'gap-3 px-4 py-3 text-sm',
        className,
      )}
    >
      <AlertTriangle className={cn('shrink-0 text-red-400', compact ? 'mt-px h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-red-200">{title}</div>
        {reason && <div className={cn('mt-0.5 break-words text-red-300/80', compact ? 'text-[11px]' : 'text-xs')}>{reason}</div>}
        {detail && (
          <details className="mt-1 text-[11px] text-red-300/70">
            <summary className="cursor-pointer select-none hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Details</summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">{detail}</pre>
          </details>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-red-800 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Retry
        </button>
      )}
    </div>
  );
}
