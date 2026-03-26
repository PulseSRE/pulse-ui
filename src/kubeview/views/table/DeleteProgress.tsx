import { Loader2, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeployProgress from '../../components/DeployProgress';
import { Card } from '../../components/primitives/Card';

export interface DeleteProgressItem {
  name: string;
  ns: string;
  kind: string;
  status: 'deleting' | 'done' | 'error';
  error?: string;
}

interface DeleteProgressOverlayProps {
  items: DeleteProgressItem[];
  onClose: () => void;
}

export function DeleteProgressOverlay({ items, onClose }: DeleteProgressOverlayProps) {
  if (items.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-2xl space-y-3 max-h-[80vh] overflow-auto">
        {items.length === 1 ? (
          // Single delete -- show full teardown progress
          <DeployProgress
            type={items[0].kind === 'Job' ? 'job' : 'deployment'}
            name={items[0].name}
            namespace={items[0].ns}
            mode="delete"
            onClose={onClose}
          />
        ) : (
          // Bulk delete -- show per-resource status
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-slate-400" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Deleting {items.length} resources</div>
                  <div className="text-xs text-slate-500">
                    {items.filter(d => d.status === 'done').length} done · {items.filter(d => d.status === 'deleting').length} in progress · {items.filter(d => d.status === 'error').length} failed
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">
                {items.every(d => d.status !== 'deleting') ? 'Close' : 'Hide'}
              </button>
            </div>
            <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
              {items.map((item, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  {item.status === 'deleting' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />}
                  {item.status === 'done' && <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />}
                  {item.status === 'error' && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 truncate">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.kind} · {item.ns}</div>
                    {item.error && <div className="text-xs text-red-400 mt-0.5">{item.error}</div>}
                  </div>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded',
                    item.status === 'done' ? 'bg-green-900/50 text-green-300' :
                    item.status === 'error' ? 'bg-red-900/50 text-red-300' :
                    'bg-blue-900/50 text-blue-300'
                  )}>
                    {item.status === 'deleting' ? 'Deleting...' : item.status === 'done' ? 'Deleted' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
