import React, { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Tabs: Radix tabs (role=tablist/tab/tabpanel, roving focus, arrow/Home/End
 * keys, aria-controls) with the app's look, and optional `?tab=` URL sync.
 *
 * Pages each used to re-implement the search-param sync, the keyboard
 * handling and the ARIA wiring; most got one of the three slightly wrong.
 *
 *   <Tabs urlSync={{ values: ['a', 'b'] }} defaultValue="a"> … </Tabs>
 *
 * keeps the active tab in `?tab=` (or `urlSync.param`). The URL is the only
 * state: links and Back/Forward to another `?tab=` switch the tab, even on the
 * same page. The default tab is not written to the URL, an unknown or missing
 * value falls back to the default (an unknown one is removed from the URL),
 * and tab clicks replace the history entry so Back leaves the page instead of
 * stepping through tabs.
 *
 * Pages that render their own tab bar use `useTabParam` directly; never keep
 * the tab in `useState` or write it with `window.history`, which the router
 * does not see.
 *
 * Many tabs can be grouped inside one TabsList:
 *
 *   <TabsList><TabsGroup label="Configure"><TabsTrigger …/>…</TabsGroup>…</TabsList>
 *
 * A group shows its label before its tabs and names it to assistive tech as
 * each tab's description. It stays one tablist, so arrow keys move across
 * groups and the tab ids (and `?tab=` links) do not change.
 */

/* ── Search-param writer shared by the URL hooks ── */

/**
 * The search a write in this handler has already produced, keyed by the
 * location it was made from. React Router's functional `setSearchParams`
 * hands every call the params of the render, so two writes in one handler
 * (switch tab and reset a filter) would drop the first; this composes them.
 */
let pendingSearch: { key: string; search: string } | null = null;

/**
 * `update(mutate)` edits the current search params and writes them through
 * the router, replacing the history entry. Writes in the same handler build
 * on each other. The location's hash and history state are not kept.
 */
export function useSearchParamUpdater(): (mutate: (next: URLSearchParams) => void) => void {
  const [searchParams, setSearchParams] = useSearchParams();
  const { key } = useLocation();
  return useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const base = pendingSearch?.key === key ? pendingSearch.search : searchParams.toString();
      const next = new URLSearchParams(base);
      mutate(next);
      if (next.toString() === base) return;
      const entry = { key, search: next.toString() };
      pendingSearch = entry;
      // Only writes made in the same synchronous run (one handler, one commit's
      // effects) compose; afterwards the router's own location is the base.
      queueMicrotask(() => { if (pendingSearch === entry) pendingSearch = null; });
      setSearchParams(next, { replace: true });
    },
    [key, searchParams, setSearchParams],
  );
}

/* ── URL sync hook (usable on its own for pages that render panels themselves) ── */
/**
 * `[active, setActive] = useTabParam(values, default, param?, clear?)` reads
 * one search param through the router. The default is not written, an
 * unknown value shows the default and is removed from the URL, and setting
 * it replaces the history entry (hash and history state are not kept).
 */
