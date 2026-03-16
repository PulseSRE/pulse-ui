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

/**
 * Auto-detect columns from resource data for types without enhancers.
 * Scans top-level fields, spec, and status to find useful columns.
 */
export function autoDetectColumns(resources: K8sResource[]): ColumnDef[] {
  if (resources.length === 0) return [];

  const cols: ColumnDef[] = [];
  const usedHeaders = new Set<string>();
  const sample = resources.slice(0, 5);

  // Skip these fields (already shown or not useful in tables)
  const skip = new Set(['apiVersion', 'kind', 'metadata', '_gvrKey', 'managedFields', 'spec', 'status']);

  // Check top-level scalar fields (e.g., "type" on Secrets)
  const topFields = new Set<string>();
  for (const r of sample) {
    for (const key of Object.keys(r)) {
      if (skip.has(key)) continue;
      const val = r[key];
      if (val !== null && val !== undefined && typeof val !== 'object') {
        topFields.add(key);
      }
    }
  }

  function addCol(col: ColumnDef) {
    const header = col.header.toLowerCase();
    if (usedHeaders.has(header)) return;
    usedHeaders.add(header);
    cols.push(col);
  }

  // Check top-level objects → extract scalar sub-fields (e.g., roleRef.name, roleRef.kind)
  const topObjectFields: Array<{ parent: string; child: string }> = [];
  for (const r of sample) {
    for (const key of Object.keys(r)) {
      if (skip.has(key)) continue;
      const val = r[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        for (const childKey of Object.keys(val as Record<string, unknown>)) {
          const childVal = (val as Record<string, unknown>)[childKey];
          if (childVal !== null && childVal !== undefined && typeof childVal !== 'object') {
            const combo = `${key}.${childKey}`;
            if (!topObjectFields.some((f) => f.parent === key && f.child === childKey)) {
              topObjectFields.push({ parent: key, child: childKey });
            }
          }
        }
      }
    }
  }

  // Check top-level arrays → show count (e.g., subjects: 3)
  const topArrayFields = new Set<string>();
  for (const r of sample) {
    for (const key of Object.keys(r)) {
      if (skip.has(key)) continue;
      const val = r[key];
      if (Array.isArray(val)) {
        topArrayFields.add(key);
      }
    }
  }

  for (const field of topFields) {
    addCol({
      id: `top_${field}`,
      header: formatHeader(field),
      accessorFn: (resource) => resource[field] ?? '-',
      render: renderAutoValue,
      sortable: true,
      priority: 10 + cols.length,
    });
  }

  // Add object sub-field columns (e.g., roleRef.name, roleRef.kind)
  // Prioritize common useful sub-fields
  const subFieldPriority = ['name', 'kind', 'type', 'apiGroup', 'host', 'path', 'port'];
  const sortedObjectFields = topObjectFields.sort((a, b) => {
    const ai = subFieldPriority.indexOf(a.child);
    const bi = subFieldPriority.indexOf(b.child);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const { parent, child } of sortedObjectFields.slice(0, 4)) {
    const field = parent; // capture for closure
    const sub = child;
    addCol({
      id: `obj_${field}_${sub}`,
      header: `${formatHeader(field)} ${formatHeader(sub)}`,
      accessorFn: (resource) => {
        const obj = resource[field] as Record<string, unknown> | undefined;
        return obj?.[sub] ?? '-';
      },
      render: renderAutoValue,
      sortable: true,
      priority: 12 + cols.length,
    });
  }

  // Add array count columns (e.g., subjects: 3)
  for (const field of topArrayFields) {
    const f = field; // capture
    addCol({
      id: `arr_${f}`,
      header: formatHeader(f),
      accessorFn: (resource) => {
        const arr = resource[f] as unknown[] | undefined;
        return arr ? arr.length : 0;
      },
      render: (value) => {
        const count = Number(value);
        return React.createElement('span', { className: 'font-mono text-sm text-slate-300' }, count);
      },
      sortable: true,
      priority: 13 + cols.length,
    });
  }

  // Check spec scalar fields
  const specFields = new Set<string>();
  for (const r of sample) {
    const spec = r.spec as Record<string, unknown> | undefined;
    if (!spec) continue;
    for (const key of Object.keys(spec)) {
      const val = spec[key];
      if (val !== null && val !== undefined && typeof val !== 'object') {
        specFields.add(key);
      }
    }
  }

  // Limit spec columns to most common ones
  const specPriority = ['replicas', 'type', 'clusterIP', 'selector', 'host', 'schedule',
    'completions', 'parallelism', 'suspend', 'nodeName', 'serviceAccountName',
    'ports', 'loadBalancerIP', 'externalName', 'storageClassName', 'accessModes',
    'capacity', 'reclaimPolicy', 'volumeBindingMode'];

  const sortedSpecFields = [...specFields].sort((a, b) => {
    const ai = specPriority.indexOf(a);
    const bi = specPriority.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const field of sortedSpecFields.slice(0, 4)) {
    addCol({
      id: `spec_${field}`,
      header: formatHeader(field),
      accessorFn: (resource) => {
        const spec = resource.spec as Record<string, unknown> | undefined;
        return spec?.[field] ?? '-';
      },
      render: renderAutoValue,
      sortable: true,
      priority: 20 + cols.length,
    });
  }

  // Check status scalar fields
  const statusFields = new Set<string>();
  for (const r of sample) {
    const status = r.status as Record<string, unknown> | undefined;
    if (!status) continue;
    for (const key of Object.keys(status)) {
      if (statusSkip.has(key)) continue;
      const val = status[key];
      if (val !== null && val !== undefined && typeof val !== 'object') {
        statusFields.add(key);
      }
    }
  }

  // Skip noisy status fields
  const statusSkip = new Set(['observedGeneration', 'conditions']);

  const statusPriority = ['phase', 'ready', 'replicas', 'availableReplicas', 'readyReplicas',
    'loadBalancer'];

  const sortedStatusFields = [...statusFields].sort((a, b) => {
    const ai = statusPriority.indexOf(a);
    const bi = statusPriority.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const field of sortedStatusFields.slice(0, 3)) {
    addCol({
      id: `status_${field}`,
      header: formatHeader(field),
      accessorFn: (resource) => {
        const status = resource.status as Record<string, unknown> | undefined;
        return status?.[field] ?? '-';
      },
      render: renderAutoValue,
      sortable: true,
      priority: 30 + cols.length,
    });
  }

  // Check data keys count (for ConfigMaps/Secrets-like resources)
  const hasData = sample.some(r => r.data && typeof r.data === 'object');
  if (hasData) {
    addCol({
      id: 'data_keys',
      header: 'Data Keys',
      accessorFn: (resource) => {
        const data = resource.data as Record<string, unknown> | undefined;
        return data ? Object.keys(data).length : 0;
      },
      render: (value) => {
        const count = Number(value);
        return React.createElement('span', { className: 'font-mono text-sm text-slate-300' }, count);
      },
      sortable: true,
      priority: 15,
    });
  }

  return cols;
}

function formatHeader(field: string): string {
  // camelCase → Title Case
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function renderAutoValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '-') {
    return React.createElement('span', { className: 'text-slate-500' }, '-');
  }

  const str = String(value);

  // Boolean rendering
  if (str === 'true') {
    return React.createElement('span', { className: 'text-green-400' }, '✓');
  }
  if (str === 'false') {
    return React.createElement('span', { className: 'text-slate-500' }, '✗');
  }

  // Phase/status-like values
  const lower = str.toLowerCase();
  if (['running', 'active', 'ready', 'available', 'bound', 'true'].includes(lower)) {
    return React.createElement('span', { className: 'inline-flex items-center gap-1.5 text-sm' },
      React.createElement('span', { className: 'w-2 h-2 rounded-full bg-green-500 inline-block' }),
      str
    );
  }
  if (['pending', 'waiting', 'unknown'].includes(lower)) {
    return React.createElement('span', { className: 'inline-flex items-center gap-1.5 text-sm' },
      React.createElement('span', { className: 'w-2 h-2 rounded-full bg-yellow-500 inline-block' }),
      str
    );
  }
  if (['failed', 'error', 'crashloopbackoff', 'imagepullbackoff'].includes(lower)) {
    return React.createElement('span', { className: 'inline-flex items-center gap-1.5 text-sm' },
      React.createElement('span', { className: 'w-2 h-2 rounded-full bg-red-500 inline-block' }),
      str
    );
  }

  // Truncate long values
  if (str.length > 50) {
    return React.createElement('span', {
      className: 'text-sm text-slate-300 truncate block max-w-[200px]',
      title: str,
    }, str);
  }

  return React.createElement('span', { className: 'text-sm text-slate-300' }, str);
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
