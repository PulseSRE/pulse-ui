/**
 * Alerts and findings on a rollout revision: a marker on the timeline node
 * and the list (with links where one exists) in the revision details.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '../../components/primitives/Badge';
import type { CorrelatedSignal } from '../../engine/rolloutCorrelations';

type Variant = 'error' | 'warning' | 'info';

function variantOf(severity: string | undefined): Variant {
  const s = (severity || '').toLowerCase();
  if (s === 'critical' || s === 'error' || s === 'high') return 'error';
  if (s === 'warning' || s === 'medium') return 'warning';
  return 'info';
}

function worst(items: CorrelatedSignal[]): Variant {
  const vs = items.map((i) => variantOf(i.severity));
  return vs.includes('error') ? 'error' : vs.includes('warning') ? 'warning' : 'info';
}

/** The marker under a timeline node: how many alerts/findings, coloured by the worst. */
export function RevisionSignalMarker({ revision, items }: { revision: number; items: CorrelatedSignal[] | undefined }) {
  if (!items?.length) return null;
  return (
    <span
      className="mt-1"
      data-testid={`revision-signals-${revision}`}
      title={items.map((i) => i.label).join('\n')}
      aria-label={`${items.length} alert${items.length === 1 ? '' : 's'} or finding${items.length === 1 ? '' : 's'} during revision ${revision}`}
    >
      <Badge size="sm" variant={worst(items)}>
        <AlertTriangle className="h-3 w-3" aria-hidden /> {items.length}
      </Badge>
    </span>
  );
}

const SOURCE: Record<CorrelatedSignal['source'], string> = { agent: 'agent', finding: 'monitor finding', inbox: 'inbox item' };

/** The list in a revision's details. */
export function RevisionSignalList({ revision, items }: { revision: number; items: CorrelatedSignal[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div aria-label={`Alerts and findings during revision ${revision}`}>
      <span className="text-slate-500">Alerts and findings during this revision:</span>
      <ul className="mt-1 space-y-1">
        {items.map((i, n) => (
          <li key={`${i.label}-${n}`} className="flex items-center gap-2">
            <Badge size="sm" variant={variantOf(i.severity)}>{i.severity || 'signal'}</Badge>
            {i.href && /^https?:\/\//i.test(i.href) ? (
              <a href={i.href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{i.label}</a>
            ) : i.href ? (
              <Link to={i.href} className="text-blue-400 hover:text-blue-300">{i.label}</Link>
            ) : (
              <span className="text-slate-300">{i.label}</span>
            )}
            <span className="text-[10px] text-slate-600">{SOURCE[i.source]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
