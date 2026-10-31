/**
 * Dependency Graph Engine
 *
 * Builds a graph of K8s resource relationships:
 * - ownerReferences (upward: Pod→RS→Deployment)
 * - Service selectors (Service→Pods)
 * - Ingress/Route → Service
 * - HPA → Deployment/StatefulSet
 * - PDB → Pods
 * - NetworkPolicy → Pods
 * - Pod volumes → ConfigMap, Secret
 * - Pod envFrom → ConfigMap, Secret
 */

import { k8sFetch } from '../kubeview/engine/query';

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  status?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relationship: string;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
}

function nodeId(kind: string, namespace: string, name: string): string {
  return `${kind}:${namespace}/${name}`;
}

/** Read from the cluster the graph is for, as the (possibly impersonated) user. */
async function fetchJson<T>(clusterId: string, path: string): Promise<T | null> {
  try {
    const res = await k8sFetch(clusterId, path);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

interface K8sListOf<T> { items: T[] }
interface K8sObj {
  metadata: {
    name: string;
    namespace?: string;
    ownerReferences?: { kind: string; name: string }[];
    labels?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

export async function buildDependencyGraph(
  kind: string,
  name: string,
  namespace: string,
  clusterId: string,
): Promise<DependencyGraph> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const rootId = nodeId(kind, namespace, name);

  function addNode(k: string, ns: string, n: string, status?: string) {
    const id = nodeId(k, ns, n);
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind: k, name: n, namespace: ns, status });
    }
  }

  function addEdge(from: string, to: string, rel: string) {
    if (!edges.some((e) => e.from === from && e.to === to && e.relationship === rel)) {
      edges.push({ from, to, relationship: rel });
    }
  }

  addNode(kind, namespace, name);

  // Fetch pods in namespace
  const podsData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`);
  const pods = podsData?.items ?? [];

  // Fetch services
  const svcsData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/api/v1/namespaces/${encodeURIComponent(namespace)}/services`);
  const svcs = svcsData?.items ?? [];

  // Fetch ingresses
  const ingData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/ingresses`);
  const ingresses = ingData?.items ?? [];

  // Fetch routes
  const routeData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/route.openshift.io/v1/namespaces/${encodeURIComponent(namespace)}/routes`);
  const routes = routeData?.items ?? [];

  // Fetch HPAs
  const hpaData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/autoscaling/v2/namespaces/${encodeURIComponent(namespace)}/horizontalpodautoscalers`);
  const hpas = hpaData?.items ?? [];

  // Fetch ReplicaSets
  const rsData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/replicasets`);
  const replicaSets = rsData?.items ?? [];

  // Fetch Deployments
  const deployData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`);
  const deploys = deployData?.items ?? [];

  // Fetch ConfigMaps and Secrets names (for linking)
  const cmData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps`);
  const configMaps = new Set((cmData?.items ?? []).map((cm) => cm.metadata.name));

  const secData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`);
  const secrets = new Set((secData?.items ?? []).map((s) => s.metadata.name));

  // Fetch PDBs
  const pdbData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/policy/v1/namespaces/${encodeURIComponent(namespace)}/poddisruptionbudgets`);
  const pdbs = pdbData?.items ?? [];

  // Fetch NetworkPolicies
  const npData = await fetchJson<K8sListOf<K8sObj>>(clusterId, `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/networkpolicies`);
  const netpols = npData?.items ?? [];

  // --- Walk ownerReferences for all pods ---
  for (const pod of pods) {
    const podName = pod.metadata.name;
    const owners = pod.metadata.ownerReferences ?? [];
    const podPhase = String((pod.status as Record<string, unknown>)?.['phase'] ?? 'Unknown');

    for (const owner of owners) {
      const ownerId = nodeId(owner.kind, namespace, owner.name);
      addNode(owner.kind, namespace, owner.name);
      addNode('Pod', namespace, podName, podPhase);
      addEdge(ownerId, nodeId('Pod', namespace, podName), 'owns');

      // Walk RS → Deployment
      if (owner.kind === 'ReplicaSet') {
        const rs = replicaSets.find((r) => r.metadata.name === owner.name);
        if (rs) {
          for (const rsOwner of rs.metadata.ownerReferences ?? []) {
            addNode(rsOwner.kind, namespace, rsOwner.name);
            addEdge(nodeId(rsOwner.kind, namespace, rsOwner.name), ownerId, 'owns');
          }
        }
      }
    }
  }

  // --- Service → Pods via selector ---
  for (const svc of svcs) {
    const svcName = svc.metadata.name;
    const selector = (svc.spec?.['selector'] ?? {}) as Record<string, string>;
    if (Object.keys(selector).length === 0) continue;

    for (const pod of pods) {
      const podLabels = pod.metadata.labels ?? {};
      const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
      if (matches) {
        addNode('Service', namespace, svcName, String(svc.spec?.['type'] ?? 'ClusterIP'));
        addNode('Pod', namespace, pod.metadata.name, String((pod.status as Record<string, unknown>)?.['phase'] ?? ''));
        addEdge(nodeId('Service', namespace, svcName), nodeId('Pod', namespace, pod.metadata.name), 'selects');
      }
    }
  }

  // --- Ingress → Service ---
  for (const ing of ingresses) {
    const rules = ((ing.spec?.['rules'] ?? []) as Record<string, unknown>[]);
    for (const rule of rules) {
      const paths = ((rule['http'] as Record<string, unknown>)?.['paths'] ?? []) as Record<string, unknown>[];
      for (const p of paths) {
        const backend = (p['backend'] as Record<string, unknown>)?.['service'] as Record<string, unknown> | undefined;
        const svcName = String(backend?.['name'] ?? '');
        if (svcName && svcs.some((s) => s.metadata.name === svcName)) {
          addNode('Ingress', namespace, ing.metadata.name, String(rule['host'] ?? ''));
          addEdge(nodeId('Ingress', namespace, ing.metadata.name), nodeId('Service', namespace, svcName), 'routes to');
        }
      }
    }
  }

  // --- Route → Service ---
  for (const route of routes) {
    const toSvc = String((route.spec?.['to'] as Record<string, unknown>)?.['name'] ?? '');
    if (toSvc && svcs.some((s) => s.metadata.name === toSvc)) {
      addNode('Route', namespace, route.metadata.name);
      addEdge(nodeId('Route', namespace, route.metadata.name), nodeId('Service', namespace, toSvc), 'routes to');
    }
  }

  // --- HPA → target ---
  for (const hpa of hpas) {
    const ref = hpa.spec?.['scaleTargetRef'] as Record<string, unknown> | undefined;
    if (!ref) continue;
    const targetKind = String(ref['kind'] ?? '');
    const targetName = String(ref['name'] ?? '');
    if (targetKind && targetName) {
      addNode('HPA', namespace, hpa.metadata.name);
      addNode(targetKind, namespace, targetName);
      addEdge(nodeId('HPA', namespace, hpa.metadata.name), nodeId(targetKind, namespace, targetName), 'scales');
    }
  }

  // --- PDB → Pods via selector ---
  for (const pdb of pdbs) {
    const selector = ((pdb.spec?.['selector'] as Record<string, unknown>)?.['matchLabels'] ?? {}) as Record<string, string>;
    if (Object.keys(selector).length === 0) continue;
    for (const pod of pods) {
      const podLabels = pod.metadata.labels ?? {};
      if (Object.entries(selector).every(([k, v]) => podLabels[k] === v)) {
        addNode('PDB', namespace, pdb.metadata.name);
        addEdge(nodeId('PDB', namespace, pdb.metadata.name), nodeId('Pod', namespace, pod.metadata.name), 'protects');
      }
    }
  }

  // --- NetworkPolicy → Pods ---
  for (const np of netpols) {
    const selector = ((np.spec?.['podSelector'] as Record<string, unknown>)?.['matchLabels'] ?? {}) as Record<string, string>;
    for (const pod of pods) {
      const podLabels = pod.metadata.labels ?? {};
      if (Object.entries(selector).every(([k, v]) => podLabels[k] === v)) {
        addNode('NetworkPolicy', namespace, np.metadata.name);
        addEdge(nodeId('NetworkPolicy', namespace, np.metadata.name), nodeId('Pod', namespace, pod.metadata.name), 'applies to');
      }
    }
  }

  // --- Pod → ConfigMap/Secret via volumes and envFrom ---
  for (const pod of pods) {
    const podId = nodeId('Pod', namespace, pod.metadata.name);
    if (!nodes.has(podId)) continue;

    const podSpec = (pod.spec ?? {}) as Record<string, unknown>;
    const volumes = (podSpec['volumes'] ?? []) as Record<string, unknown>[];
    const containers = (podSpec['containers'] ?? []) as Record<string, unknown>[];

    for (const vol of volumes) {
      const cmRef = vol['configMap'] as Record<string, unknown> | undefined;
      if (cmRef) {
        const cmName = String(cmRef['name'] ?? '');
        if (cmName && configMaps.has(cmName)) {
          addNode('ConfigMap', namespace, cmName);
          addEdge(podId, nodeId('ConfigMap', namespace, cmName), 'mounts');
        }
      }
      const secRef = vol['secret'] as Record<string, unknown> | undefined;
      if (secRef) {
        const secName = String(secRef['secretName'] ?? '');
        if (secName && secrets.has(secName)) {
          addNode('Secret', namespace, secName);
          addEdge(podId, nodeId('Secret', namespace, secName), 'mounts');
        }
      }
    }

    for (const container of containers) {
      const envFrom = (container['envFrom'] ?? []) as Record<string, unknown>[];
      for (const ef of envFrom) {
        const cmRef = ef['configMapRef'] as Record<string, unknown> | undefined;
        if (cmRef) {
          const cmName = String(cmRef['name'] ?? '');
          if (cmName && configMaps.has(cmName)) {
            addNode('ConfigMap', namespace, cmName);
            addEdge(podId, nodeId('ConfigMap', namespace, cmName), 'envFrom');
          }
        }
        const secRef = ef['secretRef'] as Record<string, unknown> | undefined;
        if (secRef) {
          const secName = String(secRef['name'] ?? '');
          if (secName && secrets.has(secName)) {
            addNode('Secret', namespace, secName);
            addEdge(podId, nodeId('Secret', namespace, secName), 'envFrom');
          }
        }
      }
    }
  }

  // For Deployments: also link directly if root is a Deployment
  if (kind === 'Deployment') {
    const dep = deploys.find((d) => d.metadata.name === name);
    if (dep) {
      // Find matching services
      const depLabels = ((dep.spec?.['selector'] as Record<string, unknown>)?.['matchLabels'] ?? {}) as Record<string, string>;
      for (const svc of svcs) {
        const svcSelector = (svc.spec?.['selector'] ?? {}) as Record<string, string>;
        if (Object.keys(svcSelector).length > 0 && Object.entries(svcSelector).every(([k, v]) => depLabels[k] === v)) {
          addNode('Service', namespace, svc.metadata.name, String(svc.spec?.['type'] ?? ''));
          addEdge(nodeId('Service', namespace, svc.metadata.name), rootId, 'targets');
        }
      }
    }
  }

  // Filter: only keep nodes that are connected to the root via edges
  const connected = new Set<string>();
  connected.add(rootId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (connected.has(edge.from) && !connected.has(edge.to)) {
        connected.add(edge.to);
        changed = true;
      }
      if (connected.has(edge.to) && !connected.has(edge.from)) {
        connected.add(edge.from);
        changed = true;
      }
    }
  }

  const filteredNodes = Array.from(nodes.values()).filter((n) => connected.has(n.id));
  const filteredEdges = edges.filter((e) => connected.has(e.from) && connected.has(e.to));

  return { nodes: filteredNodes, edges: filteredEdges, rootId };
}
