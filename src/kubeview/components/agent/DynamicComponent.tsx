/**
 * DynamicComponent — renders unknown component kinds using layout templates
 * from the component registry. No new React code needed for new component kinds.
 *
 * Supports layout types: stat_card, grid, bar_list, progress_list, key_value, status_list
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { fetchComponentRegistry, type ComponentKindDef, type ComponentLayout } from '../../engine/componentRegistry';

interface DynamicComponentProps {
  spec: Record<string, unknown>;
}

export function DynamicComponent({ spec }: DynamicComponentProps) {
  const [registry, setRegistry] = useState<Record<string, ComponentKindDef>>({});
  const kind = spec.kind as string;

  useEffect(() => {
    fetchComponentRegistry().then(setRegistry);
  }, []);

  const kindDef = registry[kind];

  if (!kindDef) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="text-xs text-slate-500">Unknown component: <span className="text-slate-400 font-mono">{kind}</span></div>
        <pre className="text-[10px] text-slate-600 mt-2 max-h-32 overflow-auto">{JSON.stringify(spec, null, 2)}</pre>
      </div>
    );
  }

  // If the registry has a layout template, render using it
  if (kindDef.layout) {
    return <LayoutRenderer spec={spec} layout={kindDef.layout} />;
  }

  // No layout — render the example/raw spec
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-xs text-slate-400 mb-2">{kindDef.description}</div>
      <pre className="text-[10px] text-slate-600 max-h-48 overflow-auto">{JSON.stringify(spec, null, 2)}</pre>
    </div>
  );
}

/**
 * Renders a component spec using a layout template from the registry.
 * Recursively resolves {{field}} placeholders and renders primitives.
 */
function LayoutRenderer({ spec, layout }: { spec: Record<string, unknown>; layout: ComponentLayout }) {
  const navigate = useNavigate();

  const resolve = (template: string | undefined): string => {
    if (!template) return '';
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
      const parts = path.split('.');
      let value: unknown = spec;
      for (const p of parts) {
        if (value && typeof value === 'object' && p in (value as Record<string, unknown>)) {
          value = (value as Record<string, unknown>)[p];
        } else {
          return '';
        }
      }
      return String(value ?? '');
    });
  };

  const resolveFromItem = (template: string | undefined, item: Record<string, unknown>): string => {
    if (!template) return '';
    return template.replace(/\{\{item\.(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
      const parts = path.split('.');
      let value: unknown = item;
      for (const p of parts) {
        if (value && typeof value === 'object' && p in (value as Record<string, unknown>)) {
          value = (value as Record<string, unknown>)[p];
        } else {
          return '';
        }
      }
      return String(value ?? '');
    });
  };

  // Render based on layout type
  switch (layout.type) {
    case 'stat_card': {
      const label = resolve(layout.label);
      const value = resolve(layout.value);
      const unit = resolve(layout.unit);
      const status = resolve(layout.status) || 'healthy';
      const description = resolve(layout.description);
      const link = resolve(layout.link);

      const borderColor = status === 'error' ? 'border-red-800' : status === 'warning' ? 'border-amber-800' : 'border-emerald-800';
      const valueColor = status === 'error' ? 'text-red-400' : status === 'warning' ? 'text-amber-400' : 'text-emerald-400';

      const Tag = link ? 'button' : 'div';
      return (
        <Tag
          onClick={link ? () => navigate(link) : undefined}
          className={cn(
            'bg-slate-900 rounded-lg border p-3 text-center transition-colors',
            borderColor,
            link && 'cursor-pointer hover:ring-1 hover:ring-blue-500/50',
          )}
        >
          <div className={cn('text-xl font-bold', valueColor)}>{value}{unit && <span className="text-sm ml-0.5">{unit}</span>}</div>
          <div className="text-xs text-slate-400 mt-1">{label}</div>
          {description && <div className="text-[10px] text-slate-500 mt-0.5">{description}</div>}
        </Tag>
      );
    }

    case 'grid': {
      const items = spec[layout.items || 'items'] as Array<Record<string, unknown>> | undefined;
      const columns = layout.columns === 'auto'
        ? Math.min(items?.length || 4, 7)
        : typeof layout.columns === 'number' ? layout.columns : 4;

      if (!items || !layout.item_template) {
        return <div className="text-xs text-slate-500">No items</div>;
      }

      return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {items.map((item, i) => (
            <LayoutRenderer
              key={i}
              spec={{ ...spec, ...item, item }}
              layout={layout.item_template!}
            />
          ))}
        </div>
      );
    }

    case 'bar_list': {
      const items = spec[layout.items || 'items'] as Array<Record<string, unknown>> | undefined;
      if (!items) return <div className="text-xs text-slate-500">No items</div>;

      const maxValue = Math.max(...items.map((it) => Number(it.value || 0)), 1);

      return (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-slate-300">{String(item.label || '')}</span>
              <div className="flex-1 h-4 bg-slate-800 rounded-xs overflow-hidden">
                <div
                  className="h-full bg-blue-600/60 rounded-xs"
                  style={{ width: `${(Number(item.value || 0) / maxValue) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-slate-400">{String(item.value || 0)}</span>
            </div>
          ))}
        </div>
      );
    }

    case 'progress_list': {
      const items = spec[layout.items || 'items'] as Array<Record<string, unknown>> | undefined;
      if (!items) return <div className="text-xs text-slate-500">No items</div>;

      return (
        <div className="space-y-2">
          {items.map((item, i) => {
            const value = Number(item.value || 0);
            const max = Number(item.max || 100);
            const pct = max > 0 ? (value / max) * 100 : 0;
            const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
            return (
              <div key={i}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-slate-300">{String(item.label || '')}</span>
                  <span className="text-slate-500">{value}/{max} {String(item.unit || '')}</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case 'key_value': {
      const pairs = spec.pairs as Array<{ key: string; value: string }> | undefined;
      if (!pairs) return <div className="text-xs text-slate-500">No data</div>;

      return (
        <div className="space-y-1">
          {pairs.map((pair, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{pair.key}</span>
              <span className="text-slate-200 font-mono">{pair.value}</span>
            </div>
          ))}
        </div>
      );
    }

    case 'status_list': {
      const items = spec.items as Array<{ label: string; status: string; detail?: string }> | undefined;
      if (!items) return <div className="text-xs text-slate-500">No items</div>;

      return (
        <div className="space-y-1">
          {items.map((item, i) => {
            const dotColor = item.status === 'error' ? 'bg-red-500' : item.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <div className={cn('w-2 h-2 rounded-full', dotColor)} />
                <span className="text-slate-300">{item.label}</span>
                {item.detail && <span className="text-slate-500 ml-auto">{item.detail}</span>}
              </div>
            );
          })}
        </div>
      );
    }

    default:
      return (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-xs text-slate-500">Unknown layout type: {layout.type}</div>
        </div>
      );
  }
}
