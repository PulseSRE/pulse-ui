import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// K8s Resource type
export type K8sResource = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    resourceVersion?: string;
    uid?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp?: string;
    ownerReferences?: Array<{ apiVersion: string; kind: string; name: string; uid: string }>;
    deletionTimestamp?: string;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
};

// Column definition for list views
export interface ColumnDef {
  id: string;
  header: string;
  accessorFn: (resource: K8sResource) => unknown;
  render: (value: unknown, resource: K8sResource) => ReactNode;
  sortable: boolean;
  width?: string;       // CSS width
  priority: number;     // lower = shown first, higher = hidden on small screens
}

// Helper to get a nested value from an object using dot path
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;

  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

// Helper to compute age from timestamp
function ageFromTimestamp(ts: string | undefined): string {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

// Built-in renderers

export function renderName(value: unknown, resource: K8sResource): ReactNode {
  const name = String(value || '-');
  const namespace = resource.metadata.namespace;

  // Use _gvrKey stamped by TableView, or build from apiVersion+kind as fallback
  const gvrKey = (resource as Record<string, unknown>)._gvrKey as string | undefined;

  let gvrUrl = '';
  if (gvrKey) {
    gvrUrl = gvrKey.replace(/\//g, '~');
  } else {
    const apiVersion = resource.apiVersion || '';
    const kind = resource.kind || '';
    if (apiVersion && kind) {
      const parts = apiVersion.split('/');
      const plural = kind.toLowerCase() + 's';
      gvrUrl = parts.length === 2
        ? `${parts[0]}~${parts[1]}~${plural}`
        : `${parts[0]}~${plural}`;
    }
  }

  const url = gvrUrl
    ? (namespace ? `/r/${gvrUrl}/${namespace}/${name}` : `/r/${gvrUrl}/_/${name}`)
    : '#';

  return (
    <Link to={url} className="font-semibold text-blue-400 hover:text-blue-300 hover:underline">
      {name}
    </Link>
  );
}

export function renderNamespace(value: unknown): ReactNode {
  if (!value) return null;
  const ns = String(value);

  return (
    <span
      className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-slate-700 text-slate-300"
    >
      {ns}
    </span>
  );
}

export function renderAge(value: unknown): ReactNode {
  const timestamp = value ? String(value) : undefined;
  const age = ageFromTimestamp(timestamp);

  return (
    <span className="text-sm text-gray-600" title={timestamp}>
      {age}
    </span>
  );
}

export function renderStatus(value: unknown): ReactNode {
  const status = String(value || 'Unknown').toLowerCase();

  let color = 'gray';
  if (status === 'running' || status === 'ready' || status === 'active' || status === 'healthy') {
    color = 'green';
  } else if (status === 'pending' || status === 'progressing') {
    color = 'yellow';
  } else if (status === 'failed' || status === 'error' || status === 'crashloopbackoff') {
    color = 'red';
  } else if (status === 'terminating') {
    color = 'orange';
  }

  const dotClass = `inline-block w-2 h-2 rounded-full mr-2 bg-${color}-500`;

  return (
    <span className="inline-flex items-center text-sm">
      <span className={dotClass} />
      <span className="capitalize">{String(value || 'Unknown')}</span>
    </span>
  );
}

export function renderLabels(value: unknown): ReactNode {
  if (!value || typeof value !== 'object') return null;

  const labels = value as Record<string, string>;
  const entries = Object.entries(labels);

  if (entries.length === 0) return <span className="text-gray-400 text-xs">None</span>;

  // Show first 3 labels, then a count
  const visible = entries.slice(0, 3);
  const remaining = entries.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(([key, val]) => (
        <span
          key={key}
          className="inline-block px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded border border-gray-300"
          title={`${key}=${val}`}
        >
          {key.length > 15 ? `${key.slice(0, 12)}...` : key}
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-block px-1.5 py-0.5 text-xs text-gray-500">
          +{remaining}
        </span>
      )}
    </div>
  );
}

export function renderReplicas(value: unknown, resource: K8sResource): ReactNode {
  const status = resource.status as Record<string, unknown> | undefined;
  const spec = resource.spec as Record<string, unknown> | undefined;

  const ready = Number(status?.readyReplicas ?? status?.availableReplicas ?? 0);
  const desired = Number(spec?.replicas ?? 0);

  const allReady = ready === desired && desired > 0;
  const color = allReady ? 'text-green-600' : ready > 0 ? 'text-yellow-600' : 'text-red-600';

  return (
    <span className={`font-mono text-sm ${color} font-semibold`}>
      {ready}/{desired}
    </span>
  );
}

export function renderContainers(value: unknown): ReactNode {
  if (!value || !Array.isArray(value)) return <span className="text-gray-400">-</span>;

  const containers = value as Array<Record<string, unknown>>;
  const count = containers.length;
  const ready = containers.filter((c) => c.ready === true).length;

  const allReady = ready === count;
  const color = allReady ? 'text-green-600' : 'text-yellow-600';

  return (
    <span className={`font-mono text-sm ${color}`}>
      {ready}/{count}
    </span>
  );
}

export function renderBoolean(value: unknown): ReactNode {
  const bool = Boolean(value);

  return bool ? (
    <span className="text-green-600 font-semibold">✓</span>
  ) : (
    <span className="text-gray-400">✗</span>
  );
}

export function renderQuantity(value: unknown): ReactNode {
  if (!value) return <span className="text-gray-400">-</span>;

  const qty = String(value);
  return (
    <span className="font-mono text-sm text-gray-700">
      {qty}
    </span>
  );
}

export function renderLink(value: unknown): ReactNode {
  if (!value) return null;

  const url = String(value);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 hover:underline text-sm"
    >
      {url.length > 40 ? `${url.slice(0, 37)}...` : url}
    </a>
  );
}

export function renderDefault(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-gray-400">-</span>;
  }

  if (typeof value === 'object') {
    return <span className="text-gray-400 text-xs">Object</span>;
  }

  return <span className="text-sm text-gray-700">{String(value)}</span>;
}

export function renderConditions(value: unknown): ReactNode {
  if (!value || !Array.isArray(value)) return null;

  const conditions = value as Array<Record<string, unknown>>;

  return (
    <div className="flex flex-wrap gap-1">
      {conditions.map((cond, i) => {
        const type = String(cond.type ?? '');
        const status = String(cond.status ?? '');
        const isTrue = status === 'True';
        const color = isTrue ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600';

        return (
          <span
            key={i}
            className={`inline-block px-2 py-0.5 text-xs rounded ${color}`}
            title={String(cond.message ?? '')}
          >
            {type}
          </span>
        );
      })}
    </div>
  );
}

// Default columns that every resource gets
export function getDefaultColumns(namespaced: boolean): ColumnDef[] {
  const cols: ColumnDef[] = [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (resource) => resource.metadata.name,
      render: renderName,
      sortable: true,
      width: '25%',
      priority: 0,
    },
  ];

  if (namespaced) {
    cols.push({
      id: 'namespace',
      header: 'Namespace',
      accessorFn: (resource) => resource.metadata.namespace,
      render: renderNamespace,
      sortable: true,
      width: '15%',
      priority: 1,
    });
  }

  cols.push({
    id: 'age',
    header: 'Age',
    accessorFn: (resource) => resource.metadata.creationTimestamp,
    render: renderAge,
    sortable: true,
    width: '10%',
    priority: 2,
  });

  return cols;
}
