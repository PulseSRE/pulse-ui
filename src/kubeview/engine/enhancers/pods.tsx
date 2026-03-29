import React from 'react';
import { Link } from 'react-router-dom';
import { ScrollText, RotateCw } from 'lucide-react';
import type { ResourceEnhancer } from './index';
import type { Pod } from '../types';
import { getPodStatus } from '../renderers/statusUtils';

export const podEnhancer: ResourceEnhancer = {
  matches: ['v1/pods'],

  columns: [
    {
      id: 'status',
      header: 'Status',
      accessorFn: (resource) => {
        const podStatus = getPodStatus(resource);
        return podStatus.reason ?? podStatus.phase;
      },
      render: (value, resource) => {
        const podStatus = getPodStatus(resource);
        const displayText = podStatus.reason ?? podStatus.phase;

        let color = 'gray';
        const phase = podStatus.phase.toLowerCase();

        if (phase === 'running' && podStatus.ready) {
          color = 'green';
        } else if (phase === 'succeeded') {
          color = 'green';
        } else if (phase === 'pending') {
          color = 'yellow';
        } else if (phase === 'failed' || podStatus.reason) {
          color = 'red';
        } else if (!podStatus.ready) {
          color = 'yellow';
        }

        const colorMap: Record<string, string> = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500', gray: 'bg-slate-500' };
        const dotClass = `inline-block w-2 h-2 rounded-full mr-2 ${colorMap[color] || 'bg-slate-500'}`;

        return (
          <span className="inline-flex items-center text-sm">
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
      accessorFn: (resource) => {
        const p = resource as unknown as Pod;
        const containerStatuses = p.status?.containerStatuses ?? [];
        const ready = containerStatuses.filter((c) => c.ready).length;
        const total = containerStatuses.length;
        return `${ready}/${total}`;
      },
      render: (value) => {
        const [ready, total] = String(value).split('/').map(Number);
        const allReady = ready === total && total > 0;
        const color = allReady ? 'text-green-400' : ready > 0 ? 'text-yellow-400' : 'text-red-400';

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
      accessorFn: (resource) => {
        const podStatus = getPodStatus(resource);
        return podStatus.restartCount;
      },
      render: (value) => {
        const restarts = Number(value);
        const color = restarts > 5 ? 'text-red-400' : restarts > 0 ? 'text-yellow-400' : 'text-slate-500';

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
      accessorFn: (resource) => {
        const p = resource as unknown as Pod;
        return p.spec?.nodeName ?? '-';
      },
      render: (value) => {
        if (!value || value === '-') {
          return <span className="text-slate-500">-</span>;
        }

        const nodeName = String(value);
        return (
          <Link
            to={`/r/v1~nodes/_/${nodeName}`}
            className="text-blue-400 hover:text-blue-300 hover:underline text-sm"
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
      accessorFn: (resource) => {
        const p = resource as unknown as Pod;
        return p.status?.podIP ?? '-';
      },
      render: (value) => {
        if (!value || value === '-') {
          return <span className="text-slate-500">-</span>;
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
            className="inline-flex items-center px-1.5 py-1 text-xs text-slate-500 rounded hover:bg-blue-900/50 hover:text-blue-400 transition-colors"
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
      render: (resource, onAction) => {
        return (
          <button
            onClick={() => onAction('restart', { resource })}
            className="inline-flex items-center px-1.5 py-1 text-xs text-slate-500 rounded hover:bg-orange-900/50 hover:text-orange-400 transition-colors"
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
