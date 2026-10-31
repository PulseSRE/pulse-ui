import React from 'react';
import {
  CheckCircle, XCircle, RefreshCw, ArrowRight, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClusterOperator, Condition } from '../../engine/types';
import { Card } from '../../components/primitives/Card';
import { SearchInput } from '../../components/primitives/SearchInput';

export interface OperatorsTabProps {
  operators: ClusterOperator[];
  go: (path: string, title: string) => void;
}

export function OperatorsTab({ operators, go }: OperatorsTabProps) {
  const [search, setSearch] = React.useState('');
  const operatorList = operators.map((op) => {
    const conditions: Condition[] = op.status?.conditions || [];
    const available = conditions.find((c) => c.type === 'Available')?.status === 'True';
    const degraded = conditions.find((c) => c.type === 'Degraded')?.status === 'True';
    const progressing = conditions.find((c) => c.type === 'Progressing')?.status === 'True';
    const version = op.status?.versions?.find((v) => v.name === 'operator')?.version || '';
    const message = degraded ? conditions.find((c) => c.type === 'Degraded')?.message || '' : progressing ? conditions.find((c) => c.type === 'Progressing')?.message || '' : '';
    return { name: op.metadata.name, available, degraded, progressing, version, message };
  }).sort((a, b) => {
    if (a.degraded && !b.degraded) return -1;
    if (!a.degraded && b.degraded) return 1;
    if (a.progressing && !b.progressing) return -1;
    return a.name.localeCompare(b.name);
  });
  const degradedOps = operatorList.filter((o) => o.degraded);
  const progressingOps = operatorList.filter((o) => o.progressing);
  const availableOps = operatorList.filter((o) => o.available && !o.degraded);

  return (
    <div className="space-y-4">
      {/* Two kinds of operator: these platform ClusterOperators, and add-on
          operators installed through OperatorHub (OLM), which live on /operators. */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Platform ClusterOperators managed by the cluster version operator.</span>
        <button onClick={() => go('/operators', 'Operators')} className="text-blue-400 hover:text-blue-300">
          Installed &amp; available add-on operators (OperatorHub) →
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 text-green-400 mb-1"><CheckCircle className="w-4 h-4" /><span className="text-xs">Available</span></div>
          <div className="text-xl font-bold text-slate-100">{availableOps.length}</div>
        </Card>
        <div className={cn('bg-slate-900 rounded-lg border p-3', degradedOps.length > 0 ? 'border-red-800' : 'border-slate-800')}>
          <div className="flex items-center gap-2 text-red-400 mb-1"><XCircle className="w-4 h-4" /><span className="text-xs">Degraded</span></div>
          <div className="text-xl font-bold text-slate-100">{degradedOps.length}</div>
        </div>
        <div className={cn('bg-slate-900 rounded-lg border p-3', progressingOps.length > 0 ? 'border-yellow-800' : 'border-slate-800')}>
          <div className="flex items-center gap-2 text-yellow-400 mb-1"><RefreshCw className="w-4 h-4" /><span className="text-xs">Progressing</span></div>
          <div className="text-xl font-bold text-slate-100">{progressingOps.length}</div>
        </div>
      </div>
      {degradedOps.length === 0 && operatorList.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-950/30 border border-emerald-800/50 rounded-lg">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs text-emerald-300">All {operatorList.length} operators healthy — no degraded or unavailable operators</span>
        </div>
      )}
      <SearchInput value={search} onChange={setSearch} placeholder="Filter operators..." />
      <Card>
        <div className="divide-y divide-slate-800">
          {operatorList.filter((op) => !search || op.name.toLowerCase().includes(search.toLowerCase())).map((op) => (
            <div key={op.name} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 cursor-pointer transition-colors" onClick={() => go(`/r/config.openshift.io~v1~clusteroperators/_/${op.name}`, op.name)}>
              {op.degraded ? <XCircle className="w-4 h-4 text-red-500 shrink-0" /> :
               op.progressing ? <RefreshCw className="w-4 h-4 text-yellow-500 shrink-0 animate-spin" /> :
               op.available ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> :
               <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{op.name}</span>
                  {op.version && <span className="text-xs text-slate-500 font-mono">{op.version}</span>}
                </div>
                {op.message && <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{op.message}</div>}
              </div>
              <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
