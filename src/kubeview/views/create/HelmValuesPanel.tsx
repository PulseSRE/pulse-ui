/**
 * Chart defaults beside the overrides editor: the chart's values.yaml
 * (read-only, searchable, with the lines an override replaces marked), the
 * overrides YAML, and hints from values.schema.json when the chart has one.
 * On an upgrade it also offers where values start from: the chart defaults
 * plus these overrides (--reset-values) or the release's current values plus
 * these overrides (--reuse-values).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { dump } from 'js-yaml';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { leafPaths, parseValues, readChartArchive, schemaHints, yamlLinePaths, type ChartDefaults } from '../../engine/helmManifest';
import type { StoredChart } from '../../engine/helmChartArchive';

export type DefaultsSource =
  | { from: 'repo'; repoUrl: string; chartUrl?: string; chartName: string; version: string }
  | { from: 'stored'; chart: StoredChart | undefined };

/** Absolute download URL of a chart archive listed in a repo index. */
export function chartArchiveUrl(repoUrl: string, url: string): string {
  return new URL(url, repoUrl.endsWith('/') ? repoUrl : `${repoUrl}/`).toString();
}

/**
 * The chart's values.yaml and values.schema.json: downloaded from the chart's
 * archive (as the repo index is, from the browser), or taken from the chart
 * Helm stored in the release for a values-only change.
 */
export function useChartDefaults(source: DefaultsSource | null): DefaultsState {
  const repo = source?.from === 'repo' ? source : null;
  const q = useQuery({
    queryKey: ['helm', 'chart-defaults', repo?.repoUrl, repo?.chartName, repo?.version, repo?.chartUrl],
    enabled: !!repo?.chartUrl,
    staleTime: 600_000,
    retry: false,
    queryFn: async () => {
      const url = chartArchiveUrl(repo!.repoUrl, repo!.chartUrl!);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} returned ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      return readChartArchive(new Uint8Array(await res.arrayBuffer()));
    },
  });
  if (!source) return { status: 'loading' };
  if (source.from === 'stored') {
    if (!source.chart) return { status: 'error', error: 'the release record does not include a readable copy of its chart' };
    let schema: ChartDefaults['schema'];
    try { schema = source.chart.schema ? JSON.parse(atob(source.chart.schema)) : undefined; } catch { schema = undefined; }
    const values = source.chart.values;
    return { status: 'ok', from: 'from the chart stored in the release (comments are not kept)', defaults: { valuesYaml: Object.keys(values).length ? dump(values, { lineWidth: -1 }) : '', schema } };
  }
  if (!source.chartUrl) return { status: 'error', error: `the repository index does not list a download URL for ${source.chartName} ${source.version}` };
  if (q.error) return { status: 'error', error: q.error instanceof Error ? q.error.message : String(q.error) };
  if (!q.data) return { status: 'loading' };
  return { status: 'ok', from: `chart ${source.chartName} ${source.version}`, defaults: q.data };
}

export type DefaultsState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ok'; defaults: ChartDefaults; from: string };

export type ValuesMode = 'reset' | 'reuse';

