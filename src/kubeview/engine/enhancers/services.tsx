import React from 'react';
import type { ResourceEnhancer } from './index';

export const serviceEnhancer: ResourceEnhancer = {
  matches: ['v1/services'],

  columns: [
    {
      id: 'type',
      header: 'Type',
      accessorFn: (resource) => {
        const spec = resource.spec as Record<string, unknown> | undefined;
        return spec?.type ?? 'ClusterIP';
      },
      render: (value) => {
        const type = String(value);
        let color = 'bg-blue-900 text-blue-300';

        if (type === 'LoadBalancer') {
          color = 'bg-green-900 text-green-300';
        } else if (type === 'NodePort') {
          color = 'bg-purple-900 text-purple-300';
        } else if (type === 'ExternalName') {
          color = 'bg-orange-900 text-orange-300';
        }

        return (
          <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${color}`}>
            {type}
          </span>
        );
      },
      sortable: true,
      priority: 10,
    },
    {
      id: 'clusterIP',
      header: 'Cluster IP',
      accessorFn: (resource) => {
        const spec = resource.spec as Record<string, unknown> | undefined;
        return spec?.clusterIP ?? '-';
      },
      render: (value) => {
        if (!value || value === '-' || value === 'None') {
          return <span className="text-slate-500">{String(value)}</span>;
        }

        return <span className="font-mono text-sm text-slate-300">{String(value)}</span>;
      },
      sortable: false,
      priority: 11,
    },
    {
      id: 'ports',
      header: 'Ports',
      accessorFn: (resource) => {
        const spec = resource.spec as Record<string, unknown> | undefined;
        const ports = (spec?.ports ?? []) as Array<Record<string, unknown>>;

        if (ports.length === 0) return '-';

        return ports
          .map((p) => {
            const port = p.port;
            const targetPort = p.targetPort;
            const protocol = p.protocol ?? 'TCP';
            const nodePort = p.nodePort;

            if (nodePort) {
              return `${port}:${nodePort}/${protocol}`;
            }
            if (targetPort && targetPort !== port) {
              return `${port}->${targetPort}/${protocol}`;
            }
            return `${port}/${protocol}`;
          })
          .join(', ');
      },
      render: (value) => {
        if (!value || value === '-') {
          return <span className="text-slate-500">-</span>;
        }

        const ports = String(value);
        const shortened = ports.length > 40 ? `${ports.slice(0, 37)}...` : ports;

        return (
          <span className="font-mono text-xs text-slate-300" title={ports}>
            {shortened}
          </span>
        );
      },
      sortable: false,
      width: '20%',
      priority: 12,
    },
    {
      id: 'selector',
      header: 'Selector',
      accessorFn: (resource) => {
        const spec = resource.spec as Record<string, unknown> | undefined;
        const selector = spec?.selector as Record<string, string> | undefined;

        if (!selector || Object.keys(selector).length === 0) return '-';

        return Object.entries(selector)
          .map(([key, val]) => `${key}=${val}`)
          .join(', ');
      },
      render: (value) => {
        if (!value || value === '-') {
          return <span className="text-slate-500">-</span>;
        }

        const selector = String(value);
        const shortened = selector.length > 35 ? `${selector.slice(0, 32)}...` : selector;

        return (
          <span className="text-xs text-slate-300" title={selector}>
            {shortened}
          </span>
        );
      },
      sortable: false,
      width: '20%',
      priority: 13,
    },
  ],

  defaultSort: { column: 'name', direction: 'asc' },
};
