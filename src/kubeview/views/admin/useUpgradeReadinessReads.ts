/**
 * The reads behind the update readiness panel that the Admin page does not
 * already hold: pending CSRs, control-plane certificates, etcd member pods,
 * and etcd backups. Each query answers a ReadResult
 * (never throws), so a 403 stays a reason and a 404 stays "absent".
 */
import { useQuery } from '@tanstack/react-query';
import { useFleetStore } from '../../store/fleetStore';
import { listK8s, type ReadResult } from '../../engine/readResult';
import { CSR_LIST_PATH, type CertificateSigningRequest } from '../../engine/csr';
import type { TlsSecretLike } from '../../engine/certExpiry';
import type { PersistentVolumeClaim, Pod } from '../../engine/types';
import {
  CONTROL_PLANE_CERT_NAMESPACES, ETCD_BACKUPS_PATH, BACKUP_SCHEDULES_PATH,
  type BackupScheduleLike, type EtcdBackupLike, type Loadable,
} from '../../engine/upgradeReadiness';

export const ETCD_PODS_PATH = '/api/v1/namespaces/openshift-etcd/pods?labelSelector=app%3Detcd';
export const ETCD_PVCS_PATH = '/api/v1/namespaces/openshift-etcd/persistentvolumeclaims';

/** TLS secrets of every control-plane namespace; one failed namespace makes the whole read an error. */
async function listControlPlaneCerts(clusterId: string): Promise<ReadResult<TlsSecretLike[]>> {
  const results = await Promise.all(CONTROL_PLANE_CERT_NAMESPACES.map((ns) =>
    listK8s<TlsSecretLike>(`/api/v1/namespaces/${ns}/secrets?fieldSelector=type%3Dkubernetes.io%2Ftls`, clusterId)));
  const failed = results.find((r) => r.state === 'error');
  if (failed && failed.state === 'error') return failed;
  return { state: 'ok', data: results.flatMap((r) => (r.state === 'ok' ? r.data.filter((s) => !s.type || s.type === 'kubernetes.io/tls') : [])) };
}

const asLoadable = <T>(data: ReadResult<T> | undefined): Loadable<T> => data ?? { state: 'loading' };

export function useUpgradeReadinessReads({ enabled }: { enabled: boolean }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const opts = { staleTime: 60_000, retry: false, enabled } as const;
  const csrs = useQuery({
    queryKey: ['upgrade-readiness', clusterId, 'csrs'],
    queryFn: async (): Promise<ReadResult<CertificateSigningRequest[]>> => {
      const r = await listK8s<CertificateSigningRequest>(CSR_LIST_PATH, clusterId);
      return r.state === 'ok' ? { state: 'ok', data: r.data.filter((c) => typeof c?.spec?.signerName === 'string') } : r;
    },
    ...opts,
  });
  const certs = useQuery({ queryKey: ['upgrade-readiness', clusterId, 'cp-certs'], queryFn: () => listControlPlaneCerts(clusterId), ...opts });
  const etcdPods = useQuery({ queryKey: ['upgrade-readiness', clusterId, 'etcd-pods'], queryFn: () => listK8s<Pod>(ETCD_PODS_PATH, clusterId), ...opts });
  const backups = useQuery({ queryKey: ['upgrade-readiness', clusterId, 'etcd-backups'], queryFn: () => listK8s<EtcdBackupLike>(ETCD_BACKUPS_PATH, clusterId), ...opts });
  const schedules = useQuery({ queryKey: ['upgrade-readiness', clusterId, 'backup-schedules'], queryFn: () => listK8s<BackupScheduleLike>(BACKUP_SCHEDULES_PATH, clusterId), ...opts });
  // The PVC list is only needed to offer "Take backup now", which needs the EtcdBackup API.
  const backupApiServed = backups.data?.state === 'ok';
  const pvcs = useQuery({
    queryKey: ['upgrade-readiness', clusterId, 'etcd-pvcs'],
    queryFn: () => listK8s<PersistentVolumeClaim>(ETCD_PVCS_PATH, clusterId),
    ...opts,
    enabled: enabled && backupApiServed,
  });
  const all = [csrs, certs, etcdPods, backups, schedules];
  // "Checked N ago" is as old as the oldest read; null until every read has answered.
  const times = all.map((q) => q.dataUpdatedAt || 0);
  const checkedAt = times.every((t) => t > 0) ? Math.min(...times) : 0;

  return {
    clusterId,
    csrs: asLoadable(csrs.data),
    certs: asLoadable(certs.data),
    etcdPods: asLoadable(etcdPods.data),
    backups: asLoadable(backups.data),
    schedules: asLoadable(schedules.data),
    pvcs: asLoadable(pvcs.data),
    backupApiServed,
    checkedAt: checkedAt || null,
    refetchAll: () => { for (const q of [...all, ...(backupApiServed ? [pvcs] : [])]) void q.refetch(); },
    refetchBackups: () => { void backups.refetch(); if (backupApiServed) void pvcs.refetch(); },
  };
}
