import React, { useId } from 'react';
import { SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inAppClick } from './PageHeader';
import { LoadError } from './LoadError';
import { isNotFoundError } from '../../engine/readError';
import { clusterDisplayName } from '../../engine/pendingCluster';

export interface NotFoundAction {
  label: string;
  /** A real link (open in a new tab, copy). A plain click calls `onClick` when given. */
  href?: string;
  onClick?: () => void;
}

export interface NotFoundProps {
  /** What was looked for, as it reads in a heading: "Pod web-1", "Custom view". */
  what: string;
  /** The heading, when "<what> not found" would say more than is known. */
  title?: string;
  /**
   * Where it was looked for, completing "Looked …": "on cluster prod-east",
   * "in your saved views". Use `onCluster(clusterId)` for cluster objects.
   */
  where: string;
  /** Why it may be missing; one or two sentences. Do not guess a cause as fact. */
  reason?: React.ReactNode;
  /** The ways out; the first is the primary one. At least one is required. */
  actions: [NotFoundAction, ...NotFoundAction[]];
  /** `page` fills the view; `inline` sits inside a page that has its own header. */
  variant?: 'page' | 'inline';
  /** `h1` when nothing else on the page is one (a full-page not-found). */
  headingLevel?: 1 | 2;
  className?: string;
}

/** "on cluster <name>", for objects read from a cluster. */
export function onCluster(clusterId: string): string {
  return `on cluster ${clusterDisplayName(clusterId)}`;
}

const ACTION = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500';
const PRIMARY = 'bg-blue-600 hover:bg-blue-500 text-white';
const SECONDARY = 'bg-slate-800 hover:bg-slate-700 text-slate-200';

/**
 * The one not-found state. It says what was not found and where Pulse looked
 * (which cluster, or which store), and offers a real way out: links to where
 * the user can go next, not a bare "Back".
 *
 * Only a definite answer is a not-found (404 or 410). A 403, a 500 or a
 * network error says nothing about whether the thing exists; those stay
 * `LoadError` with Retry — `ReadFailure` picks between the two.
 */
export function NotFound({ what, title, where, reason, actions, variant = 'page', headingLevel = 2, className }: NotFoundProps) {
  const headingId = useId();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const page = variant === 'page';
  return (
    <section
      aria-labelledby={headingId}
      data-testid="not-found"
      className={cn(
        page
          ? 'flex h-full flex-col items-center justify-center p-6 text-center'
          : 'rounded-lg border border-slate-700 bg-slate-900 px-4 py-3',
        className,
      )}
    >
      <div className={cn(page ? 'max-w-md' : 'flex items-start gap-3')}>
        <SearchX className={cn('text-slate-400', page ? 'mx-auto mb-3 h-10 w-10' : 'mt-0.5 h-5 w-5 shrink-0')} aria-hidden="true" />
        <div className="min-w-0">
          <Heading id={headingId} className={cn('font-semibold text-slate-100', page ? 'text-lg' : 'text-sm')}>
            {title ?? `${what} not found`}
          </Heading>
          <p className={cn('text-slate-400', page ? 'mt-1 text-sm' : 'mt-0.5 text-xs')}>
            Looked {where}.{reason ? <> {reason}</> : null}
          </p>
          <div className={cn('flex flex-wrap gap-2', page ? 'mt-4 justify-center' : 'mt-2')}>
            {actions.map((a, i) => {
              const cls = cn(ACTION, i === 0 ? PRIMARY : SECONDARY, !page && 'px-2.5 py-1 text-xs');
              return a.href ? (
                <a key={a.label} href={a.href} onClick={inAppClick(a.onClick)} className={cls}>{a.label}</a>
              ) : (
                <button key={a.label} type="button" onClick={a.onClick} className={cls}>{a.label}</button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export interface ReadFailureProps {
  error: unknown;
  /** LoadError's title for every failure that is not a not-found. */
  title: string;
  onRetry?: () => void;
  /** What to show when the read answered 404/410. */
  notFound: NotFoundProps;
  className?: string;
}

/**
 * A failed read: NotFound when the server said the thing does not exist
 * (404/410), LoadError with Retry for everything else (403, 5xx, network).
 */
export function ReadFailure({ error, title, onRetry, notFound, className }: ReadFailureProps) {
  if (isNotFoundError(error)) return <NotFound {...notFound} />;
  return <LoadError title={title} error={error} onRetry={onRetry} className={className} />;
}
