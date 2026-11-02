/**
 * The workload a pod belongs to, and which revision of it the pod runs.
 *
 * A Deployment's pod is owned by a ReplicaSet; the Deployment and the revision
 * number are on that ReplicaSet, so it is read. A failed read keeps the
 * ReplicaSet as the owner and says the revision could not be read, rather
 * than guessing the Deployment from the name.
 */
import { useQuery } from '@tanstack/react-query';
import { readK8s } from '../../engine/readResult';
import type { K8sResource } from '../../engine/renderers';
import { useFleetStore } from '../../store/fleetStore';
import { ownerLink } from '../../engine/ownerRef';

export interface PodOwner {
  kind: string;
  name: string;
  /** API path of the owner object (for reads and fixes). */
  apiPath: string;
  /** UI path of its detail page. */
  path: string;
  /** Revision the pod runs: Deployment revision number, or the controller-revision hash. */
  revision?: string;
  /** Why the revision is not known, when it is not. */
  revisionUnknown?: string;
  /** The ReplicaSet in between, for a Deployment. */
  replicaSet?: string;
}

/** Owner paths for a kind with the default apiVersion (apps/batch/core). */
export function ownerPaths(kind: string, namespace: string, name: string): { apiPath: string; path: string } {
  const { apiPath, path } = ownerLink({ kind, name }, namespace);
  return { apiPath, path };
}

export function usePodOwner(pod: K8sResource): { owner: PodOwner | null; isLoading: boolean } {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const ns = pod.metadata.namespace || '';
  const ref = (pod.metadata.ownerReferences || []).find((o) => o.controller) ?? pod.metadata.ownerReferences?.[0];
  const isRS = ref?.kind === 'ReplicaSet';
  const rsPath = isRS && ref ? `/apis/apps/v1/namespaces/${ns}/replicasets/${ref.name}` : '';
  const rs = useQuery({
    queryKey: ['pod-owner', clusterId, rsPath],
    queryFn: () => readK8s<K8sResource>(rsPath, clusterId),
    enabled: !!rsPath,
    staleTime: 30_000,
  });

  if (!ref || !ns) return { owner: null, isLoading: false };

  if (!isRS) {
    const hash = pod.metadata.labels?.['controller-revision-hash'];
    const { apiPath, path } = ownerLink(ref, ns);
    return { owner: { kind: ref.kind, name: ref.name, apiPath, path, revision: hash }, isLoading: false };
  }

  if (rs.isLoading || !rs.data) {
    return { owner: { kind: 'ReplicaSet', name: ref.name, ...ownerPaths('ReplicaSet', ns, ref.name) }, isLoading: rs.isLoading };
  }
  const r = rs.data;
  if (r.state !== 'ok') {
    return {
      owner: {
        kind: 'ReplicaSet', name: ref.name, ...ownerPaths('ReplicaSet', ns, ref.name),
        revisionUnknown: r.state === 'absent' ? 'its ReplicaSet no longer exists' : r.reason,
      },
      isLoading: false,
    };
  }
  const deploy = (r.data.metadata.ownerReferences || []).find((o) => o.kind === 'Deployment');
  const revision = r.data.metadata.annotations?.['deployment.kubernetes.io/revision'];
  if (!deploy) {
    return { owner: { kind: 'ReplicaSet', name: ref.name, ...ownerPaths('ReplicaSet', ns, ref.name), revision }, isLoading: false };
  }
  return {
    owner: { kind: 'Deployment', name: deploy.name, ...ownerPaths('Deployment', ns, deploy.name), revision, replicaSet: ref.name },
    isLoading: false,
  };
}