export function HelmValuesPanel({
  defaults, overrides, onOverridesChange, mode, onModeChange, reuseUnavailable,
}: {
  defaults: DefaultsState;
  overrides: string;
  onOverridesChange: (v: string) => void;
  /** Omitted for an install, which has no release values to reuse. */
  mode?: ValuesMode;
  onModeChange?: (m: ValuesMode) => void;
  /** Why "reuse" cannot be offered (an install). */
  reuseUnavailable?: string;
}) {
  const [search, setSearch] = React.useState('');
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try { parsed = parseValues(overrides); } catch (e) { parseError = e instanceof Error ? e.message : String(e); }
  const overridden = React.useMemo(() => new Set(parsed ? leafPaths(parsed) : []), [overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const hints = defaults.status === 'ok' && parsed ? schemaHints(defaults.defaults.schema, parsed) : [];

  const lines = defaults.status === 'ok' ? defaults.defaults.valuesYaml.split('\n') : [];
  const paths = React.useMemo(() => (defaults.status === 'ok' ? yamlLinePaths(defaults.defaults.valuesYaml) : []), [defaults]);
  const isOverridden = (p: string | undefined) => !!p && [...overridden].some((o) => o === p || o.startsWith(`${p}.`) || p.startsWith(`${o}.`));
  const q = search.trim().toLowerCase();
  const shown = lines.map((text, i) => ({ text, i, marked: isOverridden(paths[i]) })).filter((l) => !q || l.text.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      {mode && onModeChange && (
        <fieldset className="text-xs text-slate-300">
          <legend className="mb-1 text-xs font-medium text-slate-400">Values start from</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="values-mode" checked={mode === 'reset'} onChange={() => onModeChange('reset')} />
              Chart defaults + my overrides (reset)
            </label>
            <label className={cn('flex items-center gap-1.5', reuseUnavailable && 'opacity-50')}>
              <input type="radio" name="values-mode" checked={mode === 'reuse'} disabled={!!reuseUnavailable} onChange={() => onModeChange('reuse')} />
              Reuse values of the current release
            </label>
          </div>
          {reuseUnavailable && <p className="mt-1 text-slate-500">{reuseUnavailable}</p>}
          {mode === 'reuse' && <p className="mt-1 text-slate-500">Your overrides are merged over the release's current values (helm --reuse-values); values the new chart version adds keep its defaults.</p>}
          {mode === 'reset' && <p className="mt-1 text-slate-500">Your overrides replace the release's current values (helm --reset-values); anything not set here falls back to the chart's default.</p>}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section aria-label="Chart defaults" className="rounded-md border border-slate-800 bg-slate-950/60">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <div>
              <div className="text-xs font-semibold text-slate-200">Chart defaults <span className="font-mono font-normal text-slate-500">values.yaml</span></div>
              <div className="text-[11px] text-slate-500">
                {defaults.status === 'ok' ? `read-only · ${lines.length.toLocaleString()} lines · ${defaults.from}${overridden.size ? ' · lines you override are marked' : ''}` : defaults.status === 'loading' ? 'Loading…' : 'Not available'}
              </div>
            </div>
            {defaults.status === 'ok' && (
              <label className="relative">
                <span className="sr-only">Search chart defaults</span>
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chart defaults"
                  className="w-44 rounded-sm border border-slate-700 bg-slate-900 py-1 pl-6 pr-2 text-xs text-slate-200 placeholder-slate-500" />
              </label>
            )}
          </div>
          {defaults.status === 'loading' && <p className="px-3 py-4 text-xs text-slate-500">Loading the chart's values.yaml…</p>}
          {defaults.status === 'error' && (
            <p role="alert" className="px-3 py-4 text-xs text-amber-300" data-testid="chart-defaults-error">
              Chart defaults could not be loaded: {defaults.error}. The preview still renders with them.
            </p>
          )}
          {defaults.status === 'ok' && (
            <pre className="max-h-80 overflow-auto px-0 py-2 text-[11px] leading-5 font-mono" data-testid="chart-defaults">
              {lines.length === 0 || (lines.length === 1 && !lines[0].trim()) ? <span className="px-3 text-slate-500">The chart sets no default values.</span> : shown.map((l) => (
                <div key={l.i} className={cn('flex px-3', l.marked ? 'bg-amber-500/10 text-amber-200' : l.text.trimStart().startsWith('#') ? 'text-slate-500' : 'text-slate-300')} data-overridden={l.marked || undefined}>
                  <span className="mr-3 w-8 shrink-0 select-none text-right text-slate-600">{l.i + 1}</span>
                  <span className="whitespace-pre">{l.text || ' '}</span>
                </div>
              ))}
            </pre>
          )}
        </section>
        <section aria-label="Your overrides" className="space-y-2">
          <label className="block text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Override values (YAML)</span> <span className="text-slate-500">merged on top of the {mode === 'reuse' ? "release's current values" : 'defaults'}</span>
            <textarea aria-label="Values" value={overrides} onChange={(e) => onOverridesChange(e.target.value)} rows={14} spellCheck={false}
              className="mt-1 w-full rounded-sm border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200" />
          </label>
          {parseError && <p role="alert" className="text-xs text-red-300">The values are not valid YAML: {parseError}</p>}
          {defaults.status === 'ok' && defaults.defaults.schema && (
            <div className="rounded-md border border-slate-800 p-2 text-xs" data-testid="schema-hints">
              <div className="mb-1 font-medium text-slate-300">Schema hints <span className="font-normal text-slate-500">from the chart's values.schema.json</span></div>
              {hints.length === 0
                ? <p className="text-slate-500">{overridden.size ? 'No problems found in the types, allowed values and keys the schema declares. Helm checks the full schema when it renders.' : 'Set a value to check it against the schema.'}</p>
                : <ul className="space-y-1">{hints.map((h) => (
                  <li key={h.path + h.message} className={h.level === 'error' ? 'text-red-300' : 'text-amber-300'}>
                    <span className="font-mono">{h.path || '(root)'}</span> {h.message}
                  </li>
                ))}</ul>}
            </div>
          )}
          {defaults.status === 'ok' && !defaults.defaults.schema && <p className="text-xs text-slate-500">This chart ships no values.schema.json, so values are checked only when helm renders them.</p>}
        </section>
      </div>
    </div>
  );
}
