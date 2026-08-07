/**
 * FleetResourceView -- unified resource table showing a single resource type across ALL clusters.
 * Accessed via /fleet/r/:gvr where gvr uses ~ as separator (e.g. apps~v1~deployments).
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ChevronUp, ChevronDown, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fleetList, type FleetResult } from '../../engine/fleet';
import { detectResourceStatus } from '../../engine/renderers/statusUtils';
import { timeAgo } from '../../engine/dateUtils';
import { getAllConnections, type ClusterConnection } from '../../engine/clusterConnection';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';
import type { K8sResource } from '../../engine/renderers/index';

interface FleetResourceViewProps {
  gvrKey: string;
}

interface FlatRow {
  clusterId: string;
  clusterName: string;
  clusterStatus: ClusterConnection['status'];
  resource: K8sResource;
}

type SortColumn = 'cluster' | 'name' | 'namespace' | 'status' | 'age';
type SortDir = 'asc' | 'desc';

export default function FleetResourceView({ gvrKey }: FleetResourceViewProps) {
  const navigate = useNavigate();
  const setActiveCluster = useFleetStore((s) => s.setActiveCluster);
  const addTab = useUIStore((s) => s.addTab);

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<FleetResult<K8sResource>[]>([]);
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<SortColumn>('cluster');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Build API path from GVR key
  const apiPath = useMemo(() => {
    const parts = gvrKey.split('/');
    if (parts.length === 2) return `/api/${parts[0]}/${parts[1]}`;
    if (parts.length === 3) return `/apis/${parts[0]}/${parts[1]}/${parts[2]}`;
    return '';
  }, [gvrKey]);

  const resourceKind = useMemo(() => {
    const name = gvrKey.split('/').pop() || '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  }, [gvrKey]);

  // Fetch
  const fetchResources = useCallback(async () => {
    if (!apiPath) return;
    setLoading(true);
    try {
      const r = await fleetList<K8sResource>(apiPath);
      setResults(r);
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  // Build cluster connection map for status dots
  const clusterMap = useMemo(() => {
    const map = new Map<string, ClusterConnection>();
    for (const c of getAllConnections()) map.set(c.id, c);
    return map;
  }, []);

  // Flatten results into rows
  const flatRows: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const conn = clusterMap.get(r.clusterId);
      for (const resource of r.data) {
        rows.push({
          clusterId: r.clusterId,
          clusterName: r.clusterName,
          clusterStatus: conn?.status || 'unknown',
          resource,
        });
      }
    }
    return rows;
  }, [results, clusterMap]);

  // Per-cluster counts
  const perClusterCounts = useMemo(() => {
    const map = new Map<string, { name: string; count: number; error?: string }>();
    for (const r of results) {
      map.set(r.clusterId, {
        name: r.clusterName,
        count: r.status === 'fulfilled' ? r.data.length : 0,
        error: r.error,
      });
    }
    return map;
  }, [results]);

  // Filter
  const filteredRows = useMemo(() => {
    let rows = flatRows;
    if (clusterFilter !== 'all') {
      rows = rows.filter(r => r.clusterId === clusterFilter);
    }
    if (namespaceFilter) {
      const ns = namespaceFilter.toLowerCase();
      rows = rows.filter(r => (r.resource.metadata.namespace || '').toLowerCase().includes(ns));
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(r =>
        r.resource.metadata.name.toLowerCase().includes(term) ||
        (r.resource.metadata.namespace || '').toLowerCase().includes(term) ||
        r.clusterName.toLowerCase().includes(term)
      );
    }
    return rows;
  }, [flatRows, clusterFilter, namespaceFilter, searchTerm]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'cluster': cmp = a.clusterName.localeCompare(b.clusterName); break;
        case 'name': cmp = a.resource.metadata.name.localeCompare(b.resource.metadata.name); break;
        case 'namespace': cmp = (a.resource.metadata.namespace || '').localeCompare(b.resource.metadata.namespace || ''); break;
        case 'status': {
          const sa = detectResourceStatus(a.resource).status;
          const sb = detectResourceStatus(b.resource).status;
          cmp = sa.localeCompare(sb);
          break;
        }
        case 'age': {
          const ta = new Date(a.resource.metadata.creationTimestamp || 0).getTime();
          const tb = new Date(b.resource.metadata.creationTimestamp || 0).getTime();
          cmp = ta - tb;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const handleRowClick = (row: FlatRow) => {
    setActiveCluster(row.clusterId);
    const gvrUrl = gvrKey.replace(/\//g, '~');
    const ns = row.resource.metadata.namespace;
    const name = row.resource.metadata.name;
    const path = ns ? `/r/${gvrUrl}/${ns}/${name}` : `/r/${gvrUrl}/_/${name}`;
    addTab({ title: `${name} (${row.clusterName})`, path, pinned: false, closable: true });
    navigate(path);
  };

  const clusterIds = useMemo(() =>
    Array.from(new Set(results.map(r => r.clusterId))),
    [results]
  );

  const statusDot = (status: ClusterConnection['status']) => {
    const color = status === 'connected' ? 'bg-emerald-500' :
                  status === 'auth-expired' ? 'bg-amber-500' : 'bg-red-500';
    return <span className={cn('inline-block w-2 h-2 rounded-full', color)} />;
  };

  const statusBadge = (resource: K8sResource) => {
    const { status, reason } = detectResourceStatus(resource);
    const colors: Record<string, string> = {
      healthy: 'bg-emerald-900/50 text-emerald-300',
      warning: 'bg-amber-900/50 text-amber-300',
      error: 'bg-red-900/50 text-red-300',
      pending: 'bg-blue-900/50 text-blue-300',
      terminating: 'bg-slate-700 text-slate-300',
      unknown: 'bg-slate-800 text-slate-400',
    };
    return (
      <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', colors[status] || colors.unknown)}>
        {reason || status}
      </span>
    );
  };

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortCol !== col) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  // Empty state
  if (!loading && results.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="text-center space-y-2">
          <Globe className="w-10 h-10 text-slate-700 mx-auto" />
          <p className="text-slate-400 text-sm">No clusters connected</p>
          <p className="text-slate-600 text-xs">Connect clusters in the Fleet view to browse resources across your fleet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-500" />
              Fleet {resourceKind}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {sortedRows.length} resources across {perClusterCounts.size} clusters
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Cluster filter */}
            <select
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-sm px-2 py-1.5 text-slate-200"
              aria-label="Filter by cluster"
            >
              <option value="all">All clusters</option>
              {clusterIds.map(id => {
                const info = perClusterCounts.get(id);
                return <option key={id} value={id}>{info?.name || id} ({info?.count || 0})</option>;
              })}
            </select>
            {/* Namespace filter */}
            <input
              type="text"
              value={namespaceFilter}
              onChange={(e) => setNamespaceFilter(e.target.value)}
              placeholder="Namespace..."
              className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-500 w-32"
              aria-label="Filter by namespace"
            />
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-500 w-48"
              />
            </div>
          </div>
        </div>

        {/* Per-cluster summary bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {Array.from(perClusterCounts.entries()).map(([id, info]) => (
            <span key={id} className="flex items-center gap-1.5 text-xs text-slate-400">
              {statusDot(clusterMap.get(id)?.status || 'unknown')}
              <span className="text-slate-300">{info.name}</span>
              <span className="font-mono">{info.count}</span>
              {info.error && <span className="text-red-400">(error)</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 bg-slate-800 rounded-sm w-28" />
                <div className="h-4 bg-slate-800 rounded-sm flex-1 max-w-[200px]" />
                <div className="h-4 bg-slate-800 rounded-sm w-24" />
                <div className="h-4 bg-slate-800 rounded-sm w-20" />
                <div className="h-4 bg-slate-800 rounded-sm w-16" />
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-900 sticky top-0 z-10">
              <tr>
                {([
                  ['cluster', 'Cluster'],
                  ['name', 'Name'],
                  ['namespace', 'Namespace'],
                  ['status', 'Status'],
                  ['age', 'Age'],
                ] as [SortColumn, string][]).map(([col, label]) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-300"
                  >
                    <div className="flex items-center gap-1">
                      {label}
                      <SortIcon col={col} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                    No matching {resourceKind.toLowerCase()} found
                  </td>
                </tr>
              )}
              {sortedRows.map((row, i) => (
                <tr
                  key={`${row.clusterId}-${row.resource.metadata.uid || row.resource.metadata.name}-${i}`}
                  onClick={() => handleRowClick(row)}
                  className="hover:bg-slate-800/70 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-sm text-slate-200">
                      {statusDot(row.clusterStatus)}
                      {row.clusterName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-200 font-mono">{row.resource.metadata.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{row.resource.metadata.namespace || '-'}</td>
                  <td className="px-4 py-3">{statusBadge(row.resource)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{timeAgo(row.resource.metadata.creationTimestamp || '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
