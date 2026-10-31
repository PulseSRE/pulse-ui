/**
 * CertificateSigningRequests (certificates.k8s.io/v1).
 *
 * New nodes and kubelet serving-certificate rotations stop at a Pending CSR
 * until someone approves it; until then `oc logs`/`oc exec` to that node
 * fail and a new node never joins. Approval is a write to the `approval`
 * subresource: the CSR with an `Approved` (or `Denied`) condition added.
 */
import type { K8sResource } from './renderers';
import { k8sFetch } from './query';
import { parseK8sErrorResponse } from './errors';

export const CSR_LIST_PATH = '/apis/certificates.k8s.io/v1/certificatesigningrequests';
export const KUBELET_SERVING_SIGNER = 'kubernetes.io/kubelet-serving';

export interface CSRCondition {
  type: 'Approved' | 'Denied' | 'Failed' | string;
  status: string;
  reason?: string;
  message?: string;
  lastUpdateTime?: string;
}

export interface CertificateSigningRequest extends K8sResource {
  spec: {
    request?: string;
    signerName: string;
    usages?: string[];
    username?: string;
    groups?: string[];
    expirationSeconds?: number;
  };
  status?: {
    conditions?: CSRCondition[];
    certificate?: string;
  };
}

export type CSRStatus = 'Pending' | 'Approved' | 'Issued' | 'Denied' | 'Failed';

export function csrStatus(csr: CertificateSigningRequest): CSRStatus {
  const conds = csr.status?.conditions ?? [];
  const has = (t: string) => conds.some((c) => c.type === t && c.status !== 'False');
  if (has('Denied')) return 'Denied';
  if (has('Failed')) return 'Failed';
  if (has('Approved')) return csr.status?.certificate ? 'Issued' : 'Approved';
  return 'Pending';
}

export function isPending(csr: CertificateSigningRequest): boolean {
  return csrStatus(csr) === 'Pending';
}

/**
 * A kubelet serving-certificate request from a node: signer
 * kubernetes.io/kubelet-serving, requested by `system:node:<name>` in the
 * `system:nodes` group. These are the ones safe to approve in bulk after a
 * node joins; anything else is approved one at a time.
 */
export function isKubeletServing(csr: CertificateSigningRequest): boolean {
  return csr.spec.signerName === KUBELET_SERVING_SIGNER
    && (csr.spec.username ?? '').startsWith('system:node:')
    && (csr.spec.groups ?? []).includes('system:nodes');
}

/** The CSR body to PUT to `/approval`: the object with one condition added. */
export function approvalBody(csr: CertificateSigningRequest, decision: 'Approved' | 'Denied'): CertificateSigningRequest {
  const condition: CSRCondition = {
    type: decision,
    status: 'True',
    reason: decision === 'Approved' ? 'ApprovedByPulse' : 'DeniedByPulse',
    message: decision === 'Approved' ? 'Approved in OpenShift Pulse' : 'Denied in OpenShift Pulse',
    lastUpdateTime: new Date().toISOString(),
  };
  return {
    apiVersion: 'certificates.k8s.io/v1',
    kind: 'CertificateSigningRequest',
    metadata: csr.metadata,
    spec: csr.spec,
    status: { ...(csr.status ?? {}), conditions: [...(csr.status?.conditions ?? []), condition] },
  };
}

export function approvalPath(name: string): string {
  return `${CSR_LIST_PATH}/${encodeURIComponent(name)}/approval`;
}

/** PUT the decision. The body carries resourceVersion, so a CSR changed since it was read is refused (409). */
export async function decideCsr(clusterId: string, csr: CertificateSigningRequest, decision: 'Approved' | 'Denied'): Promise<void> {
  const res = await k8sFetch(clusterId, approvalPath(csr.metadata.name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(approvalBody(csr, decision)),
  });
  if (!res.ok) throw await parseK8sErrorResponse(res, { operation: decision === 'Approved' ? 'approve' : 'deny', apiPath: approvalPath(csr.metadata.name), resourceKind: 'CertificateSigningRequest', resourceName: csr.metadata.name });
}
