import React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PageHeaderCrumb {
  label: string;
  /** The crumb's URL. Omit on the last crumb (the current page); it renders as plain text. */
  href?: string;
  /** In-app navigation for a plain left click (e.g. `go(href, title)`). */
  onClick?: () => void;
}

export interface PageHeaderBack {
  /** Where back goes, for the link's accessible name: "Back to <label>". */
  label: string;
  /** The parent page's URL, so the link can be opened in a new tab or copied. */
  href: string;
  /** In-app navigation for a plain left click. */
  onClick: () => void;
}

/**
 * A plain left click navigates in the app; a modified or middle click is left
 * to the browser (new tab, new window, copy link).
 */
export function inAppClick(onClick?: () => void) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onClick || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClick();
  };
}

export interface PageHeaderProps {
  /** The page's one `<h1>`. */
  title: React.ReactNode;
  /** A lucide icon, sized `w-6 h-6` with the page's accent colour. */
  icon?: React.ReactNode;
  /** One short line under the title. */
  subtitle?: React.ReactNode;
  /** Status or meta line: badges, counts, "last scan" and the like, beside the title. */
  meta?: React.ReactNode;
  /** Right-side actions. They wrap under the title on narrow screens. */
  actions?: React.ReactNode;
  breadcrumb?: PageHeaderCrumb[];
  back?: PageHeaderBack;
  /**
   * `page` (default) for domain pages. `subpage` is the same anatomy with a
   * smaller title, for full-height tools under a resource (Logs, YAML, Metrics).
   */
  size?: 'page' | 'subpage';
  className?: string;
}

/**
 * The one page header for domain pages: optional back/breadcrumb, an icon, the
 * page's single `<h1>`, an optional meta line, a one-line subtitle and actions
 * on the right. Breadcrumbs and back are real links (`href`); a plain left click
 * calls the caller's in-app navigation, so the header needs no router.
 */
export function PageHeader({ title, icon, subtitle, meta, actions, breadcrumb, back, size = 'page', className }: PageHeaderProps) {
  const hasNav = Boolean(back) || (breadcrumb && breadcrumb.length > 0);
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1 basis-64">
        {hasNav && (
          <nav className="flex flex-wrap items-center gap-1.5 text-sm mb-1" aria-label="Breadcrumb">
            {back && (
              <a
                href={back.href}
                onClick={inAppClick(back.onClick)}
                aria-label={`Back to ${back.label}`}
                title={`Back to ${back.label}`}
                className="p-1 rounded-sm hover:bg-slate-800 text-slate-400 hover:text-slate-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              </a>
            )}
            {breadcrumb?.map((crumb, i) => {
              const last = i === breadcrumb.length - 1;
              return (
                <React.Fragment key={`${i}-${crumb.label}`}>
                  {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />}
                  {crumb.href && !last ? (
                    <a href={crumb.href} onClick={inAppClick(crumb.onClick)} className="text-blue-400 hover:text-blue-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm">
                      {crumb.label}
                    </a>
                  ) : (
                    <span className="text-slate-400" aria-current={last ? 'page' : undefined}>{crumb.label}</span>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={cn('font-bold text-slate-100 flex items-center gap-2 min-w-0 break-words', size === 'subpage' ? 'text-lg' : 'text-2xl')}>
            {icon && <span className="shrink-0 inline-flex" aria-hidden="true">{icon}</span>}
            <span className="min-w-0">{title}</span>
          </h1>
          {meta && <div className="flex flex-wrap items-center gap-2 text-xs">{meta}</div>}
        </div>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
