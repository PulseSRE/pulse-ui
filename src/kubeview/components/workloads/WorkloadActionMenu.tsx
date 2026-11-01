/**
 * The actions an admin or developer needs on a workload, in one menu used by
 * the Workloads lists, the resource tables and the detail page header.
 *
 * Every state-changing item opens a confirmation (useActionDialog) that says
 * what will happen and pins the cluster; items the user's RBAC does not allow
 * stay in the menu, disabled, with the reason.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFleetStore } from '../../store/fleetStore';
import { k8sList } from '../../engine/query';
import {
  Scale, RotateCw, Pause, Play, History, Trash2, Zap, FileText, Terminal, RefreshCcw,
} from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '../primitives/ActionMenu';
import { useActionDialog, type ActionSpec } from '../ActionDialog';
import { useCanI } from '../../hooks/useCanI';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { showErrorToast } from '../../engine/errorToast';
import { openPodTerminal } from '../../engine/nodeActions';
import { describePodRestart } from '../../engine/writeGuards';
import { getActiveClusterId } from '../../engine/clusterConnection';
import {
  deleteRequest, jobFromCronJob, rerunJob, rolloutRestart, sendWrite, setCronJobSuspended,
  setReplicas, setRolloutPaused,
} from '../../engine/workloadActions';
import type { K8sResource } from '../../engine/renderers';

/** Kinds whose resource-table rows get the menu (pods keep their own inline Logs/Restart). */
export const TABLE_ACTION_KINDS = new Set(['Deployment', 'StatefulSet', 'ReplicaSet', 'DaemonSet', 'CronJob', 'Job']);

const KIND_RBAC: Record<string, { group: string; plural: string }> = {
  Deployment: { group: 'apps', plural: 'deployments' },
  StatefulSet: { group: 'apps', plural: 'statefulsets' },
  ReplicaSet: { group: 'apps', plural: 'replicasets' },
  DaemonSet: { group: 'apps', plural: 'daemonsets' },
  CronJob: { group: 'batch', plural: 'cronjobs' },
  Job: { group: 'batch', plural: 'jobs' },
  Pod: { group: '', plural: 'pods' },
};

export function hasWorkloadActions(kind: string | undefined): boolean {
  return !!kind && kind in KIND_RBAC;
}

export interface WorkloadActionOptions {
  /**
   * `detail`: the page header already has Logs, Terminal and Delete, so the
   * menu leaves them out. `list` (default): everything.
   */
  context?: 'list' | 'detail';
  /** Leave Delete out where the host already has its own delete control (resource tables). */
  includeDelete?: boolean;
  /** Called after a delete succeeds (e.g. to leave a detail page). */
  onDeleted?: () => void;
}

const icon = (C: React.ComponentType<{ className?: string }>, cls = '') => <C className={`w-3.5 h-3.5 ${cls}`} />;
const NO_PERMISSION = 'You do not have permission to do this';

function ref(r: K8sResource): string {
  return `${r.kind} "${r.metadata.name}"${r.metadata.namespace ? ` in ${r.metadata.namespace}` : ''}`;
}

function replicaInput(current: number): ActionSpec['inputs'] {
  return [{
    id: 'replicas',
    label: 'Replicas',
    initial: String(current),
    type: 'number',
    min: 0,
    validate: (v) => (/^\d+$/.test(v.trim()) && Number(v) <= 1000 ? null : 'Enter a whole number from 0 to 1000'),
  }];
}

