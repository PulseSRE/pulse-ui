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

// ---- PKCS#10 parsing (just enough to read the subject and SANs) ----

interface Tlv { tag: number; start: number; len: number; end: number }

function readTlv(b: Uint8Array, pos: number): Tlv {
  const tag = b[pos];
  let len = b[pos + 1];
  let start = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('unsupported DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | b[start + i];
    start += n;
  }
  const end = start + len;
  if (end > b.length) throw new Error('truncated DER');
  return { tag, start, len, end };
}

function children(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = t.start; p < t.end;) { const c = readTlv(b, p); out.push(c); p = c.end; }
  return out;
}

const hex = (b: Uint8Array, t: Tlv) => Array.from(b.slice(t.start, t.end), (x) => x.toString(16).padStart(2, '0')).join('');
const text = (b: Uint8Array, t: Tlv) => new TextDecoder().decode(b.slice(t.start, t.end));

const OID_CN = '550403';
const OID_O = '55040a';
const OID_EXT_REQ = '2a864886f70d01090e';
const OID_SAN = '551d11';

export interface ParsedCsr {
  commonName: string;
  organizations: string[];
  dnsNames: string[];
  ipAddresses: string[];
  emailAddresses: string[];
}

function ipString(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 2) parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return parts.join(':');
}

/** Parse `spec.request` (base64 of a PEM CSR). Returns null when it cannot be read. */
export function parseCsrRequest(request: string | undefined): ParsedCsr | null {
  if (!request) return null;
  try {
    const pem = atob(request);
    const m = pem.match(/-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----([\s\S]*?)-----END (?:NEW )?CERTIFICATE REQUEST-----/);
    if (!m) return null;
    const der = Uint8Array.from(atob(m[1].replace(/\s/g, '')), (c) => c.charCodeAt(0));
    const top = readTlv(der, 0);
    const info = children(der, top)[0];
    const [, subject, , attrs] = children(der, info);
    const out: ParsedCsr = { commonName: '', organizations: [], dnsNames: [], ipAddresses: [], emailAddresses: [] };
    for (const rdn of children(der, subject)) {
      for (const atv of children(der, rdn)) {
        const [oid, value] = children(der, atv);
        const o = hex(der, oid);
        if (o === OID_CN) out.commonName = text(der, value);
        else if (o === OID_O) out.organizations.push(text(der, value));
      }
    }
    if (attrs && attrs.tag === 0xa0) {
      for (const attr of children(der, attrs)) {
        const [oid, set] = children(der, attr);
        if (hex(der, oid) !== OID_EXT_REQ) continue;
        for (const exts of children(der, set)) {
          for (const ext of children(der, exts)) {
            const parts = children(der, ext);
            if (hex(der, parts[0]) !== OID_SAN) continue;
            const octets = parts[parts.length - 1];
            const names = readTlv(der, octets.start);
            for (const gn of children(der, names)) {
              const bytes = der.slice(gn.start, gn.end);
              if (gn.tag === 0x82) out.dnsNames.push(new TextDecoder().decode(bytes));
              else if (gn.tag === 0x87) out.ipAddresses.push(ipString(bytes));
              else if (gn.tag === 0x81) out.emailAddresses.push(new TextDecoder().decode(bytes));
            }
          }
        }
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Usages a kubelet serving certificate may ask for; `server auth` is required. */
const KUBELET_SERVING_USAGES = new Set(['digital signature', 'key encipherment', 'server auth']);

/**
 * Why a CSR is not a well-formed kubelet serving request, or [] when it is.
 *
 * On OpenShift the machine-approver already approves well-formed kubelet
 * requests; the ones left pending are usually those it refused (often a SAN
 * that does not match the node). So "kubelet-serving" alone is not enough to
 * approve in bulk: the request itself must say it is from the node it claims.
 */
export function kubeletServingProblems(csr: CertificateSigningRequest): string[] {
  const problems: string[] = [];
  const user = csr.spec.username ?? '';
  if (csr.spec.signerName !== KUBELET_SERVING_SIGNER) problems.push(`signer is ${csr.spec.signerName}, not ${KUBELET_SERVING_SIGNER}`);
  if (!user.startsWith('system:node:')) problems.push(`requested by ${user || 'an unknown user'}, not a node (system:node:<name>)`);
  if (!(csr.spec.groups ?? []).includes('system:nodes')) problems.push('requester is not in the system:nodes group');
  const usages = csr.spec.usages ?? [];
  const extra = usages.filter((u) => !KUBELET_SERVING_USAGES.has(u));
  if (extra.length) problems.push(`asks for usages a kubelet serving certificate does not need: ${extra.join(', ')}`);
  if (!usages.includes('server auth')) problems.push('does not ask for server auth');
  const parsed = parseCsrRequest(csr.spec.request);
  if (!parsed) {
    problems.push('the certificate request could not be read');
  } else {
    if (parsed.commonName !== user) problems.push(`subject CN is "${parsed.commonName}", but the requester is ${user}`);
    if (!parsed.organizations.includes('system:nodes')) problems.push(`subject O is "${parsed.organizations.join(', ')}", not system:nodes`);
    if (parsed.dnsNames.length + parsed.ipAddresses.length === 0) problems.push('requests no DNS names or IP addresses');
  }
  return problems;
}

/** Safe to include in a bulk approval: a well-formed kubelet serving request (see kubeletServingProblems). */
export function isKubeletServing(csr: CertificateSigningRequest): boolean {
  return kubeletServingProblems(csr).length === 0;
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
