import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadErrorProps {
  /** What could not be loaded or done, e.g. "Learned runbooks could not be loaded". */
  title: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * An inline, announced error state.
 *
 * The alternative several views used was to fall through to their empty state,
 * which told an operator "nothing has been learned" when the truth was "this
 * could not be read". Those are different answers, and only one is reassuring.
 */
export function LoadError({ title, error, onRetry, className }: LoadErrorProps) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-red-200">{title}</div>
        {message && <div className="mt-0.5 break-words text-xs text-red-300/80">{message}</div>}
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
