import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SkillConfigSection({ configurable }: { configurable: Array<Record<string, unknown>> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs font-medium text-slate-300 w-full">
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        Configurable Fields ({configurable.length})
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {configurable.map((cfg) => {
            const [fieldName, fieldDef] = Object.entries(cfg)[0] || [];
            if (!fieldName) return null;
            const def = fieldDef as Record<string, unknown> | undefined;
            return (
              <div key={fieldName} className="flex items-center justify-between text-xs border-t border-slate-800 pt-1.5">
                <span className="text-slate-200 font-mono">{fieldName}</span>
                <div className="flex items-center gap-2 text-faint">
                  <span>{String(def?.type || 'string')}</span>
                  {def?.default !== undefined && <span>default: {String(def.default)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
