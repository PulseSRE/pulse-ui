import React from 'react';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';

export type ActionMenuItem = { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean } | 'separator' | null;

export function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  const filtered = items.filter(Boolean) as Exclude<ActionMenuItem, null>[];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1.5 text-xs bg-slate-800 text-slate-400 rounded hover:bg-slate-700 hover:text-slate-200 flex items-center"
        title="More actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-slate-600 bg-slate-800 shadow-xl py-1">
            {filtered.map((item, i) => {
              if (item === 'separator') return <div key={i} className="border-t border-slate-700 my-1" />;
              return (
                <button
                  key={i}
                  onClick={() => { setOpen(false); item.onClick(); }}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 transition-colors hover:bg-slate-700',
                    item.danger ? 'text-red-400' : 'text-slate-300'
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