export function useTabParam<T extends string>(
  values: readonly T[],
  defaultTab: T,
  param = 'tab',
  clear: readonly string[] = [],
): [T, (tab: T) => void] {
  const [searchParams] = useSearchParams();
  const update = useSearchParamUpdater();
  const raw = searchParams.get(param);
  const valid = raw !== null && (values as readonly string[]).includes(raw);
  const active = valid ? (raw as T) : defaultTab;

  // An unknown value (an old link, a typo) shows the default tab; take it out
  // of the URL too, replacing the entry, so the address bar matches the page.
  const invalid = raw !== null && !valid;
  useEffect(() => {
    if (invalid) update((next) => next.delete(param));
  }, [invalid, param, update]);

  const setActive = useCallback(
    (tab: T) => {
      update((next) => {
        if (tab === defaultTab) next.delete(param);
        else next.set(param, tab);
        for (const p of clear) next.delete(p);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clear` is compared by content
    [update, defaultTab, param, clear.join('\0')],
  );

  return [active, setActive];
}

/* ── Root ── */
export interface TabsUrlSync {
  /** The tab ids that may appear in the URL. Anything else falls back to `defaultValue`. */
  values: readonly string[];
  /** Search param name; defaults to `tab`. */
  param?: string;
  /** Params that belong to one tab and are dropped when the tab changes (e.g. a search query). */
  clear?: readonly string[];
}

type RootProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

export interface TabsProps extends RootProps {
  /** Keep the active tab in a search param. Requires `defaultValue`. */
  urlSync?: TabsUrlSync;
}

/**
 * Radix selects a tab on mousedown/focus. The context below lets a trigger
 * also select on click, so keyboard-less activations (assistive tech that
 * dispatches only `click`, and tests) behave like a pointer press.
 */
const TabsSelectContext = createContext<{ value: string; select: (v: string) => void } | null>(null);

function ControlledRoot({ value, onValueChange, ...props }: RootProps & { value: string; onValueChange: (v: string) => void }) {
  const select = useCallback((v: string) => { if (v !== value) onValueChange(v); }, [value, onValueChange]);
  return (
    <TabsSelectContext.Provider value={{ value, select }}>
      <TabsPrimitive.Root {...props} value={value} onValueChange={onValueChange} />
    </TabsSelectContext.Provider>
  );
}

function UrlSyncedTabs({
  urlSync,
  defaultValue,
  onValueChange,
  ...props
}: Omit<TabsProps, 'value' | 'urlSync'> & { urlSync: TabsUrlSync }) {
  const [value, setValue] = useTabParam(urlSync.values, defaultValue ?? urlSync.values[0] ?? '', urlSync.param, urlSync.clear);
  const handleChange = useCallback(
    (next: string) => {
      setValue(next);
      onValueChange?.(next);
    },
    [setValue, onValueChange],
  );
  return <ControlledRoot {...props} value={value} onValueChange={handleChange} />;
}

function LocalTabs({ value, defaultValue, onValueChange, ...props }: RootProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const handleChange = useCallback(
    (next: string) => {
      if (value === undefined) setInner(next);
      onValueChange?.(next);
    },
    [value, onValueChange],
  );
  return <ControlledRoot {...props} value={current} onValueChange={handleChange} />;
}

export function Tabs({ urlSync, ...props }: TabsProps) {
  if (urlSync) {
    // A controlled `value` would fight the URL; the URL is the source of truth.
    const { value: _ignored, ...rest } = props;
    void _ignored;
    return <UrlSyncedTabs urlSync={urlSync} {...rest} />;
  }
  return <LocalTabs {...props} />;
}

/* ── List (tab bar) ── */
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-800 p-1',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

/* ── Group (a labelled run of triggers inside one TabsList) ── */
const TabsGroupContext = createContext<string | undefined>(undefined);

export function TabsGroup({ label, divider = true, children }: {
  label: string;
  /** A rule before the group; turn off for the first group. */
  divider?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div role="presentation" className="contents" data-tabs-group={label}>
      {divider && <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-800" />}
      <span id={id} aria-hidden="true" className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </span>
      <TabsGroupContext.Provider value={id}>{children}</TabsGroupContext.Provider>
    </div>
  );
}

/* ── Trigger (individual tab) ── */
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, onClick, ...props }, ref) => {
  const ctx = useContext(TabsSelectContext);
  const groupLabelId = useContext(TabsGroupContext);
  return (
  <TabsPrimitive.Trigger
    ref={ref}
    aria-describedby={groupLabelId}
    onClick={(e) => {
      onClick?.(e);
      if (!e.defaultPrevented && !props.disabled) ctx?.select(props.value);
    }}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
      'text-slate-400 hover:text-slate-200',
      'data-[state=active]:bg-blue-600 data-[state=active]:text-white',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500',
      'disabled:pointer-events-none disabled:opacity-50',
      className
    )}
    {...props}
  />
  );
});
TabsTrigger.displayName = 'TabsTrigger';

/* ── Content ── */
export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('focus-visible:outline-hidden', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