export function useWorkloadActions(resource: K8sResource, opts: WorkloadActionOptions = {}): { items: ActionMenuItem[]; dialog: React.ReactNode } {
  const { open, dialog } = useActionDialog();
  const go = useNavigateTab();
  const kind = resource.kind;
  const rbac = KIND_RBAC[kind] ?? { group: '', plural: '' };
  const ns = resource.metadata.namespace;
  const known = !!KIND_RBAC[kind];
  const scalable = kind === 'Deployment' || kind === 'StatefulSet' || kind === 'ReplicaSet';
  const { allowed: canPatch } = useCanI('patch', rbac.group, rbac.plural, ns, undefined, { enabled: known && kind !== 'Pod' && kind !== 'Job' && kind !== 'ReplicaSet' });
  // Scaling is also allowed to users who may only patch `<resource>/scale`.
  const { allowed: canPatchScale } = useCanI('patch', rbac.group, rbac.plural, ns, 'scale', { enabled: scalable });
  const { allowed: canDelete } = useCanI('delete', rbac.group, rbac.plural, ns, undefined, { enabled: known && kind !== 'CronJob' && kind !== 'ReplicaSet' });
  const { allowed: canCreateJobs } = useCanI('create', 'batch', 'jobs', ns, undefined, { enabled: kind === 'CronJob' || kind === 'Job' });
  const clusterId = useFleetStore((st) => st.activeClusterId);
  // An HPA that targets this workload will move the count back within its bounds.
  const { data: hpas = [] } = useQuery({
    queryKey: ['k8s', 'list', 'hpas-for-scale', ns, clusterId],
    queryFn: () => k8sList<K8sResource>(`/apis/autoscaling/v2/namespaces/${ns}/horizontalpodautoscalers`, undefined, clusterId),
    enabled: scalable && !!ns,
    retry: false,
    staleTime: 60_000,
  });
  const context = opts.context ?? 'list';
  if (!known) return { items: [], dialog: null };

  const name = resource.metadata.name;
  const spec = (resource.spec ?? {}) as { replicas?: number; paused?: boolean; suspend?: boolean };
  const gate = (allowed: boolean) => (allowed ? {} : { disabled: true, title: NO_PERMISSION });

  const hpa = hpas.find((h) => {
    const t = (h.spec as { scaleTargetRef?: { kind?: string; name?: string } } | undefined)?.scaleTargetRef;
    return t?.kind === kind && t?.name === name;
  });
  const hpaNote = hpa
    ? ` HorizontalPodAutoscaler "${hpa.metadata.name}" manages this ${kind} (${(hpa.spec as { minReplicas?: number }).minReplicas ?? 1}–${(hpa.spec as { maxReplicas?: number }).maxReplicas} replicas) and will change the count back within those bounds; edit the HPA to change them.`
    : '';
  const scaleItem = (): ActionMenuItem => ({
    icon: icon(Scale), label: 'Set replicas…', ...gate(canPatch || canPatchScale),
    onClick: () => {
      const current = spec.replicas ?? 0;
      open({
        title: `Scale ${kind} "${name}"`,
        description: `Set the number of replicas of ${ref(resource)}. It has ${current} now. The change only applies if nothing else has changed the ${kind} since this page loaded it.${hpaNote}`,
        confirmLabel: 'Scale',
        inputs: replicaInput(current),
        warning: (v) => (Number(v.replicas) === 0 && current > 0
          ? `Scaling to 0 stops all ${current} pod${current === 1 ? '' : 's'}: the workload serves nothing until it is scaled up again.`
          : null),
        run: (cid, v) => sendWrite(setReplicas(resource, Number(v.replicas), !canPatch), cid),
        success: (v) => `Scaled "${name}" to ${Number(v.replicas)} replica${Number(v.replicas) === 1 ? '' : 's'}`,
      });
    },
  });

  const restartItem = (): ActionMenuItem => ({
    icon: icon(RotateCw), label: 'Restart rollout', ...gate(canPatch),
    onClick: () => open({
      title: `Restart ${kind} "${name}"?`,
      description: `Every pod of ${ref(resource)} is replaced, ${kind === 'DaemonSet' ? 'node by node' : 'a few at a time'}, following its update strategy (the same as \`oc rollout restart\`). Pods without a readiness probe may drop traffic while they start.`,
      confirmLabel: 'Restart',
      run: (cid) => sendWrite(rolloutRestart(resource), cid),
      success: `Rollout restart started for "${name}"`,
    }),
  });

  const deleteItem = (): ActionMenuItem => ({
    icon: icon(Trash2), label: 'Delete', danger: canDelete, ...gate(canDelete),
    onClick: () => open({
      title: `Delete ${kind} "${name}"?`,
      description: kind === 'Job'
        ? `${ref(resource)} and its pods will be deleted, including their logs. This cannot be undone.`
        : `${ref(resource)} will be deleted, and with it every pod it manages. This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      run: (cid) => sendWrite(deleteRequest(resource), cid),
      success: `${kind} "${name}" deleted`,
      onDone: opts.onDeleted,
    }),
  });

  const items: ActionMenuItem[] = [];

  if (kind === 'Deployment') {
    items.push(scaleItem(), restartItem());
    items.push(spec.paused
      ? {
          icon: icon(Play), label: 'Resume rollout', ...gate(canPatch),
          onClick: () => open({
            title: `Resume rollout of "${name}"?`,
            description: `${ref(resource)} will roll out any template changes made while it was paused.`,
            confirmLabel: 'Resume',
            run: (cid) => sendWrite(setRolloutPaused(resource, false), cid),
            success: `Rollout of "${name}" resumed`,
          }),
        }
      : {
          icon: icon(Pause), label: 'Pause rollout', ...gate(canPatch),
          onClick: () => open({
            title: `Pause rollout of "${name}"?`,
            description: `Changes to the pod template of ${ref(resource)} will not roll out until it is resumed. Scaling still works.`,
            confirmLabel: 'Pause',
            run: (cid) => sendWrite(setRolloutPaused(resource, true), cid),
            success: `Rollout of "${name}" paused`,
          }),
        });
    items.push({
      icon: icon(History), label: 'Roll back…',
      onClick: () => {
        const path = `/r/apps~v1~deployments/${ns}/${name}`;
        if (window.location.pathname === path) {
          document.getElementById('rollback')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          go(`${path}#rollback`, name);
        }
      },
    });
  } else if (kind === 'StatefulSet') {
    items.push(scaleItem(), restartItem());
  } else if (kind === 'ReplicaSet') {
    items.push(scaleItem());
  } else if (kind === 'DaemonSet') {
    items.push(restartItem());
  } else if (kind === 'CronJob') {
    items.push({
      icon: icon(Zap), label: 'Trigger now', ...gate(canCreateJobs),
      onClick: () => open({
        title: `Run CronJob "${name}" now?`,
        description: `A Job is created from the CronJob's job template, as \`oc create job --from=cronjob/${name}\` does, and runs immediately, outside the schedule. It is owned by the CronJob, so it appears in its history.`,
        confirmLabel: 'Run now',
        run: (cid) => sendWrite(jobFromCronJob(resource), cid),
        success: `Job started from CronJob "${name}"`,
      }),
    });
    items.push(spec.suspend
      ? {
          icon: icon(Play), label: 'Resume schedule', ...gate(canPatch),
          onClick: () => open({
            title: `Resume CronJob "${name}"?`,
            description: `${ref(resource)} will start Jobs on its schedule again.`,
            confirmLabel: 'Resume',
            run: (cid) => sendWrite(setCronJobSuspended(resource, false), cid),
            success: `CronJob "${name}" resumed`,
          }),
        }
      : {
          icon: icon(Pause), label: 'Suspend schedule', ...gate(canPatch),
          onClick: () => open({
            title: `Suspend CronJob "${name}"?`,
            description: `${ref(resource)} will start no new Jobs until it is resumed. Jobs already running are not stopped.`,
            confirmLabel: 'Suspend',
            run: (cid) => sendWrite(setCronJobSuspended(resource, true), cid),
            success: `CronJob "${name}" suspended`,
          }),
        });
  } else if (kind === 'Job') {
    items.push({
      icon: icon(RefreshCcw), label: 'Re-run', ...gate(canCreateJobs),
      onClick: () => open({
        title: `Re-run Job "${name}"?`,
        description: `A new Job is created in ${ns} with the same pod template. The original Job and its pods are left as they are.`,
        confirmLabel: 'Re-run',
        run: (cid) => sendWrite(rerunJob(resource), cid),
        success: `Job "${name}" re-run`,
      }),
    });
  } else if (kind === 'Pod') {
    if (context === 'list') {
      items.push(
        { icon: icon(FileText), label: 'Logs', onClick: () => go(`/logs/${ns}/${name}`, `${name} (Logs)`) },
        {
          icon: icon(Terminal), label: 'Exec (terminal)',
          onClick: () => { openPodTerminal(ns || '', name, getActiveClusterId()).catch((err) => showErrorToast(err, 'Could not open a terminal')); },
        },
      );
    }
    const plan = describePodRestart(resource);
    items.push({
      icon: icon(plan.replaced ? RotateCw : Trash2), label: plan.replaced ? 'Restart pod' : 'Delete pod',
      danger: !plan.replaced && canDelete, ...gate(canDelete),
      onClick: () => open({
        title: plan.title,
        description: plan.description,
        confirmLabel: plan.confirmLabel,
        variant: plan.variant,
        run: (cid) => sendWrite(deleteRequest(resource), cid),
        success: plan.replaced ? `Pod "${name}" deleted; its controller will replace it` : `Pod "${name}" deleted`,
        onDone: plan.replaced ? undefined : opts.onDeleted,
      }),
    });
  }

  if ((kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet' || kind === 'Job') && context === 'list' && opts.includeDelete !== false) {
    items.push('separator', deleteItem());
  }

  return { items, dialog };
}

/** The menu itself: a "more actions" button plus its dialogs. */
export function WorkloadActionMenu({ resource, ...opts }: { resource: K8sResource } & WorkloadActionOptions) {
  const { items, dialog } = useWorkloadActions(resource, opts);
  if (items.length === 0) return null;
  return (
    <>
      <ActionMenu items={items} label={`Actions for ${resource.kind} ${resource.metadata.name}`} />
      {dialog}
    </>
  );
}
