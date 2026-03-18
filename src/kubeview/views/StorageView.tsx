import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HardDrive, Database, AlertCircle, CheckCircle, ArrowRight, Package,
  AlertTriangle, Info, ExternalLink, Plus, Trash2, Server, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { MetricCard } from '../components/metrics/Sparkline';
import { Panel } from '../components/primitives/Panel';

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
  const { data: volumeSnapshotClasses = [] } = useQuery<K8sResource[]>({
    queryKey: ['storage', 'volumesnapshotclasses'],
    queryFn: () => k8sList('/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses').catch(() => []),
    staleTime: 120000,
  });
  const { data: resourceQuotas = [] } = useK8sListWatch({ apiPath: '/api/v1/resourcequotas', namespace: nsFilter });

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

        {/* Storage Health Audit */}
        <StorageHealthAudit
          pvcs={pvcs as any[]}
          storageClasses={storageClasses as any[]}
          volumeSnapshots={volumeSnapshots as any[]}
          volumeSnapshotClasses={volumeSnapshotClasses as any[]}
          resourceQuotas={resourceQuotas as any[]}
          go={go}
        />

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
                          {isDefault && <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">default</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{provisioner}</div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
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
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
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

// ===== Storage Health Audit =====

interface AuditCheck {
  id: string;
  title: string;
  description: string;
  why: string;
  passing: any[];
  failing: any[];
  yamlExample: string;
  linkToDetail?: (item: any) => { path: string; title: string };
}

function StorageHealthAudit({
  pvcs,
  storageClasses,
  volumeSnapshots,
  volumeSnapshotClasses,
  resourceQuotas,
  go,
}: {
  pvcs: any[];
  storageClasses: any[];
  volumeSnapshots: any[];
  volumeSnapshotClasses: any[];
  resourceQuotas: any[];
  go: (path: string, title: string) => void;
}) {
  const [expandedCheck, setExpandedCheck] = React.useState<string | null>(null);

  const checks: AuditCheck[] = React.useMemo(() => {
    const allChecks: AuditCheck[] = [];

    // 1. Default StorageClass
    const defaultSC = storageClasses.find((sc: any) =>
      sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true'
    );
    allChecks.push({
      id: 'default-sc',
      title: 'Default StorageClass',
      description: 'One StorageClass should be marked as default for PVCs that don\'t specify a class',
      why: 'Without a default StorageClass, PVCs that omit storageClassName will fail to provision. Users expect dynamic provisioning to "just work" for common cases.',
      passing: defaultSC ? [defaultSC] : [],
      failing: defaultSC ? [] : storageClasses.slice(0, 1),
      yamlExample: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: my-storage-class
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3`,
      linkToDetail: (sc: any) => ({
        path: `/yaml/storage.k8s.io~v1~storageclasses/_/${sc.metadata.name}`,
        title: `${sc.metadata.name} (YAML)`,
      }),
    });

    // 2. PVC Resource Requests — Bound vs Pending
    const pendingPVCs = pvcs.filter((pvc: any) => pvc.status?.phase === 'Pending');
    const boundPVCs = pvcs.filter((pvc: any) => pvc.status?.phase === 'Bound');
    allChecks.push({
      id: 'pvc-binding',
      title: 'PVC Binding Status',
      description: 'All PVCs should be bound to a PersistentVolume',
      why: 'Pending PVCs indicate missing StorageClasses, insufficient capacity, provisioner errors, or waiting for pod scheduling (WaitForFirstConsumer). Pods using pending PVCs cannot start.',
      passing: boundPVCs,
      failing: pendingPVCs,
      yamlExample: `# Common causes for pending PVCs:
# 1. StorageClass not found or missing
# 2. CSI driver not running
# 3. Cloud quota exceeded
# 4. volumeBindingMode: WaitForFirstConsumer
#    (binds when pod is scheduled)

# To debug, run:
kubectl describe pvc <pvc-name>`,
      linkToDetail: (pvc: any) => ({
        path: `/r/v1~persistentvolumeclaims/${pvc.metadata.namespace}/${pvc.metadata.name}`,
        title: pvc.metadata.name,
      }),
    });

    // 3. Volume Reclaim Policy
    const deleteSCs = storageClasses.filter((sc: any) =>
      (sc.reclaimPolicy || 'Delete') === 'Delete'
    );
    const retainSCs = storageClasses.filter((sc: any) =>
      sc.reclaimPolicy === 'Retain'
    );
    allChecks.push({
      id: 'reclaim-policy',
      title: 'Volume Reclaim Policy',
      description: 'Production StorageClasses should use Retain policy to prevent accidental data loss',
      why: 'Delete reclaim policy automatically deletes the underlying volume when a PVC is deleted. This is convenient for dev/test but dangerous in production — a single kubectl delete can permanently destroy data.',
      passing: retainSCs,
      failing: deleteSCs,
      yamlExample: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: production-storage
provisioner: kubernetes.io/aws-ebs
reclaimPolicy: Retain    # Keep data after PVC deletion
parameters:
  type: gp3`,
      linkToDetail: (sc: any) => ({
        path: `/yaml/storage.k8s.io~v1~storageclasses/_/${sc.metadata.name}`,
        title: `${sc.metadata.name} (YAML)`,
      }),
    });

    // 4. WaitForFirstConsumer Binding
    const immediateSCs = storageClasses.filter((sc: any) =>
      (sc.volumeBindingMode || 'Immediate') === 'Immediate'
    );
    const wffcSCs = storageClasses.filter((sc: any) =>
      sc.volumeBindingMode === 'WaitForFirstConsumer'
    );
    allChecks.push({
      id: 'binding-mode',
      title: 'Volume Binding Mode',
      description: 'StorageClasses should use WaitForFirstConsumer to avoid cross-AZ provisioning issues',
      why: 'Immediate binding provisions volumes before any pod uses them, which can place the volume in the wrong availability zone. If the pod is then scheduled to a different AZ, it cannot attach the volume. WaitForFirstConsumer delays provisioning until the pod is scheduled.',
      passing: wffcSCs,
      failing: immediateSCs,
      yamlExample: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: regional-storage
provisioner: kubernetes.io/aws-ebs
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: gp3`,
      linkToDetail: (sc: any) => ({
        path: `/yaml/storage.k8s.io~v1~storageclasses/_/${sc.metadata.name}`,
        title: `${sc.metadata.name} (YAML)`,
      }),
    });

    // 5. Volume Snapshots
    const hasSnapshotCRDs = volumeSnapshotClasses.length > 0;
    const hasSnapshots = volumeSnapshots.length > 0;
    allChecks.push({
      id: 'volume-snapshots',
      title: 'Volume Snapshot Support',
      description: 'Volume snapshots enable point-in-time backups and data cloning',
      why: 'Without VolumeSnapshot support, you cannot create backups of persistent data or clone volumes. This is critical for disaster recovery, blue/green deployments, and testing with production data.',
      passing: hasSnapshotCRDs ? [{ note: `${volumeSnapshotClasses.length} VolumeSnapshotClass(es) configured` }] : [],
      failing: hasSnapshotCRDs ? [] : [{ note: 'VolumeSnapshot CRDs not installed' }],
      yamlExample: `# Install VolumeSnapshot CRDs and CSI snapshotter
# For most cloud providers, this is automatic.
# For on-prem, install:
# https://github.com/kubernetes-csi/external-snapshotter

# Example VolumeSnapshot:
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: my-snapshot
spec:
  volumeSnapshotClassName: csi-snapclass
  source:
    persistentVolumeClaimName: my-pvc`,
    });

    // 6. Storage Quotas
    // Get unique namespaces from PVCs
    const namespacesWithPVCs = new Set(pvcs.map((pvc: any) => pvc.metadata.namespace));
    const quotasWithStorage = resourceQuotas.filter((q: any) => {
      const hard = q.spec?.hard || {};
      return hard['requests.storage'] || hard['persistentvolumeclaims'];
    });
    const quotaNamespaces = new Set(quotasWithStorage.map((q: any) => q.metadata.namespace));
    const namespacesWithoutQuota = [...namespacesWithPVCs].filter(ns => !quotaNamespaces.has(ns));

    allChecks.push({
      id: 'storage-quotas',
      title: 'Storage Resource Quotas',
      description: 'Namespaces with PVCs should have storage quotas to prevent uncontrolled growth',
      why: 'Without storage quotas, users can request unlimited storage, leading to cloud cost overruns and capacity exhaustion. Quotas enforce budget limits and prevent runaway provisioning.',
      passing: quotasWithStorage,
      failing: namespacesWithoutQuota.map(ns => ({ metadata: { name: ns, namespace: ns } })),
      yamlExample: `apiVersion: v1
kind: ResourceQuota
metadata:
  name: storage-quota
  namespace: my-namespace
spec:
  hard:
    requests.storage: "100Gi"         # Total storage requests
    persistentvolumeclaims: "10"      # Max number of PVCs`,
      linkToDetail: (item: any) => {
        // If it's a quota, link to the quota; if it's a namespace placeholder, link to create quota
        if (item.spec?.hard) {
          return {
            path: `/yaml/v1~resourcequotas/${item.metadata.namespace}/${item.metadata.name}`,
            title: `${item.metadata.name} (YAML)`,
          };
        }
        return {
          path: `/create/v1~resourcequotas?namespace=${item.metadata.namespace}`,
          title: `Create quota in ${item.metadata.namespace}`,
        };
      },
    });

    return allChecks;
  }, [pvcs, storageClasses, volumeSnapshots, volumeSnapshotClasses, resourceQuotas]);

  if (storageClasses.length === 0 && pvcs.length === 0) return null;

  const totalPassing = checks.reduce((s, c) => s + (c.failing.length === 0 ? 1 : 0), 0);
  const score = Math.round((totalPassing / checks.length) * 100);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" /> Storage Health Audit
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold', score === 100 ? 'text-green-400' : score >= 60 ? 'text-amber-400' : 'text-red-400')}>{score}%</span>
          <span className="text-xs text-slate-500">{totalPassing}/{checks.length} passing</span>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        {checks.map((check) => {
          const pass = check.failing.length === 0;
          const expanded = expandedCheck === check.id;
          return (
            <div key={check.id}>
              <button
                onClick={() => setExpandedCheck(expanded ? null : check.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {pass ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div>
                    <span className="text-sm text-slate-200">{check.title}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {pass ? `${check.passing.length} pass` : `${check.failing.length} of ${check.failing.length + check.passing.length} need attention`}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-600">{expanded ? '▾' : '▸'}</span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-xs text-slate-400">{check.description}</p>

                  {/* Why it matters */}
                  <div className="bg-blue-950/20 border border-blue-900/50 rounded p-3">
                    <div className="text-xs font-medium text-blue-300 mb-1">Why it matters</div>
                    <p className="text-xs text-slate-400">{check.why}</p>
                  </div>

                  {/* Failing items */}
                  {check.failing.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400 font-medium mb-1.5">
                        {check.id === 'pvc-binding' ? 'Pending' : check.id === 'storage-quotas' ? 'Missing quotas' : 'Needs attention'} ({check.failing.length})
                      </div>
                      <div className="space-y-1 max-h-32 overflow-auto">
                        {check.failing.slice(0, 10).map((item: any, idx: number) => {
                          const linkInfo = check.linkToDetail?.(item);
                          const displayName = item.metadata?.name || item.note || 'Unknown';
                          return (
                            <button
                              key={item.metadata?.uid || idx}
                              onClick={() => linkInfo && go(linkInfo.path, linkInfo.title)}
                              className="flex items-center justify-between w-full py-1 px-2 rounded hover:bg-slate-800/50 text-left transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-xs text-slate-300">{displayName}</span>
                                {item.metadata?.namespace && <span className="text-xs text-slate-600">{item.metadata.namespace}</span>}
                              </div>
                              {linkInfo && <span className="text-xs text-blue-400">View →</span>}
                            </button>
                          );
                        })}
                        {check.failing.length > 10 && <div className="text-xs text-slate-600 px-2">+{check.failing.length - 10} more</div>}
                      </div>
                    </div>
                  )}

                  {/* Passing items */}
                  {check.passing.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">Passing ({check.passing.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {check.passing.slice(0, 8).map((item: any, idx: number) => {
                          const displayName = item.metadata?.name || item.note || 'OK';
                          return (
                            <span key={item.metadata?.uid || idx} className="text-xs px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">
                              {displayName}
                            </span>
                          );
                        })}
                        {check.passing.length > 8 && <span className="text-xs text-slate-600">+{check.passing.length - 8} more</span>}
                      </div>
                    </div>
                  )}

                  {/* YAML example */}
                  <div>
                    <div className="text-xs text-slate-500 font-medium mb-1">How to fix:</div>
                    <pre className="text-[11px] text-emerald-400 font-mono bg-slate-950 p-3 rounded overflow-x-auto">{check.yamlExample}</pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

