import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { agentFetch } from '../../engine/safeQuery';
import { DrawerShell } from '../../components/primitives/DrawerShell';

interface ComponentInfo {
  description: string;
  category: string;
  required_fields: string[];
  optional_fields: string[];
  supports_mutations: string[];
  example: Record<string, unknown>;
  is_container: boolean;
}

export function ComponentsTab() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: components, isLoading } = useQuery({
    queryKey: ['admin', 'components'],
    queryFn: async () => {
      const res = await agentFetch('/api/agent/components');
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, ComponentInfo>>;
    },
  });

  if (isLoading || !components) {
    return <div className="flex justify-center py-12"><div className="kv-skeleton w-8 h-8 rounded-full" /></div>;
  }

  const categories = [...new Set(Object.values(components).map((c) => c.category))].sort();
  const selectedComp = selected ? components[selected] : null;

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">{Object.keys(components).length} component kinds registered</div>

      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">{cat}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(components)
              .filter(([, c]) => c.category === cat)
              .map(([name, comp]) => (
                <button
                  key={name}
                  onClick={() => setSelected(selected === name ? null : name)}
                  className={cn(
                    'bg-slate-900/50 border rounded-md px-3 py-2 space-y-1 text-left transition-colors hover:border-violet-700/50',
                    selected === name ? 'border-violet-600' : 'border-slate-800/50',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-slate-200">{name}</span>
                    {comp.is_container && <span className="text-[10px] px-1 py-0.5 bg-blue-900/30 text-blue-400 rounded-sm">container</span>}
                  </div>
                  <p className="text-[11px] text-slate-500">{comp.description}</p>
                  {comp.supports_mutations.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {comp.supports_mutations.map((m) => (
                        <span key={m} className="text-[9px] px-1 py-0.5 bg-slate-800 text-slate-500 rounded-sm">{m}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}

      {selected && selectedComp && (
        <DrawerShell title={selected} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">{selectedComp.description}</p>

            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{selectedComp.category}</span>
              {selectedComp.is_container && <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/30 text-blue-400 rounded-sm">container</span>}
            </div>

            {selectedComp.required_fields.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">Required Fields</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedComp.required_fields.map((f) => (
                    <span key={f} className="text-xs font-mono px-2 py-0.5 bg-red-900/20 text-red-300 rounded-sm border border-red-800/30">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {selectedComp.optional_fields.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">Optional Fields</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedComp.optional_fields.map((f) => (
                    <span key={f} className="text-xs font-mono px-2 py-0.5 bg-slate-800 text-slate-400 rounded-sm">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {selectedComp.supports_mutations.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">Supported Mutations</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedComp.supports_mutations.map((m) => (
                    <span key={m} className="text-xs px-2 py-0.5 bg-violet-900/20 text-violet-300 rounded-sm border border-violet-800/30">{m}</span>
                  ))}
                </div>
              </div>
            )}

            {selectedComp.example && Object.keys(selectedComp.example).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-1">Example Spec</h4>
                <pre className="text-[11px] font-mono bg-slate-900 border border-slate-800 rounded-sm p-3 overflow-auto max-h-64 text-slate-300">
                  {JSON.stringify(selectedComp.example, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </DrawerShell>
      )}
    </div>
  );
}
