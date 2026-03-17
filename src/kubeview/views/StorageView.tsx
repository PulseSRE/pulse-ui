import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Database, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';

export default function StorageView() {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);

  const { data: allPvcs = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'pvcs'],
    queryFn: () => k8sList('/api/v1/persistentvolumeclaims'),
    staleTime: 30000,
  });

  // Filter PVCs by namespace
  const pvcs = React.useMemo(() => {
    if (selectedNamespace === '*') return allPvcs;
    return allPvcs.filter((p) => (p as any).metadata?.namespace === selectedNamespace);
  }, [allPvcs, selectedNamespace]);

  const { data: pvs = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'pvs'],
    queryFn: () => k8sList('/api/v1/persistentvolumes'),
    staleTime: 30000,
  });

  const { data: storageClasses = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'storageclasses'],
    queryFn: () => k8sList('/apis/storage.k8s.io/v1/storageclasses'),
    staleTime: 60000,
  });

  const pvcStatus = React.useMemo(() => {
    const s = { Bound: 0, Pending: 0, Lost: 0 };
    for (const pvc of pvcs) { const phase = (pvc.status as any)?.phase || 'Pending'; if (phase in s) (s as any)[phase]++; }
    return s;
  }, [pvcs]);

  const pvStatus = React.useMemo(() => {
    const s = { Available: 0, Bound: 0, Released: 0, Failed: 0 };
    for (const pv of pvs) { const phase = (pv.status as any)?.phase || 'Available'; if (phase in s) (s as any)[phase]++; }
    return s;
  }, [pvs]);

  const pvcByClass = React.useMemo(() => {
    const map = new Map<string, { count: number; totalGi: number }>();
    for (const pvc of pvcs as any[]) {
      const sc = pvc.spec?.storageClassName || 'default';
      const cap = pvc.spec?.resources?.requests?.storage || '0';
      const gi = parseStorage(cap);
      const entry = map.get(sc) || { count: 0, totalGi: 0 };
      entry.count++;
      entry.totalGi += gi;
      map.set(sc, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [pvcs]);

  const pendingPVCs = React.useMemo(() => pvcs.filter((p) => (p.status as any)?.phase === 'Pending'), [pvcs]);

  const go = useNavigateTab(); // replaces local go()

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-orange-500" />
            Storage
          </h1>
          <p className="text-sm text-slate-400 mt-1">Persistent volumes, claims, and storage classes</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="PVCs" value={pvcs.length} sub={pvcStatus.Pending > 0 ? `${pvcStatus.Pending} pending` : 'All bound'} onClick={() => go('/r/v1~persistentvolumeclaims', 'PVCs')} warning={pvcStatus.Pending > 0} />
          <StatCard label="PVs" value={pvs.length} sub={`${pvStatus.Available} available`} onClick={() => go('/r/v1~persistentvolumes', 'PVs')} />
          <StatCard label="Storage Classes" value={storageClasses.length} onClick={() => go('/r/storage.k8s.io~v1~storageclasses', 'StorageClasses')} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* PVC status */}
          <Panel title="PVC Status" icon={<Database className="w-4 h-4 text-blue-500" />}>
            <div className="space-y-3">
              {Object.entries(pvcStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2.5 h-2.5 rounded-full', status === 'Bound' ? 'bg-green-500' : status === 'Pending' ? 'bg-yellow-500' : 'bg-red-500')} />
                    <span className="text-sm text-slate-300">{status}</span>
                  </div>
                  <span className="text-sm font-mono text-slate-400">{count}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* PV status */}
          <Panel title="PV Status" icon={<HardDrive className="w-4 h-4 text-orange-500" />}>
            <div className="space-y-3">
              {Object.entries(pvStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2.5 h-2.5 rounded-full', status === 'Bound' ? 'bg-green-500' : status === 'Available' ? 'bg-blue-500' : status === 'Released' ? 'bg-yellow-500' : 'bg-red-500')} />
                    <span className="text-sm text-slate-300">{status}</span>
                  </div>
                  <span className="text-sm font-mono text-slate-400">{count}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* By storage class */}
        <Panel title="PVCs by Storage Class" icon={<Database className="w-4 h-4 text-purple-500" />}>
          <div className="space-y-2">
            {pvcByClass.map(([sc, info]) => (
              <div key={sc} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50">
                <span className="text-sm text-slate-300">{sc}</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500">{info.totalGi.toFixed(1)} Gi total</span>
                  <span className="text-sm font-mono text-slate-400">{info.count} PVCs</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Pending PVCs */}
        {pendingPVCs.length > 0 && (
          <Panel title={`Pending PVCs (${pendingPVCs.length})`} icon={<AlertCircle className="w-4 h-4 text-yellow-500" />}>
            <div className="space-y-1">
              {pendingPVCs.map((pvc) => (
                <div key={pvc.metadata.uid} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/50 cursor-pointer" onClick={() => go(`/r/v1~persistentvolumeclaims/${pvc.metadata.namespace}/${pvc.metadata.name}`, pvc.metadata.name)}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span className="text-sm text-slate-200">{pvc.metadata.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{pvc.metadata.namespace}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-600" />
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function parseStorage(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(Gi|Mi|Ti|G|M|T)?$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'mi' || unit === 'm') return val / 1024;
  if (unit === 'ti' || unit === 't') return val * 1024;
  return val;
}

function StatCard({ label, value, sub, onClick, warning }: { label: string; value: number; sub?: string; onClick: () => void; warning?: boolean }) {
  return (
    <div onClick={onClick} className={cn('bg-slate-900 rounded-lg border p-3 cursor-pointer hover:border-slate-600 transition-colors', warning ? 'border-yellow-800' : 'border-slate-800')}>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">{icon}{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
