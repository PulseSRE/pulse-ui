/**
 * Where an ownerReference points: its API path and its page, from the owner's
 * own apiVersion and kind (discovery first, then well-known kinds), with the
 * owner's scope deciding whether the namespace is part of either. A static
 * pod's owner is its Node, which is cluster-scoped; a VirtualMachineInstance
 * or TaskRun owner keeps its own group and version.
 */
import { resolveKind, gvrSegment } from './kindRegistry';

export interface OwnerLink {
  kind: string;
  name: string;
  apiPath: string;
  /** UI path of the owner's detail page. */
  path: string;
  namespaced: boolean;
}

export function ownerLink(ref: { apiVersion?: string; kind: string; name: string }, namespace: string): OwnerLink {
  const r = resolveKind(ref.kind, ref.apiVersion);
  const namespaced = r.namespaced ?? true;
  const base = r.group ? `/apis/${r.group}/${r.version}` : `/api/${r.version}`;
  const gvr = gvrSegment(r);
  const scope = namespaced && namespace ? namespace : '_';
  return {
    kind: ref.kind,
    name: ref.name,
    namespaced,
    apiPath: namespaced && namespace ? `${base}/namespaces/${namespace}/${r.plural}/${ref.name}` : `${base}/${r.plural}/${ref.name}`,
    path: `/r/${gvr}/${scope}/${ref.name}`,
  };
}
