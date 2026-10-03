import { useFleetStore } from '../../store/fleetStore';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { k8sPatch, k8sDelete } from '../../engine/query';
import { buildApiPathFromResource } from '../../hooks/useResourceUrl';
import { showErrorToast } from '../../engine/errorToast';
import { useUIStore } from '../../store/uiStore';
import type { K8sResource } from '../../engine/renderers';
import type { ColumnDef } from '../../engine/renderers';
import type { DeleteProgressItem } from './DeleteProgress';

export interface ActionHandlers {
  handleAction: (action: string, payload?: unknown) => Promise<void>;
  handleExport: (format: 'csv' | 'json') => void;
  handleBulkDelete: () => Promise<void>;
  executeDelete: () => Promise<void>;
  inlineActionLoading: string | null;
  pendingDelete: { resource: K8sResource; path: string } | null;
  setPendingDelete: React.Dispatch<React.SetStateAction<{ resource: K8sResource; path: string } | null>>;
  singleDeleting: boolean;
  deleteProgress: DeleteProgressItem[];
  setDeleteProgress: React.Dispatch<React.SetStateAction<DeleteProgressItem[]>>;
  showBulkDeleteConfirm: boolean;
  setShowBulkDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  showExport: boolean;
  setShowExport: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useTableActions({
  apiPath,
  gvrKey: _gvrKey,
  sortedResources,
  stampedResources,
  visibleColumns,
  resourceKind,
  selectedRows,
  setSelectedRows,
}: {
  apiPath: string;
  gvrKey: string;
  sortedResources: K8sResource[];
  stampedResources: K8sResource[];
  visibleColumns: ColumnDef[];
  resourceKind: string;
  selectedRows: Set<string>;
  setSelectedRows: React.Dispatch<React.SetStateAction<Set<string>>>;
}): ActionHandlers {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [inlineActionLoading, setInlineActionLoading] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ resource: K8sResource; path: string } | null>(null);
  const [singleDeleting, setSingleDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgressItem[]>([]);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const handleAction = useCallback(async (action: string, payload?: unknown) => {
    const p = payload as { resource?: K8sResource; delta?: number } | undefined;
    const resource = p?.resource;
    if (!resource || inlineActionLoading) return;

    setInlineActionLoading(`${resource.metadata.uid}-${action}`);

    const resourceName = resource.metadata?.name || '';
    const resourcePath = buildApiPathFromResource(resource);

    try {
      if (action === 'restart') {
        await k8sDelete(resourcePath, clusterId, { uid: resource.metadata.uid });
        addToast({ type: 'success', title: `Pod "${resourceName}" restarted` });
      } else if (action === 'restart-rollout') {
        await k8sPatch(resourcePath, {
          spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } },
        }, undefined, clusterId);
        addToast({ type: 'success', title: `Rollout restart triggered for "${resourceName}"` });
      } else if (action === 'scale') {
        const delta = p?.delta ?? 0;
        const currentReplicas = (resource.spec as { replicas?: number })?.replicas ?? 0;
        const newReplicas = Math.max(0, currentReplicas + delta);
        await k8sPatch(resourcePath, { spec: { replicas: newReplicas } }, undefined, clusterId);
        addToast({ type: 'success', title: `Scaled "${resourceName}" to ${newReplicas} replicas` });
      } else if (action === 'scale-to') {
        const replicas = ((p as { replicas?: number } | undefined)?.replicas) ?? 0;
        await k8sPatch(resourcePath, { spec: { replicas } }, undefined, clusterId);
        addToast({ type: 'success', title: `Scaled "${resourceName}" to ${replicas} replicas` });
      } else if (action === 'cordon') {
        await k8sPatch(resourcePath, { spec: { unschedulable: true } }, undefined, clusterId);
        addToast({ type: 'success', title: `Node "${resourceName}" cordoned` });
      } else if (action === 'uncordon') {
        await k8sPatch(resourcePath, { spec: { unschedulable: false } }, undefined, clusterId);
        addToast({ type: 'success', title: `Node "${resourceName}" uncordoned` });
      } else if (action === 'drain') {
        await k8sPatch(resourcePath, { spec: { unschedulable: true } }, undefined, clusterId);
        addToast({ type: 'warning', title: `Drain started for "${resourceName}"`, detail: 'Node cordoned. Pod eviction requires manual intervention.' });
      } else if (action === 'delete-single') {
        setPendingDelete({ resource, path: resourcePath });
        setInlineActionLoading(null);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', apiPath] });
    } catch (err) {
      showErrorToast(err, `Action "${action}" failed`);
    } finally {
      setInlineActionLoading(null);
    }
  }, [inlineActionLoading, apiPath, queryClient, addToast, clusterId]);

