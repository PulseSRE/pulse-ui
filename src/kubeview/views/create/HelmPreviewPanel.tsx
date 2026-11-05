/**
 * What a Helm action will do, object by object: added / changed / removed /
 * would fail, each with its manifest or diff, the hooks that run, and what
 * the preview could not check. Shared by the install preview and the upgrade
 * confirmation (HelmDiffConfirm).
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { diffHunks, lineDiff, type RenderedObject } from '../../engine/helmManifest';
import { previewCounts, type HelmPreview, type PreviewEntry } from './helmPreview';
import { useCanI } from '../../hooks/useCanI';

const CHANGE_STYLE: Record<string, string> = {
  added: 'text-emerald-300 bg-emerald-500/10',
  changed: 'text-blue-300 bg-blue-500/10',
  removed: 'text-red-300 bg-red-500/10',
  unchanged: 'text-slate-400 bg-slate-800',
  fail: 'text-red-200 bg-red-600/30',
};

export function DiffView({ before, after }: { before: string; after: string }) {
  const hunks = React.useMemo(() => diffHunks(lineDiff(before, after)), [before, after]);
  return (
    <pre className="max-h-72 overflow-auto rounded-sm bg-slate-950 p-2 text-[11px] leading-5 font-mono" aria-label="Diff">
      {hunks.map((h, i) => h.type === 'gap'
        ? <div key={i} className="text-slate-600">  … {h.skipped} unchanged line{h.skipped === 1 ? '' : 's'}</div>
        : <div key={i} className={cn('whitespace-pre', h.type === 'add' ? 'bg-emerald-500/10 text-emerald-300' : h.type === 'del' ? 'bg-red-500/10 text-red-300' : 'text-slate-400')}>
          {h.type === 'add' ? '+ ' : h.type === 'del' ? '- ' : '  '}{h.text}
        </div>)}
    </pre>
  );
}

function label(e: Pick<PreviewEntry, 'kind' | 'name'>) {
  return `${e.kind}/${e.name}`;
}

function EntryRow({ e }: { e: PreviewEntry }) {
  const [open, setOpen] = React.useState(false);
  const failing = e.check.status === 'fail';
  const tag = failing ? 'Would fail' : e.change === 'added' ? 'Added' : e.change === 'changed' ? 'Changed' : e.change === 'removed' ? 'Removed' : 'Unchanged';
  const canShow = e.change === 'changed' ? !!(e.before && e.after) : !!(e.after || e.before);
  return (
    <li className="py-2" data-testid={`preview-${e.change}-${e.kind}-${e.name}`}>
      <div className="flex flex-wrap items-start gap-2 text-xs">
        <span className={cn('rounded-sm px-1.5 py-0.5 font-medium', CHANGE_STYLE[failing ? 'fail' : e.change])}>{tag}</span>
        <span className="font-mono text-slate-200">{label(e)}</span>
        {e.namespace && <span className="text-slate-500">{e.namespace}</span>}
        <span className={cn('min-w-0 flex-1', failing ? 'text-red-300' : e.check.status === 'unknown' ? 'text-amber-300' : 'text-slate-400')}>
          {e.check.status === 'unknown' ? e.check.message : failing ? e.check.message : e.check.message ?? (e.change === 'removed' ? '' : 'Dry run passed')}
        </span>
        {canShow && (
          <button type="button" className="text-blue-400 hover:text-blue-300" aria-expanded={open} onClick={() => setOpen(!open)}
            aria-label={`${open ? 'Hide' : e.change === 'changed' ? 'Diff' : 'View'} ${label(e)}`}>
            {open ? 'Hide' : e.change === 'changed' ? 'Diff' : 'View'}
          </button>
        )}
      </div>
      {open && (e.change === 'changed'
        ? <div className="mt-2"><DiffView before={e.before!} after={e.after!} /></div>
        : <pre className="mt-2 max-h-72 overflow-auto rounded-sm bg-slate-950 p-2 text-[11px] font-mono text-slate-300" aria-label={`Manifest of ${label(e)}`}>{e.after ?? e.before}</pre>)}
    </li>
  );
}

function hookLine(h: RenderedObject) {
  const hk = h.hook!;
  const del = hk.deletePolicies.length ? `delete policy ${hk.deletePolicies.join(', ')}` : 'kept after it runs (no delete policy)';
  return `${hk.events.join(', ')} · ${h.kind} ${h.name} · weight ${hk.weight} · ${del}`;
}

export function HooksList({ hooks, action }: { hooks: RenderedObject[]; action: string }) {
  return (
    <div className="text-xs" data-testid="preview-hooks">
      <span className="font-medium text-slate-300">Hooks that will run: </span>
      {hooks.length === 0
        ? <span className="text-slate-500">none on {action}</span>
        : <ul className="mt-1 space-y-0.5 text-slate-300">{hooks.map((h) => <li key={h.key} className="font-mono">{hookLine(h)}</li>)}</ul>}
      {hooks.some((h) => h.hook!.events.some((ev) => ev.startsWith('pre-'))) && <p className="mt-1 text-slate-500">If a pre-{action} hook fails, helm stops before changing anything else.</p>}
    </div>
  );
}

export function PreviewCounts({ preview }: { preview: HelmPreview }) {
  const c = previewCounts(preview);
  const cell = (n: number, what: string, tone: string) => (
    <div className="rounded-md border border-slate-800 px-3 py-2">
      <div className={cn('text-lg font-semibold', n ? tone : 'text-slate-500')}>{n}</div>
      <div className="text-[11px] text-slate-500">{what}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="preview-counts">
      {cell(c.added, 'added', 'text-emerald-300')}
      {cell(c.changed, 'changed', 'text-blue-300')}
      {cell(c.removed, 'removed', 'text-red-300')}
      {cell(c.failing, 'would fail', 'text-red-300')}
      {cell(c.unknown, 'could not check', 'text-amber-300')}
    </div>
  );
}

/** The object list; unchanged objects collapse into one line. */
export function PreviewObjects({ preview }: { preview: HelmPreview }) {
  const shown = preview.entries.filter((e) => e.change !== 'unchanged' || e.check.status !== 'ok');
  const unchanged = preview.entries.length - shown.length;
  // Failures first, so what blocks is at the top.
  const ordered = [...shown].sort((a, b) => Number(b.check.status === 'fail') - Number(a.check.status === 'fail'));
  return (
    <div>
      {ordered.length === 0
        ? <p className="text-xs text-slate-400">Nothing changes: the render matches the release's current manifest.</p>
        : <ul className="divide-y divide-slate-800">{ordered.map((e) => <EntryRow key={e.key} e={e} />)}</ul>}
      {unchanged > 0 && <p className="mt-1 text-xs text-slate-500">{unchanged} object{unchanged === 1 ? '' : 's'} unchanged.</p>}
    </div>
  );
}

