/**
 * What "Debug" creates, in one place, so the confirmation can say exactly
 * what will run and the request sends exactly that.
 *
 * Node debug: a privileged pod sharing the host's PID and network namespaces
 * with the host filesystem mounted at /host (what `oc debug node/<name>`
 * does). It used to be created without asking, and the toast said it
 * "auto-deletes in 1 hour": it only stopped (its `sleep 3600` ended) and the
 * pod object stayed. Now it carries `activeDeadlineSeconds`, so the kubelet
 * stops it after the hour whatever the command does, and the terminal's
 * "End session" deletes it.
 *
 * Pod debug: an ephemeral container added to a running pod. Its image is
 * shown, and editable, in the confirmation, since a disconnected cluster
 * cannot pull from Docker Hub.
 */
import type { Pod } from './types';

export const NODE_DEBUG_NAMESPACE = 'default';
export const NODE_DEBUG_IMAGE = 'registry.redhat.io/rhel9/support-tools:latest';
export const NODE_DEBUG_DEADLINE_SECONDS = 3600;
export const NODE_DEBUG_LABEL = 'openshiftpulse/debug';
export const NODE_DEBUG_NODE_LABEL = 'openshiftpulse/debug-node';

export const POD_DEBUG_IMAGE = 'busybox:latest';

export function nodeDebugPodName(node: string, now = Date.now()): string {
  return `debug-${node.slice(0, 20)}-${now.toString(36).slice(-4)}`.replace(/[^a-z0-9-]/g, '-').replace(/-+$/, '');
}

export function buildNodeDebugPod(node: string, name: string) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      namespace: NODE_DEBUG_NAMESPACE,
      labels: { [NODE_DEBUG_LABEL]: 'true', [NODE_DEBUG_NODE_LABEL]: node },
    },
    spec: {
      nodeName: node,
      hostPID: true,
      hostNetwork: true,
      restartPolicy: 'Never',
      // The kubelet stops the pod after this, whatever the command does.
      activeDeadlineSeconds: NODE_DEBUG_DEADLINE_SECONDS,
      containers: [{
        name: 'debug',
        image: NODE_DEBUG_IMAGE,
        command: ['sleep', String(NODE_DEBUG_DEADLINE_SECONDS)],
        securityContext: { privileged: true },
        volumeMounts: [{ name: 'host', mountPath: '/host' }],
      }],
      volumes: [{ name: 'host', hostPath: { path: '/' } }],
    },
  };
}

export const nodeDebugPodPath = (name: string) => `/api/v1/namespaces/${NODE_DEBUG_NAMESPACE}/pods/${encodeURIComponent(name)}`;

/** Strategic-merge patch for the pod's ephemeralcontainers subresource. */
export function buildEphemeralDebugPatch(pod: Pod, containerName: string, image: string, targetContainerName: string | undefined) {
  const existing = (pod.spec as Pod['spec'] & { ephemeralContainers?: unknown[] })?.ephemeralContainers || [];
  return {
    spec: {
      ephemeralContainers: [
        ...existing,
        {
          name: containerName,
          image,
          command: ['sh'],
          stdin: true,
          tty: true,
          targetContainerName,
        },
      ],
    },
  };
}

/** Why an image reference can't be used, or null. */
export function validateImageRef(image: string): string | null {
  const v = image.trim();
  if (!v) return 'Enter an image.';
  if (/\s/.test(v)) return 'An image reference has no spaces.';
  return null;
}
