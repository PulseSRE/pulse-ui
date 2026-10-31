/**
 * FleetSubNav — one tab bar across every fleet page, with a way back to the
 * fleet overview. Before, only the overview linked to the sub-pages and none
 * of them linked back or to each other.
 */
import { useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigateTab } from '../../hooks/useNavigateTab';

export const FLEET_PAGES: ReadonlyArray<{ path: string; prefix: string; label: string }> = [
  { path: '/fleet', prefix: '/fleet', label: 'Overview' },
  { path: '/fleet/workloads', prefix: '/fleet/workloads', label: 'Workloads' },
  { path: '/fleet/r/apps~v1~deployments', prefix: '/fleet/r/', label: 'Resources' },
  { path: '/fleet/alerts', prefix: '/fleet/alerts', label: 'Alerts' },
  { path: '/fleet/compliance', prefix: '/fleet/compliance', label: 'Compliance' },
  { path: '/fleet/compare', prefix: '/fleet/compare', label: 'Compare & Drift' },
];

function isCurrent(pathname: string, page: (typeof FLEET_PAGES)[number]): boolean {
  if (page.path === '/fleet') return pathname === '/fleet' || pathname === '/fleet/';
  return pathname.startsWith(page.prefix);
}

export function FleetSubNav({ className }: { className?: string }) {
  const go = useNavigateTab();
  const { pathname } = useLocation();
  const onOverview = pathname === '/fleet' || pathname === '/fleet/';
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {!onOverview && (
        <button
          onClick={() => go('/fleet', 'Fleet')}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" /> Fleet
        </button>
      )}
      <nav aria-label="Fleet pages" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        {FLEET_PAGES.map((page) => {
          const current = isCurrent(pathname, page);
          return (
            <button
              key={page.path}
              aria-current={current ? 'page' : undefined}
              onClick={() => go(page.path, page.path === '/fleet' ? 'Fleet' : `Fleet ${page.label}`)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500',
                current ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {page.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
