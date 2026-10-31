import React from 'react';
import { Loader2 } from 'lucide-react';
import { LoadError } from './LoadError';
import { EmptyState } from './EmptyState';

/**
 * The three answers a read can give, plus "not answered yet".
 *
 * Many pages collapsed these into one: a failed or forbidden read became `[]`,
 * `null` or `0`, and the page then said "No alerts", "Up to date" or showed a
 * green check. "Could not read" and "read, and there is nothing" are different
 * answers, and only the second is reassuring. Keep them apart.
 */
export type LoadStatus = 'loading' | 'error' | 'empty' | 'ok';

/** The subset of a React Query result this needs. */
export interface QueryLike<T> {
  data: T | undefined;
  isLoading?: boolean;
  isPending?: boolean;
  isError: boolean;
  error?: unknown;
  refetch?: () => unknown;
}

function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/** Classify a query result. An error wins over stale data. */
export function loadStatus<T>(q: QueryLike<T>, isEmpty: (data: T) => boolean = defaultIsEmpty): LoadStatus {
  if (q.isError) return 'error';
  if (q.data === undefined) return q.isLoading || q.isPending ? 'loading' : 'empty';
  return isEmpty(q.data) ? 'empty' : 'ok';
}

/** Merge several reads: any error is an error, any loading is loading. */
export function combineStatus(...statuses: LoadStatus[]): LoadStatus {
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('loading')) return 'loading';
  if (statuses.every((s) => s === 'empty')) return 'empty';
  return 'ok';
}

interface QueryStateProps<T> {
  query: QueryLike<T>;
  /** What could not be read, e.g. "StorageClasses could not be loaded". */
  errorTitle: string;
  /** What to say when the read succeeded and there is nothing. */
  empty: { title: string; description?: string; icon?: React.ReactNode };
  isEmpty?: (data: T) => boolean;
  loading?: React.ReactNode;
  className?: string;
  children: (data: T) => React.ReactNode;
}

/**
 * Render a read honestly: a spinner while loading, `LoadError` (with retry)
 * when it failed, `EmptyState` when it succeeded with nothing, and the
 * children only with real data.
 */
export function QueryState<T>({ query, errorTitle, empty, isEmpty, loading, className, children }: QueryStateProps<T>) {
  const status = loadStatus(query, isEmpty);
  if (status === 'loading') {
    return (
      <>
        {loading ?? (
          <div className={className ?? 'flex items-center justify-center p-8'} role="status" aria-live="polite">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden="true" />
            <span className="sr-only">Loading</span>
          </div>
        )}
      </>
    );
  }
  if (status === 'error') {
    return (
      <LoadError
        title={errorTitle}
        error={query.error}
        onRetry={query.refetch ? () => void query.refetch?.() : undefined}
        className={className}
      />
    );
  }
  if (status === 'empty') {
    return <EmptyState icon={empty.icon} title={empty.title} description={empty.description} className={className} />;
  }
  return <>{children(query.data as T)}</>;
}