export function PreviewNotes({ preview }: { preview: HelmPreview }) {
  return (
    <div className="space-y-1 text-xs text-slate-500">
      <p>The dry run runs as you; helm runs as the runner ServiceAccount, whose Role is checked separately for every object and hook.</p>
      {preview.testHooks.length > 0 && <p>{preview.testHooks.length} test hook{preview.testHooks.length === 1 ? '' : 's'} ({preview.testHooks.map((h) => `${h.kind} ${h.name}`).join(', ')}) run only on helm test.</p>}
      {preview.capabilitiesNote && <p className="text-amber-300">{preview.capabilitiesNote}</p>}
      {preview.warnings.length > 0 && <p className="text-amber-300">helm warned: {preview.warnings.join(' ')}</p>}
    </div>
  );
}

export type PreviewState =
  | { status: 'idle' }
  | { status: 'running'; key: string }
  | { status: 'error'; key: string; error: string; log?: string }
  | { status: 'done'; key: string; preview: HelmPreview };

/**
 * Run previews and remember which inputs each was made from, so a preview of
 * other values, another version or another cluster is never shown as current.
 */
export function useHelmPreview(currentKey: string) {
  const [state, setState] = React.useState<PreviewState>({ status: 'idle' });
  const latest = React.useRef(0);
  const run = React.useCallback(async (key: string, fn: () => Promise<HelmPreview>) => {
    const n = ++latest.current;
    setState({ status: 'running', key });
    try {
      const preview = await fn();
      if (n === latest.current) setState({ status: 'done', key, preview });
    } catch (e) {
      if (n === latest.current) setState({ status: 'error', key, error: e instanceof Error ? e.message : String(e), log: (e as { log?: string })?.log });
    }
  }, []);
  const stale = state.status !== 'idle' && state.key !== currentKey;
  const current = stale ? null : state;
  const blockers = current?.status === 'done' ? previewCounts(current.preview).failing : 0;
  return { state, current, stale, run, blockers, reset: () => setState({ status: 'idle' }) };
}

export function PreviewResult({ state, stale, action }: { state: PreviewState; stale: boolean; action: 'install' | 'upgrade' }) {
  if (state.status === 'idle') return null;
  if (state.status === 'running') return <p className="text-xs text-slate-400" role="status">Rendering in the Helm runner Job and dry-running each object… nothing is applied.</p>;
  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs">
        <div className="font-medium text-red-200">The preview could not be made</div>
        <div className="mt-0.5 text-red-300/80">{state.error}</div>
        {state.log && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-red-200/80" aria-label="helm output">{state.log.trim().split('\n').slice(-20).join('\n')}</pre>}
        {stale && <div className="mt-1 text-red-300/80">The inputs changed since; preview again.</div>}
      </div>
    );
  }
  const p = state.preview;
  return (
    <div className={cn('space-y-3', stale && 'opacity-60')} data-testid="helm-preview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-100">Preview · {p.entries.filter((e) => !e.key.startsWith('hook:')).length} objects</h4>
        <span className="text-xs text-slate-500">Rendered {new Date(p.at).toLocaleTimeString()}{stale ? ' · out of date: the inputs changed, preview again' : ''}</span>
      </div>
      <PreviewCounts preview={p} />
      <PreviewObjects preview={p} />
      <HooksList hooks={p.hooks} action={action} />
      <PreviewNotes preview={p} />
    </div>
  );
}

/** Why the signed-in user cannot run a preview here, or undefined. The runner needs a Job and a Secret; reading its output needs pods/log. */
export function usePreviewDenied(namespace: string): string | undefined {
  const jobs = useCanI('create', 'batch', 'jobs', namespace || undefined, undefined, { enabled: !!namespace });
  const secrets = useCanI('create', '', 'secrets', namespace || undefined, undefined, { enabled: !!namespace });
  const logs = useCanI('get', '', 'pods', namespace || undefined, 'log', { enabled: !!namespace });
  if (!namespace) return 'Choose a namespace first';
  if (!jobs.allowed) return `You do not have permission to create Jobs in ${namespace}, which the preview runs in`;
  if (!secrets.allowed) return `You do not have permission to create Secrets in ${namespace}, which carry the values to the preview Job`;
  if (!logs.allowed) return `You do not have permission to read pod logs in ${namespace}, where the preview's output is`;
  return undefined;
}
