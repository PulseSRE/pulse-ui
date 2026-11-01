/**
 * One definition of "who has cluster-admin" and "too many", used by Security
 * and Identity. They used to disagree: Security counted non-system subjects
 * of any kind (> 3), the Identity banner counted every subject including
 * system ones (> 5), and the Identity audit counted only Users (> 2).
 */
import type { ClusterRoleBinding } from './types';

/** More non-system cluster-admin subjects than this is flagged. */
export const CLUSTER_ADMIN_LIMIT = 3;

export interface ClusterAdminSubject {
  kind: string;
  name: string;
  namespace?: string;
  /** The ClusterRoleBinding that grants it. */
  binding: string;
}

/** Bindings created and reconciled by the platform; people do not manage these. */
export function isSystemBinding(name: string): boolean {
  return name.startsWith('system:') || name.startsWith('openshift-');
}

export function isSystemSubject(s: { kind: string; name: string; namespace?: string }): boolean {
  if (s.name?.startsWith('system:')) return true;
  if (s.kind === 'ServiceAccount' && (s.namespace?.startsWith('openshift-') || s.namespace?.startsWith('kube-'))) return true;
  return false;
}

/** Every non-system subject bound to the cluster-admin ClusterRole by a non-system ClusterRoleBinding. */
export function clusterAdminSubjects(crbs: ClusterRoleBinding[]): ClusterAdminSubject[] {
  const out: ClusterAdminSubject[] = [];
  for (const b of crbs) {
    if (b.roleRef?.name !== 'cluster-admin' || (b.roleRef?.kind && b.roleRef.kind !== 'ClusterRole')) continue;
    const binding = b.metadata?.name || '';
    if (isSystemBinding(binding)) continue;
    for (const s of b.subjects || []) {
      if (isSystemSubject(s)) continue;
      out.push({ kind: s.kind, name: s.name, namespace: s.namespace, binding });
    }
  }
  return out;
}

export function tooManyClusterAdmins(subjects: ClusterAdminSubject[]): boolean {
  return subjects.length > CLUSTER_ADMIN_LIMIT;
}
