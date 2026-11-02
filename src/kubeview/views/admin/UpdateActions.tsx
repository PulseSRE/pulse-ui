/**
 * Fix actions used by the update readiness panel and the update action
 * section: take an etcd backup now, and pause worker pools before updating.
 * Both go through the shared ActionDialog (cluster pinned when it opens,
 * failure kept in the dialog) and are gated on the user's own permission.
 */
import React from 'react';
import { Pause, Database } from 'lucide-react';
import { useCanI } from '../../hooks/useCanI';
import { useActionDialog, describeWriteError } from '../../components/ActionDialog';
import { k8sCreate } from '../../engine/query';
import { sendWrite, setMcpPaused } from '../../engine/workloadActions';
import type { MachineConfigPool, PersistentVolumeClaim } from '../../engine/types';
import { ETCD_BACKUPS_PATH, type Loadable } from '../../engine/upgradeReadiness';

const CONTROL_PLANE_POOLS = new Set(['master', 'arbiter']);
const DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export function etcdBackupManifest(name: string, pvcName: string) {
  return {
    apiVersion: 'operator.openshift.io/v1alpha1',
    kind: 'EtcdBackup',
    metadata: { name },
    spec: { pvcName },
  };
}

function defaultBackupName(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `pre-update-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-9';

/**
 * "Take backup now": creates an operator.openshift.io/v1alpha1 EtcdBackup
 * (a one-time backup; config.openshift.io Backup is only the schedule).
 * Offered only when that API is served and a PVC in openshift-etcd exists to
 * write to; otherwise it says what to do instead.
 */
export function TakeEtcdBackupAction({ pvcs, onDone }: { pvcs: Loadable<PersistentVolumeClaim[]>; onDone: () => void }) {
  const { allowed, isLoading } = useCanI('create', 'operator.openshift.io', 'etcdbackups');
  const { open, dialog } = useActionDialog();
  if (pvcs.state === 'loading') return null;
  if (pvcs.state !== 'ok') {
    return <span className="text-xs text-slate-500 max-w-xs">PVCs in openshift-etcd could not be read{pvcs.state === 'error' ? ` (${pvcs.reason})` : ''}, so a backup target can&apos;t be offered. Run cluster-backup.sh on a control-plane node instead.</span>;
  }
  const names = pvcs.data.map((p) => p.metadata.name);
  if (names.length === 0) {
    return <span className="text-xs text-slate-500 max-w-xs" data-testid="etcd-backup-guidance">An EtcdBackup writes to a PersistentVolumeClaim in openshift-etcd, and there is none. Create one first, or run cluster-backup.sh on a control-plane node.</span>;
  }
  const denied = !isLoading && !allowed;
  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={isLoading || denied}
        title={denied ? 'You do not have permission to create EtcdBackups' : undefined}
        onClick={() => open({
          title: 'Take an etcd backup now?',
          description: 'Creates a one-time EtcdBackup. The etcd operator runs a backup Job in openshift-etcd that writes a snapshot and the static pod resources to the PVC. It does not change cluster state. The EtcdBackup API is Tech Preview.',
          confirmLabel: 'Take backup',
          what: 'The etcd backup',
          inputs: [
            { id: 'name', label: 'Name', initial: defaultBackupName(), validate: (v) => (DNS1123.test(v) && v.length <= 253 ? null : 'Lowercase letters, digits, "-" and "."; must start and end with a letter or digit') },
            { id: 'pvcName', label: `PersistentVolumeClaim in openshift-etcd (${names.join(', ')})`, initial: names[0], validate: (v) => (names.includes(v) ? null : `Must be one of: ${names.join(', ')}`) },
          ],
          body: (
            <p className="mt-3 text-xs text-slate-400">
              Sends <code className="font-mono text-slate-300">POST {ETCD_BACKUPS_PATH}</code> with kind EtcdBackup and spec.pvcName (dry run first). pvcName cannot be changed afterwards. Undo: delete the EtcdBackup; the files already written stay on the volume.
            </p>
          ),
          run: async (cid, values) => {
            const body = etcdBackupManifest(values.name, values.pvcName);
            await k8sCreate(`${ETCD_BACKUPS_PATH}?dryRun=All`, body, cid);
            return k8sCreate(ETCD_BACKUPS_PATH, body, cid);
          },
          success: (values) => `EtcdBackup ${values.name} created`,
          successDetail: 'The readiness check shows it once the backup Job completes.',
          onDone,
        })}
      >
        <Database className="w-3.5 h-3.5" aria-hidden="true" />Take backup now
      </button>
      {denied && <span className="text-xs text-slate-500">You do not have permission to create EtcdBackups.</span>}
      {dialog}
    </>
  );
}

/**
 * "Pause worker pools first": pauses every unpaused non-master pool, so the
 * control plane updates while worker nodes keep running their workloads
 * until the pools are unpaused.
 */
export function PauseWorkerPoolsButton({ pools }: { pools: MachineConfigPool[] }) {
  const { allowed, isLoading } = useCanI('patch', 'machineconfiguration.openshift.io', 'machineconfigpools');
  const { open, dialog } = useActionDialog();
  // Control-plane pools (master, arbiter) update with the control plane and are not "worker pools".
  const workers = pools.filter((p) => !CONTROL_PLANE_POOLS.has(p.metadata.name));
  const toPause = workers.filter((p) => !p.spec?.paused);
  if (workers.length === 0) return null;
  if (toPause.length === 0) return <span className="text-xs text-slate-400" data-testid="worker-pools-paused">Worker pools paused: {workers.map((p) => p.metadata.name).join(', ')}</span>;
  const denied = !isLoading && !allowed;
  const names = toPause.map((p) => p.metadata.name);
  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={isLoading || denied}
        title={denied ? 'You do not have permission to change MachineConfigPools' : undefined}
        onClick={() => open({
          title: `Pause ${names.length === 1 ? `MachineConfigPool "${names[0]}"` : `${names.length} worker pools`} before the update?`,
          description: 'The control plane updates; nodes in a paused pool are not drained or rebooted until it is unpaused. Do not leave pools paused for long: on some OpenShift versions rotated certificates do not reach nodes in a paused pool, and later updates can be blocked until they catch up.',
          confirmLabel: 'Pause',
          what: 'Pausing the worker pools',
          body: <p className="mt-3 text-xs text-slate-400">Merge patch <code className="font-mono text-slate-300">{'{"spec":{"paused":true}}'}</code> on {names.join(', ')}, conditional on the version shown (dry run first). Undo: unpause each pool.</p>,
          run: async (cid) => {
            const reqs = toPause.map((p) => ({ name: p.metadata.name, req: setMcpPaused(p, true) }));
            for (const { req } of reqs) await sendWrite({ ...req, path: `${req.path}?dryRun=All` }, cid);
            const done: string[] = [];
            for (const { name, req } of reqs) {
              try {
                await sendWrite(req, cid);
                done.push(name);
              } catch (err) {
                // Say which pools are already paused, so a partial result is not mistaken for nothing.
                const why = describeWriteError(err);
                throw new Error(done.length ? `${name}: ${why} (already paused: ${done.join(', ')}; unpause them if you are not going ahead)` : `${name}: ${why}`);
              }
            }
          },
          success: `Paused ${names.join(', ')}`,
        })}
      >
        <Pause className="w-3.5 h-3.5" aria-hidden="true" />Pause worker pools first
      </button>
      {dialog}
    </>
  );
}
