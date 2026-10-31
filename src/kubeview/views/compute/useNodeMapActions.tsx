/**
 * The node and pod actions behind NodeHexMap's menus. Every menu item used to
 * be `() => {}`; these do what the labels say, against the cluster on screen,
 * and only appear when the user's RBAC allows them.
 */
import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';
import { useCanI } from '../../hooks/useCanI';
import { useNavigateTab } from '../../hooks/useNavigateTab';
import { k8sDelete } from '../../engine/query';
import { showErrorToast } from '../../engine/errorToast';
import { setNodeSchedulable, openNodeTerminal, openPodTerminal } from '../../engine/nodeActions';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { DrainNodeDialog } from '../../components/DrainNodeDialog';

export interface PodRef {
  namespace: string;
  name: string;
  uid?: string;
}

export interface NodeMapActions {
  canUpdateNodes: boolean;
  canDeletePods: boolean;
  setCordoned: (node: string, cordoned: boolean) => void;
  drain: (node: string) => void;
  openTerminal: (node: string) => void;
  viewLogs: (pod: PodRef) => void;
  exec: (pod: PodRef) => void;
  deletePod: (pod: PodRef) => void;
}

export function useNodeMapActions(): { actions: NodeMapActions; dialogs: React.ReactNode } {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();
  const queryClient = useQueryClient();
  const { allowed: canUpdateNodes } = useCanI('update', '', 'nodes');
  const { allowed: canDeletePods } = useCanI('delete', '', 'pods');
  const [drainNodeName, setDrainNodeName] = useState<string | null>(null);
  const [podToDelete, setPodToDelete] = useState<PodRef | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['k8s', 'list'] });
  }, [queryClient]);

  const setCordoned = useCallback((node: string, cordoned: boolean) => {
    setNodeSchedulable(node, !cordoned, clusterId)
      .then(() => {
        addToast({ type: 'success', title: `Node "${node}" ${cordoned ? 'cordoned' : 'uncordoned'}` });
        refresh();
      })
      .catch((err) => showErrorToast(err, `${cordoned ? 'Cordon' : 'Uncordon'} failed`));
  }, [clusterId, addToast, refresh]);

  const actions: NodeMapActions = {
    canUpdateNodes,
    canDeletePods,
    setCordoned,
    drain: setDrainNodeName,
    openTerminal: (node) => {
      openNodeTerminal(node, clusterId).catch((err) => showErrorToast(err, 'Could not look for a debug pod'));
    },
    viewLogs: (pod) => go(`/logs/${pod.namespace}/${pod.name}`, `${pod.name} (Logs)`),
    exec: (pod) => {
      openPodTerminal(pod.namespace, pod.name, clusterId).catch((err) => showErrorToast(err, 'Could not open a terminal'));
    },
    deletePod: setPodToDelete,
  };

  const executeDelete = async () => {
    if (!podToDelete) return;
    setDeleting(true);
    try {
      await k8sDelete(
        `/api/v1/namespaces/${podToDelete.namespace}/pods/${podToDelete.name}`,
        clusterId,
        podToDelete.uid ? { uid: podToDelete.uid } : undefined,
      );
      addToast({ type: 'success', title: `Pod "${podToDelete.name}" deleted`, detail: 'Its controller will create a replacement if it has one.' });
      setPodToDelete(null);
      refresh();
    } catch (err) {
      showErrorToast(err, 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const dialogs = (
    <>
      {drainNodeName && (
        <DrainNodeDialog
          node={drainNodeName}
          clusterId={clusterId}
          onClose={() => setDrainNodeName(null)}
          onDone={refresh}
        />
      )}
      <ConfirmDialog
        open={!!podToDelete}
        title="Delete pod"
        description={podToDelete ? `Delete "${podToDelete.name}" from ${podToDelete.namespace}? A pod no controller owns is gone for good.` : ''}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={executeDelete}
        onClose={() => setPodToDelete(null)}
      />
    </>
  );

  return { actions, dialogs };
}
