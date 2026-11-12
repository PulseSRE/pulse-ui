import React from 'react';
import { Link } from 'react-router-dom';
import { ScrollText, RotateCw } from 'lucide-react';
import type { ResourceEnhancer } from './index';
import type { Pod } from '../types';
import { getPodStatus } from '../renderers/statusUtils';
import { podPhaseClasses } from '../statusColors';

/**
 * What the Pods list says in the Status column, and the longer message behind
 * it. "Pending" alone did not say why: a pod waiting for a node and a pod
 * pulling its image read the same.
 *
 * - a container's problem reason (CrashLoopBackOff, ImagePullBackOff, …) or
 *   the pod's own status.reason, as before
 * - otherwise a container waiting reason (ContainerCreating, PodInitializing)
 * - otherwise, for a pod not yet scheduled, "Pending: <PodScheduled reason>"
 *   (e.g. "Pending: Unschedulable") with the scheduler's message as detail
 * - otherwise the phase
 */
export function podStatusLabel(resource: unknown): { text: string; detail?: string } {
  const pod = resource as Pod;
  const podStatus = getPodStatus(pod);
  const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
  const waitingMessage = (reason: string) =>
    statuses.find((c) => c.state?.waiting?.reason === reason)?.state?.waiting?.message || undefined;

  if (podStatus.reason) {
    return { text: podStatus.reason, detail: waitingMessage(podStatus.reason) ?? (pod.status?.message || undefined) };
  }
  const waiting = podStatus.containerStatuses.find((c) => c.state === 'waiting' && c.reason)?.reason;
  if (waiting && podStatus.phase === 'Pending') return { text: waiting, detail: waitingMessage(waiting) };

  if (podStatus.phase === 'Pending') {
    const scheduled = pod.status?.conditions?.find((c) => c.type === 'PodScheduled');
    if (scheduled && scheduled.status === 'False' && scheduled.reason) {
      return { text: `Pending: ${scheduled.reason}`, detail: scheduled.message || undefined };
    }
  }
  return { text: podStatus.phase };
}

export const podEnhancer: ResourceEnhancer = {
  matches: ['v1/pods'],

  // Fixed pixel widths sized to content, not percentages — see the comment
  // on getDefaultColumns for why: percentages re-truncate everything as
  // soon as the window (or the Pulse AI panel) narrows, since every column
  // shrinks proportionally with the container.
  columns: [
    {
      id: 'status',
      header: 'Status',
      width: '150px',
      accessorFn: (resource) => podStatusLabel(resource).text,
      render: (value, resource) => {
        const podStatus = getPodStatus(resource);
        const { text: displayText, detail } = podStatusLabel(resource);

        // One pod palette with the node map and topology pod grid:
        // Pending is warning, ContainerCreating/PodInitializing is progress.
        // getPodStatus().reason leaves out ContainerCreating (it is not a
        // failure), so take the waiting reason too: start-up reads as progress.
        const waiting = podStatus.containerStatuses.find((c) => c.state === 'waiting' && c.reason)?.reason;
        const tone = podPhaseClasses(podStatus.phase, { reason: podStatus.reason ?? waiting, ready: podStatus.ready });
        const dotClass = `inline-block w-2 h-2 rounded-full mr-2 ${tone.solid}`;

        return (
          <span className="inline-flex items-center text-sm" title={detail ? `${displayText} — ${detail}` : displayText}>
            <span className={dotClass} />
            <span>{displayText}</span>
          </span>
        );
      },
      sortable: true,
      priority: 10,
    },
    {
      id: 'ready',
      header: 'Ready',
      width: '70px',
      accessorFn: (resource) => {
        const p = resource as Pod;
        const containerStatuses = p.status?.containerStatuses ?? [];
        const ready = containerStatuses.filter((c) => c.ready).length;
        const total = containerStatuses.length;
        return `${ready}/${total}`;
      },
      render: (value) => {
        const [ready, total] = String(value).split('/').map(Number);
        const allReady = ready === total && total > 0;
        const color = allReady ? 'text-green-400' : ready > 0 ? 'text-amber-400' : 'text-red-400';

        return (
          <span className={`font-mono text-sm ${color} font-semibold`}>
            {String(value)}
          </span>
        );
      },
      sortable: false,
      priority: 11,
    },
    {
      id: 'restarts',
      header: 'Restarts',
      width: '90px',
      accessorFn: (resource) => {
        const podStatus = getPodStatus(resource);
        return podStatus.restartCount;
      },
      render: (value) => {
        const restarts = Number(value);
        const color = restarts > 5 ? 'text-red-400' : restarts > 0 ? 'text-amber-400' : 'text-faint';

        return (
          <span className={`font-mono text-sm ${color}`}>
            {restarts}
          </span>
        );
      },
      sortable: true,
      sortType: 'number',
      priority: 12,
    },
    {
      id: 'node',
      header: 'Node',
      width: '180px',
      accessorFn: (resource) => {
        const p = resource as Pod;
        return p.spec?.nodeName ?? '-';
      },
      render: (value) => {
        if (!value || value === '-') {
          return <span className="text-faint">-</span>;
        }

        const nodeName = String(value);
        return (
          <Link
            to={`/r/v1~nodes/_/${nodeName}`}
            className="text-blue-400 hover:text-blue-300 hover:underline text-sm"
            title={nodeName}
          >
            {nodeName}
          </Link>
        );
      },
      sortable: true,
      priority: 13,
    },
    {
      id: 'ip',
      header: 'IP',
      width: '110px',
      accessorFn: (resource) => {
        const p = resource as Pod;
        return p.status?.podIP ?? '-';
      },
      render: (value) => {
        if (!value || value === '-') {
          return <span className="text-faint">-</span>;
        }

        return (
          <span className="font-mono text-sm text-slate-300">
            {String(value)}
          </span>
        );
      },
      sortable: false,
      priority: 14,
    },
  ],

  inlineActions: [
    {
      id: 'logs',
      label: 'View Logs',
      icon: 'scroll-text',
      render: (resource) => {
        const namespace = resource.metadata.namespace ?? '';
        const name = resource.metadata.name;

        return (
          <Link
            to={`/logs/${namespace}/${name}`}
            className="inline-flex items-center px-1.5 py-1 text-xs text-faint rounded-sm hover:bg-blue-900/50 hover:text-blue-400 transition-colors"
            title="View Logs"
          >
            <ScrollText className="w-3.5 h-3.5" />
          </Link>
        );
      },
    },
    {
      id: 'restart',
      label: 'Restart',
      icon: 'rotate-cw',
      requires: 'delete',
      render: (resource, onAction) => {
        return (
          <button
            onClick={() => onAction('restart', { resource })}
            className="inline-flex items-center px-1.5 py-1 text-xs text-faint rounded-sm hover:bg-orange-900/50 hover:text-orange-400 transition-colors"
            title="Restart Pod (delete to trigger recreation)"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        );
      },
    },
  ],

  defaultSort: { column: 'name', direction: 'asc' },
};
