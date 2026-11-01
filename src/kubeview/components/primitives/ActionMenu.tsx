import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';

export type ActionMenuItem = { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string } | 'separator' | null;

/**
 * A "more actions" button and its menu. The menu is portalled to the body at
 * a fixed position under the button, so rows that are transformed or clip
 * (a virtualized table) cannot hide it; it closes on outside click, scroll
 * and Escape. A disabled item keeps its reason in `title`, shown on hover
 * and read by screen readers.
 */
export function ActionMenu({ items, label = 'More actions', triggerClassName }: { items: ActionMenuItem[]; label?: string; triggerClassName?: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const filtered = items.filter(Boolean) as Exclude<ActionMenuItem, null>[];

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen(!open);
  };

  React.useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && ((ref.current?.contains(t as Node) ?? false) || (menuRef.current?.contains(t as Node) ?? false));
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e: Event) => { if (!inside(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        className={cn('px-2 py-1.5 text-xs bg-slate-800 text-slate-400 rounded-sm hover:bg-slate-700 hover:text-slate-200 flex items-center', triggerClassName)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-56 rounded-lg border border-slate-600 bg-slate-800 shadow-xl py-1"
        >
          {filtered.map((item, i) => {
            if (item === 'separator') return <div key={i} role="separator" className="border-t border-slate-700 my-1" />;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); if (!item.disabled) item.onClick(); }}
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                title={item.title}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 transition-colors',
                  item.disabled ? 'text-slate-500 cursor-not-allowed' : item.danger ? 'text-red-400 hover:bg-slate-700' : 'text-slate-300 hover:bg-slate-700'
                )}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
