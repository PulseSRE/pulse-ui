import React, { createContext, useCallback, useContext, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
 * keeps the active tab in `?tab=` (or `urlSync.param`). The default tab is not
 * written to the URL, an unknown or missing value falls back to the default,
 * and changes replace the history entry so Back leaves the page instead of
 * stepping through tabs.
 */

/* ── URL sync hook (usable on its own for pages that render panels themselves) ── */
export function useTabParam<T extends string>(
  values: readonly T[],
  defaultTab: T,
  param = 'tab',
  clear: readonly string[] = [],
): [T, (tab: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(param);
  const active = raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : defaultTab;

  const setActive = useCallback(
    (tab: T) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === defaultTab) next.delete(param);
          else next.set(param, tab);
          for (const p of clear) next.delete(p);
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clear` is compared by content
    [setSearchParams, defaultTab, param, clear.join('\0')],
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

/* ── Trigger (individual tab) ── */
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, onClick, ...props }, ref) => {
  const ctx = useContext(TabsSelectContext);
  return (
  <TabsPrimitive.Trigger
    ref={ref}
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
