/**
 * What the agent just changed on this dashboard, with a one-click undo.
 *
 * The agent keeps a version of the view before each edit (the latest version
 * is the state just before the latest change). Comparing it with the current
 * layout says what the edit did in words a person can check: "moved Alerts,
 * changed CPU" rather than a dashboard that silently looks different.
 */

import { useEffect, useState } from 'react';
import { Bot, Undo2, X } from 'lucide-react';
import type { ComponentSpec } from '../../engine/agentComponents';
import { useCustomViewStore, type ViewVersion } from '../../store/customViewStore';
import { formatRelative } from '../../engine/format';

/** Version actions written by agent edits (see pulse-agent view_mutations / agent_ws). */
export function isAgentEdit(action: string): boolean {
  return action.startsWith('agent:') || action === 'agent_update' || action === 'add_widget' || action === 'remove_widget';
}

export interface LayoutDiff {
  added: string[];
  removed: string[];
  changed: string[];
  renamed: Array<[string, string]>;
  reordered: boolean;
}

function titleOf(w: ComponentSpec, i: number): string {
  const t = (w as { title?: string }).title;
  return (t && t.trim()) || `${w.kind} ${i + 1}`;
}

/** Compare two layouts by widget title. */
export function diffLayouts(before: ComponentSpec[], after: ComponentSpec[]): LayoutDiff {
  const b = before.map(titleOf);
  const a = after.map(titleOf);
  const diff: LayoutDiff = { added: [], removed: [], changed: [], renamed: [], reordered: false };

  // A widget identical apart from its title, in the same slot, was renamed, not removed and re-added.
  const withoutTitle = (x: ComponentSpec) => JSON.stringify({ ...x, title: undefined });
  if (before.length === after.length) {
    before.forEach((w, i) => {
      if (b[i] !== a[i] && !a.includes(b[i]) && !b.includes(a[i]) && withoutTitle(w) === withoutTitle(after[i])) {
        diff.renamed.push([b[i], a[i]]);
      }
    });
  }
  const renamedFrom = new Set(diff.renamed.map(([from]) => from));
  const renamedTo = new Set(diff.renamed.map(([, to]) => to));

  diff.added = a.filter((t) => !b.includes(t) && !renamedTo.has(t));
  diff.removed = b.filter((t) => !a.includes(t) && !renamedFrom.has(t));
  for (const [i, t] of a.entries()) {
    const j = b.indexOf(t);
    if (j >= 0 && JSON.stringify(before[j]) !== JSON.stringify(after[i])) diff.changed.push(t);
  }
  const kept = a.filter((t) => b.includes(t));
  const keptBefore = b.filter((t) => a.includes(t));
  diff.reordered = kept.join('\u0000') !== keptBefore.join('\u0000');
  return diff;
}

export function describeDiff(d: LayoutDiff): string[] {
  const parts: string[] = [];
  const list = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} +${xs.length - 3}`);
  if (d.added.length) parts.push(`added ${list(d.added)}`);
  if (d.removed.length) parts.push(`removed ${list(d.removed)}`);
  if (d.renamed.length) parts.push(d.renamed.map(([f, t]) => `renamed ${f} → ${t}`).join(', '));
  if (d.changed.length) parts.push(`changed ${list(d.changed)}`);
  if (d.reordered) parts.push('reordered widgets');
  return parts;
}

const RECENT_MS = 24 * 60 * 60 * 1000;
const dismissKey = (viewId: string) => `openshiftpulse-edit-dismissed:${viewId}`;

function readDismissed(viewId: string): number | null {
  try {
    const v = localStorage.getItem(dismissKey(viewId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function AgentEditBanner({ viewId, layout }: { viewId: string; layout: ComponentSpec[] }) {
  const getLatestVersion = useCustomViewStore((s) => s.getLatestVersion);
  const restoreVersion = useCustomViewStore((s) => s.restoreVersion);
  const [latest, setLatest] = useState<ViewVersion | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(() => readDismissed(viewId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layoutKey = JSON.stringify(layout);

  useEffect(() => {
    let cancelled = false;
    getLatestVersion(viewId).then((v) => {
      if (!cancelled) setLatest(v);
    });
    return () => {
      cancelled = true;
    };
  }, [viewId, layoutKey, getLatestVersion]);

  if (!latest || !isAgentEdit(latest.action) || dismissed === latest.version) return null;
  if (Date.now() - new Date(latest.created_at).getTime() > RECENT_MS) return null;
  const parts = describeDiff(diffLayouts(latest.layout || [], layout));
  if (parts.length === 0) return null; // nothing visible changed (or the edit was already undone)

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await restoreVersion(viewId, latest.version);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed');
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(viewId), String(latest.version));
    } catch {
      // Private mode or storage disabled: dismissing still hides it for this visit.
    }
    setDismissed(latest.version);
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-1.5 text-xs text-slate-200"
    >
      <Bot className="h-3.5 w-3.5 text-violet-400" aria-hidden />
      <span>
        <span className="font-semibold text-violet-300">Pulse changed this dashboard</span>{' '}
        <span className="text-slate-400">{formatRelative(latest.created_at)}:</span> {parts.join('; ')}
      </span>
      {error && <span className="text-red-400">{error}</span>}
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-sm bg-violet-700 px-2 py-0.5 text-white hover:bg-violet-600 disabled:opacity-50"
        >
          <Undo2 className="h-3 w-3" aria-hidden />
          {busy ? 'Undoing…' : 'Undo'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-sm p-0.5 text-slate-400 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}