  const handleExport = useCallback((format: 'csv' | 'json') => {
    const data = sortedResources.map((r) => {
      const row: Record<string, string> = {};
      for (const col of visibleColumns) {
        row[col.header] = String(col.accessorFn(r) ?? '');
      }
      return row;
    });

    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === 'csv') {
      const headers = visibleColumns.map((c) => c.header);
      const rows = data.map((row) => headers.map((h) => `"${(row[h] || '').replace(/"/g, '""')}"`).join(','));
      content = [headers.join(','), ...rows].join('\n');
      mimeType = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(sortedResources.map((r) => ({ apiVersion: r.apiVersion, kind: r.kind, metadata: r.metadata, spec: r.spec, status: r.status })), null, 2);
      mimeType = 'application/json';
      ext = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceKind.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: `Exported ${sortedResources.length} ${resourceKind.toLowerCase()} as ${ext.toUpperCase()}` });
  }, [sortedResources, visibleColumns, resourceKind, addToast]);

  const executeDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setSingleDeleting(true);
    try {
      await k8sDelete(pendingDelete.path, clusterId, { uid: pendingDelete.resource.metadata.uid, resourceVersion: pendingDelete.resource.metadata.resourceVersion });
      queryClient.setQueriesData({ queryKey: ['k8s', 'list'] }, (old: unknown) => {
        if (!old || !Array.isArray(old)) return old;
        return old.filter((r: K8sResource) => r.metadata?.uid !== pendingDelete.resource.metadata?.uid);
      });
      const kind = pendingDelete.resource.kind || '';
      const name = pendingDelete.resource.metadata?.name || '';
      const ns = pendingDelete.resource.metadata?.namespace || 'default';
      setPendingDelete(null);
      setDeleteProgress([{ name, ns, kind, status: 'done' }]);
      queryClient.invalidateQueries({ queryKey: ['k8s', 'list', apiPath] });
    } catch (err) {
      showErrorToast(err, 'Delete failed');
    } finally {
      setSingleDeleting(false);
    }
  }, [pendingDelete, queryClient, apiPath, clusterId]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedRows.size === 0) return;

    const items: Array<{ name: string; ns: string; kind: string; uid: string; path: string }> = [];
    for (const uid of selectedRows) {
      const resource = stampedResources.find((r) => r.metadata.uid === uid);
      if (!resource) continue;
      const kind = resource.kind || '';
      const path = buildApiPathFromResource(resource);
      items.push({ name: resource.metadata.name, ns: resource.metadata.namespace || 'default', kind, uid, path });
    }

    setDeleteProgress(items.map(i => ({ name: i.name, ns: i.ns, kind: i.kind, status: 'deleting' as const })));

    const results = await Promise.allSettled(
      items.map((item) => k8sDelete(item.path, clusterId, { uid: item.uid }))
    );
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        setDeleteProgress(prev => prev.map((p, i) => i === idx ? { ...p, status: 'done' as const } : p));
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        setDeleteProgress(prev => prev.map((p, i) => i === idx ? { ...p, status: 'error' as const, error: msg } : p));
      }
    });

    setSelectedRows(new Set());
    queryClient.setQueriesData({ queryKey: ['k8s', 'list'] }, (old: unknown) => {
      if (!old || !Array.isArray(old)) return old;
      const deletedUids = new Set(items.filter((_, index) => results[index].status === 'fulfilled').map(i => i.uid));
      return old.filter((r: K8sResource) => !deletedUids.has(r.metadata?.uid ?? ''));
    });
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list', apiPath] });
  }, [selectedRows, stampedResources, queryClient, apiPath, setSelectedRows, clusterId]);

  return {
    handleAction,
    handleExport,
    handleBulkDelete,
    executeDelete,
    inlineActionLoading,
    pendingDelete,
    setPendingDelete,
    singleDeleting,
    deleteProgress,
    setDeleteProgress,
    showBulkDeleteConfirm,
    setShowBulkDeleteConfirm,
    showExport,
    setShowExport,
  };
}
