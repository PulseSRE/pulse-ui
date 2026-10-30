import { cn } from '@/lib/utils';
import type { EvidenceItem } from '../../../engine/monitorClient';

const STANCE_MARK = { supports: '+', contradicts: '−', context: '·' } as const;
const STANCE_STYLE = { supports: 'text-emerald-500', contradicts: 'text-red-400', context: 'text-slate-500' } as const;

/**
 * Evidence behind a diagnosis, each item with its stance and source.
 *
 * The source is the tool call the item cites, with that call's arguments as
 * the agent recorded them when it ran.
 *
 * Prose-only evidence carries no stance, so listing it with a "+" presented a
 * contradicting observation as support. Structured items are shown with their
 * stance; prose items (from older reports) are shown without a claim either way.
 */
export function EvidenceList({ detail, prose }: { detail?: EvidenceItem[] | null; prose?: string[] | null }) {
  const items = (detail ?? []).filter((e) => e && e.observation);
  if (items.length > 0) {
    return (
      <ul className="space-y-0.5 pl-1">
        {items.map((e, i) => {
          const stance = e.stance && e.stance in STANCE_MARK ? e.stance : 'supports';
          return (
            <li key={i} className="text-xs text-slate-300 flex gap-1.5">
              <span aria-label={stance} title={stance} className={cn('shrink-0 mt-px', STANCE_STYLE[stance])}>
                {STANCE_MARK[stance]}
              </span>
              <span>
                {e.observation}
                {e.source ? (
                  <span className="text-slate-500">
                    {' '}·{' '}
                    <span className="font-mono" title={e.call_ref ? `tool call ${e.call_ref}` : undefined}>
                      {e.source}
                      {e.call_input ? `(${e.call_input})` : ''}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-600">
                    {' '}· {e.unverified_source ? `cites ${e.unverified_source}, which the investigation did not read` : 'source not recorded'}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  const lines = (prose ?? []).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-0.5 pl-1">
      {lines.map((e, i) => (
        <li key={i} className="text-xs text-slate-300 flex gap-1.5">
          <span aria-label="stance not recorded" className="text-slate-500 shrink-0 mt-px">•</span>
          {e}
        </li>
      ))}
    </ul>
  );
}
