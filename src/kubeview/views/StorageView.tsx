import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HardDrive, Database, AlertCircle, CheckCircle, ArrowRight, Package,
  AlertTriangle, Info, ExternalLink, Plus, Trash2, Server,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { MetricCard } from '../components/metrics/Sparkline';

export default function StorageView() {
  const selectedNamespace = useUIStore((s) => s.selectedNamespace);
  const go = useNavigateTab();
  const nsFilter = selectedNamespace !== '*' ? selectedNamespace : undefined;

  // Real-time data
  const { data: pvcs = [] } = useK8sListWatch({ apiPath: '/api/v1/persistentvolumeclaims', namespace: nsFilter });
  const { data: pvs = [] } = useK8sListWatch({ apiPath: '/api/v1/persistentvolumes' });
  const { data: storageClasses = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'storageclasses'],
    queryFn: () => k8sList('/apis/storage.k8s.io/v1/storageclasses'),
    staleTime: 60000,
  });
  const { data: csiDrivers = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'csidrivers'],
    queryFn: () => k8sList('/apis/storage.k8s.io/v1/csidrivers').catch(() => []),
    staleTime: 120000,
  });
  const { data: volumeSnapshots = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'volumesnapshots', nsFilter],
    queryFn: () => k8sList('/apis/snapshot.storage.k8s.io/v1/volumesnapshots', nsFilter).catch(() => []),
    staleTime: 60000,
  });

  // Computed stats
  const pvcStatus = React.useMemo(() => {
    const s = { Bound: 0, Pending: 0, Lost: 0 };
    for (const pvc of pvcs) {
      const phase = (pvc.status as any)?.phase || 'Pending';
      if (phase in s) (s as any)[phase]++;
    }
    return s;
  }, [pvcs]);

  const pvStatus = React.useMemo(() => {
    const s = { Available: 0, Bound: 0, Released: 0, Failed: 0 };
    for (const pv of pvs) {
      const phase = (pv.status as any)?.phase || 'Available';
      if (phase in s) (s as any)[phase]++;
    }
    return s;
  }, [pvs]);

  const capacityStats = React.useMemo(() => {
    let totalRequestedGi = 0;
    let totalCapacityGi = 0;
    for (const pvc of pvcs as any[]) {
      totalRequestedGi += parseStorage(pvc.spec?.resources?.requests?.storage || '0');
    }
    for (const pv of pvs as any[]) {
      totalCapacityGi += parseStorage(pv.spec?.capacity?.storage || '0');
    }
    return { totalRequestedGi, totalCapacityGi };
  }, [pvcs, pvs]);

  const pvcByClass = React.useMemo(() => {
    const map = new Map<string, { count: number; totalGi: number; pending: number }>();
    for (const pvc of pvcs as any[]) {
      const sc = pvc.spec?.storageClassName || '(default)';
      const cap = pvc.spec?.resources?.requests?.storage || '0';
      const gi = parseStorage(cap);
      const isPending = pvc.status?.phase === 'Pending';
      const entry = map.get(sc) || { count: 0, totalGi: 0, pending: 0 };
      entry.count++;
      entry.totalGi += gi;
      if (isPending) entry.pending++;
      map.set(sc, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [pvcs]);

  const pendingPVCs = React.useMemo(() => pvcs.filter((p) => (p.status as any)?.phase === 'Pending'), [pvcs]);
  const releasedPVs = React.useMemo(() => pvs.filter((p) => (p.status as any)?.phase === 'Released'), [pvs]);
  const defaultSC = storageClasses.find((sc: any) => sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true');

  const issues: Array<{ msg: string; severity: 'warning' | 'critical'; action?: { label: string; path: string } }> = [];
  if (pvcStatus.Pending > 0) issues.push({ msg: `${pvcStatus.Pending} PVC${pvcStatus.Pending > 1 ? 's' : ''} stuck in Pending`, severity: 'warning' });
  if (pvcStatus.Lost > 0) issues.push({ msg: `${pvcStatus.Lost} PVC${pvcStatus.Lost > 1 ? 's' : ''} in Lost state`, severity: 'critical' });
  if (pvStatus.Released > 0) issues.push({ msg: `${pvStatus.Released} PV${pvStatus.Released > 1 ? 's' : ''} in Released state (can be reclaimed)`, severity: 'warning' });
  if (pvStatus.Failed > 0) issues.push({ msg: `${pvStatus.Failed} PV${pvStatus.Failed > 1 ? 's' : ''} in Failed state`, severity: 'critical' });
  if (!defaultSC) issues.push({ msg: 'No default StorageClass set — PVCs without explicit class will fail', severity: 'warning', action: { label: 'View StorageClasses', path: '/r/storage.k8s.io~v1~storageclasses' } });
  if (storageClasses.length === 0) issues.push({ msg: 'No StorageClasses configured — dynamic provisioning unavailable', severity: 'critical', action: { label: 'Create StorageClass', path: '/create/storage.k8s.io~v1~storageclasses' } });

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-6 h-6 text-orange-500" />
              Storage
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Persistent volumes, claims, storage classes, and capacity
              {nsFilter && <span className="text-blue-400 ml-1">in {nsFilter}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => go('/create/v1~persistentvolumeclaims', 'Create PVC')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
              <Plus className="w-3 h-3" /> Create PVC
            </button>
          </div>
        </div>

        {/* Issues banner */}
        {issues.length > 0 && (
          <div className="space-y-2">
            {issues.map((issue, i) => (
              <div key={i} className={cn('flex items-center justify-between px-4 py-2.5 rounded-lg border',
                issue.severity === 'critical' ? 'bg-red-950/30 border-red-900' : 'bg-yellow-950/30 border-yellow-900')}>
                <div className="flex items-center gap-2">
                  {issue.severity === 'critical' ? <AlertCircle className="w-4 h-4 text-red-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  <span className="text-sm text-slate-200">{issue.msg}</span>
                </div>
                {issue.action && (
                  <button onClick={() => go(issue.action!.path, issue.action!.label)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    {issue.action.label} <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => go('/r/v1~persistentvolumeclaims', 'PVCs')} className={cn('bg-slate-900 rounded-lg border p-3 text-left hover:border-slate-600 transition-colors', pvcStatus.Pending > 0 ? 'border-yellow-800' : 'border-slate-800')}>
            <div className="text-xs text-slate-400 mb-1">PVCs</div>
            <div className="text-xl font-bold text-slate-100">{pvcs.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{pvcStatus.Bound} bound · {pvcStatus.Pending} pending</div>
          </button>
          <button onClick={() => go('/r/v1~persistentvolumes', 'PVs')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Persistent Volumes</div>
            <div className="text-xl font-bold text-slate-100">{pvs.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{pvStatus.Available} available · {pvStatus.Released} released</div>
          </button>
          <button onClick={() => go('/r/storage.k8s.io~v1~storageclasses', 'StorageClasses')} className="bg-slate-900 rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors">
            <div className="text-xs text-slate-400 mb-1">Storage Classes</div>
            <div className="text-xl font-bold text-slate-100">{storageClasses.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">{defaultSC ? `Default: ${defaultSC.metadata.name}` : 'No default set'}</div>
          </button>
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-1">Total Capacity</div>
            <div className="text-xl font-bold text-slate-100">{formatGi(capacityStats.totalCapacityGi)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{formatGi(capacityStats.totalRequestedGi)} requested</div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="PVC Usage"
            query="sum(kubelet_volume_stats_used_bytes) / sum(kubelet_volume_stats_capacity_bytes) * 100"
            unit="%"
            color="#f97316"
            thresholds={{ warning: 75, critical: 90 }}
          />
          <MetricCard
            title="IOPS (Read)"
            query="sum(rate(node_disk_reads_completed_total[5m]))"
            unit=" /s"
            color="#3b82f6"
          />
          <MetricCard
            title="IOPS (Write)"
            query="sum(rate(node_disk_writes_completed_total[5m]))"
            unit=" /s"
            color="#8b5cf6"
          />
          <MetricCard
            title="Disk Throughput"
            query="sum(rate(node_disk_read_bytes_total[5m]) + rate(node_disk_written_bytes_total[5m])) / 1024 / 1024"
            unit=" MB/s"
            color="#06b6d4"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Storage Classes detail */}
          <Panel title="Storage Classes" icon={<Database className="w-4 h-4 text-purple-500" />}>
            {storageClasses.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center">No storage classes configured</div>
            ) : (
              <div className="space-y-2">
                {(storageClasses as any[]).map((sc) => {
                  const isDefault = sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
                  const provisioner = sc.provisioner || 'unknown';
                  const reclaimPolicy = sc.reclaimPolicy || 'Delete';
                  const volumeBinding = sc.volumeBindingMode || 'Immediate';
                  const classStats = pvcByClass.find(([name]) => name === sc.metadata.name);
                  return (
                    <button key={sc.metadata.uid} onClick={() => go(`/r/storage.k8s.io~v1~storageclasses/_/${sc.metadata.name}`, sc.metadata.name)}
                      className="flex items-start justify-between w-full py-2.5 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200">{sc.metadata.name}</span>
                          {isDefault && <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">default</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{provisioner}</div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                          <span>Reclaim: {reclaimPolicy}</span>
                          <span>Binding: {volumeBinding}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {classStats ? (
                          <>
                            <div className="text-sm font-mono text-slate-300">{classStats[1].count} PVCs</div>
                            <div className="text-xs text-slate-500">{classStats[1].totalGi.toFixed(1)} Gi</div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-600">No PVCs</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* CSI Drivers */}
          <Panel title="CSI Drivers" icon={<Server className="w-4 h-4 text-cyan-500" />}>
            {csiDrivers.length === 0 ? (
              <div className="text-center py-4">
                <div className="text-sm text-slate-500">No CSI drivers found</div>
                <p className="text-xs text-slate-600 mt-1">CSI drivers provide dynamic storage provisioning</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(csiDrivers as any[]).map((driver) => (
                  <div key={driver.metadata.uid} className="py-2 px-3 rounded hover:bg-slate-800/50">
                    <div className="text-sm text-slate-200 font-medium">{driver.metadata.name}</div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                      {driver.spec?.attachRequired !== false && <span>Attach required</span>}
                      {driver.spec?.podInfoOnMount && <span>Pod info on mount</span>}
                      {driver.spec?.volumeLifecycleModes?.map((m: string) => <span key={m}>{m}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* PVCs by storage class — capacity bar chart */}
        {pvcByClass.length > 0 && (
          <Panel title="Capacity by Storage Class" icon={<HardDrive className="w-4 h-4 text-orange-500" />}>
            <div className="space-y-3">
              {pvcByClass.map(([sc, info]) => {
                const maxGi = Math.max(...pvcByClass.map(([, i]) => i.totalGi), 1);
                const pct = (info.totalGi / maxGi) * 100;
                return (
                  <div key={sc}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-slate-300">{sc}</span>
                      <div className="flex items-center gap-3 text-xs">
                        {info.pending > 0 && <span className="text-amber-400">{info.pending} pending</span>}
                        <span className="text-slate-400">{info.count} PVCs</span>
                        <span className="font-mono text-slate-300">{info.totalGi.toFixed(1)} Gi</span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Pending PVCs */}
        {pendingPVCs.length > 0 && (
          <Panel title={`Pending PVCs (${pendingPVCs.length})`} icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
            <div className="space-y-1">
              {pendingPVCs.map((pvc: any) => (
                <button key={pvc.metadata.uid} onClick={() => go(`/r/v1~persistentvolumeclaims/${pvc.metadata.namespace}/${pvc.metadata.name}`, pvc.metadata.name)}
                  className="flex items-center justify-between w-full py-2 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-sm text-slate-200">{pvc.metadata.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{pvc.metadata.namespace}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{pvc.spec?.resources?.requests?.storage || '?'}</span>
                    <span className="text-xs text-slate-600">{pvc.spec?.storageClassName || '(default)'}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="text-xs text-slate-500 space-y-1">
                <p className="font-medium text-slate-400">Common causes for pending PVCs:</p>
                <p>1. No StorageClass matches the requested class</p>
                <p>2. Storage provisioner is not running or unhealthy</p>
                <p>3. Cloud provider quota exceeded (check cloud console)</p>
                <p>4. WaitForFirstConsumer binding — PVC binds when a pod uses it</p>
              </div>
            </div>
          </Panel>
        )}

        {/* Released PVs */}
        {releasedPVs.length > 0 && (
          <Panel title={`Released PVs (${releasedPVs.length})`} icon={<Info className="w-4 h-4 text-blue-500" />}>
            <div className="space-y-1">
              {releasedPVs.map((pv: any) => (
                <button key={pv.metadata.uid} onClick={() => go(`/r/v1~persistentvolumes/_/${pv.metadata.name}`, pv.metadata.name)}
                  className="flex items-center justify-between w-full py-2 px-3 rounded hover:bg-slate-800/50 text-left transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-sm text-slate-200">{pv.metadata.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{pv.spec?.capacity?.storage || '?'}</span>
                    <span className="text-xs text-slate-600">{pv.spec?.storageClassName || ''}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800">
              <p className="text-xs text-slate-500">Released PVs still hold data but are no longer bound. Set <code className="text-slate-400">persistentVolumeReclaimPolicy: Retain</code> to keep data, or delete the PV to reclaim storage.</p>
            </div>
          </Panel>
        )}

        {/* Volume Snapshots */}
        {volumeSnapshots.length > 0 && (
          <Panel title={`Volume Snapshots (${volumeSnapshots.length})`} icon={<Package className="w-4 h-4 text-green-500" />}>
            <div className="space-y-1">
              {(volumeSnapshots as any[]).slice(0, 10).map((snap) => {
                const ready = snap.status?.readyToUse;
                return (
                  <div key={snap.metadata.uid} className="flex items-center justify-between py-2 px-3 rounded hover:bg-slate-800/50">
                    <div className="flex items-center gap-2">
                      {ready ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                      <span className="text-sm text-slate-200">{snap.metadata.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{snap.metadata.namespace}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>Source: {snap.spec?.source?.persistentVolumeClaimName || '—'}</span>
                      <span>{snap.status?.restoreSize || ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Guidance */}
        <Panel title="Storage Best Practices" icon={<Info className="w-4 h-4 text-blue-500" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-medium text-slate-200">Set a default StorageClass</span>
                  <p className="text-slate-500">Annotate one SC with <code className="text-slate-400">storageclass.kubernetes.io/is-default-class: "true"</code></p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-medium text-slate-200">Use WaitForFirstConsumer binding</span>
                  <p className="text-slate-500">Prevents PVs from being provisioned in the wrong AZ</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-medium text-slate-200">Enable volume snapshots</span>
                  <p className="text-slate-500">Install a VolumeSnapshot CRD + CSI snapshot controller for backup support</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-medium text-slate-200">Set resource quotas for storage</span>
                  <p className="text-slate-500">Prevent namespace sprawl with <code className="text-slate-400">requests.storage</code> quotas</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-medium text-slate-200">Monitor PVC usage</span>
                  <p className="text-slate-500">Set alerts on <code className="text-slate-400">kubelet_volume_stats_used_bytes</code> to catch full volumes before they impact workloads</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <span className="font-medium text-slate-200">Clean up Released PVs</span>
                  <p className="text-slate-500">Released PVs waste capacity — delete or reclaim them regularly</p>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function parseStorage(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(Gi|Mi|Ti|Ki|G|M|T|K)?$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'ki' || unit === 'k') return val / (1024 * 1024);
  if (unit === 'mi' || unit === 'm') return val / 1024;
  if (unit === 'ti' || unit === 't') return val * 1024;
  return val;
}

function formatGi(gi: number): string {
  if (gi >= 1024) return `${(gi / 1024).toFixed(1)} Ti`;
  if (gi >= 1) return `${gi.toFixed(1)} Gi`;
  return `${(gi * 1024).toFixed(0)} Mi`;
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
