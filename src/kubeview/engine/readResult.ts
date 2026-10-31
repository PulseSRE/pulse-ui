import { k8sGet, k8sList } from './query';

/**
 * A read that keeps "could not read" apart from "not there".
 *
 * Helpers like `safeGet` turned every error into `null`, so a 403 on
 * kube-system/kubeadmin read as "kubeadmin removed" and an unreadable APIServer
 * fell back to a passing default. A 404 is an answer about the cluster; a 403,
 * 500 or network failure is not, and must surface as unknown.
 */
export type ReadResult<T> =
  | { state: 'ok'; data: T }
  | { state: 'absent' }
  | { state: 'error'; reason: string };

function statusOf(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null) {
    if ('statusCode' in e && typeof (e as { statusCode: unknown }).statusCode === 'number') return (e as { statusCode: number }).statusCode;
    if ('status' in e && typeof (e as { status: unknown }).status === 'number') return (e as { status: number }).status;
  }
  return undefined;
}

/** A short, user-facing reason for a failed read. */
export function errorReason(e: unknown): string {
  const status = statusOf(e);
  if (status === 403) return 'Permission denied (403)';
  if (status === 401) return 'Session expired (401)';
  if (status && status > 0) return `Request failed (${status})`;
  if (e instanceof Error && e.message) return e.message;
  return 'Request failed';
}

export function isNotFound(e: unknown): boolean {
  return statusOf(e) === 404;
}

export async function readK8s<T>(path: string, clusterId?: string): Promise<ReadResult<T>> {
  try {
    return { state: 'ok', data: await k8sGet<T>(path, clusterId) };
  } catch (e) {
    if (isNotFound(e)) return { state: 'absent' };
    return { state: 'error', reason: errorReason(e) };
  }
}

export async function listK8s<T>(path: string, clusterId?: string): Promise<ReadResult<T[]>> {
  try {
    return { state: 'ok', data: await k8sList<T>(path, undefined, clusterId) };
  } catch (e) {
    if (isNotFound(e)) return { state: 'absent' };
    return { state: 'error', reason: errorReason(e) };
  }
}
