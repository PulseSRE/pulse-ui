/**
 * Closing a node debug terminal. The debug pod is privileged, so closing the
 * terminal asks "Delete the debug pod now?" (Delete, the default, or Keep
 * running). "End session" deletes it without asking. Ordinary pod terminals
 * close straight away.
 */
import React, { useState } from 'react';
import { k8sDelete } from '../engine/query';
import { showErrorToast } from '../engine/errorToast';
import { useUIStore } from '../store/uiStore';
import { NODE_DEBUG_NAMESPACE, NODE_DEBUG_DEADLINE_SECONDS, nodeDebugPodPath } from '../engine/debugPods';
import { ConfirmDialog } from './feedback/ConfirmDialog';

export interface NodeDebugTarget {
  namespace: string;
  podName: string;
  clusterId?: string;
  isNode?: boolean;
}

export function isNodeDebugTerminal(t: NodeDebugTarget | null | undefined): boolean {
  return !!t?.isNode && t.namespace === NODE_DEBUG_NAMESPACE;
}

export function useNodeDebugClose(target: NodeDebugTarget | null | undefined, onClose: () => void): {
  /** Close: asks first for a node debug terminal, else closes. */
  requestClose: () => void;
  /** Delete the debug pod and close, without asking. */
  endSession: () => Promise<void>;
  ending: boolean;
  prompt: React.ReactNode;
} {
  const [asking, setAsking] = useState(false);
  const [ending, setEnding] = useState(false);
  const isDebug = isNodeDebugTerminal(target);

  const endSession = async () => {
    if (!target) return;
    setEnding(true);
    try {
      await k8sDelete(nodeDebugPodPath(target.podName), target.clusterId);
      useUIStore.getState().addToast({ type: 'success', title: `Debug pod "${target.podName}" deleted` });
      setAsking(false);
      onClose();
    } catch (err) {
      showErrorToast(err, 'Could not delete the debug pod');
    } finally {
      setEnding(false);
    }
  };

  const keepRunning = () => {
    if (ending) return;
    setAsking(false);
    useUIStore.getState().addToast({
      type: 'warning',
      title: `Debug pod "${target?.podName}" is still running`,
      detail: `It stops on its own within ${NODE_DEBUG_DEADLINE_SECONDS / 60} minutes of being created. Terminal on the node page reattaches to it.`,
    });
    onClose();
  };

  const requestClose = () => {
    if (isDebug) setAsking(true);
    else onClose();
  };

  const prompt = isDebug && asking ? (
    <ConfirmDialog
      open
      title="Delete the debug pod now?"
      description={`"${target!.podName}" is a privileged pod with the node's filesystem mounted. Delete it now, or keep it running for this terminal to reattach to later.`}
      confirmLabel="Delete"
      cancelLabel="Keep running"
      // Warning, not danger: the confirm button (Delete) gets focus, so Enter deletes.
      variant="warning"
      loading={ending}
      onConfirm={() => { void endSession(); }}
      onClose={keepRunning}
    />
  ) : null;

  return { requestClose, endSession, ending, prompt };
}
