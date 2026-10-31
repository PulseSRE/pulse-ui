/**
 * Read a certificate's real notAfter out of a Kubernetes TLS secret.
 *
 * The report used to estimate expiry as `creationTimestamp + 365 days` when a
 * secret carried no cert-manager or service-ca annotation, which is most of
 * them. That is not a measurement, it is the Secret's age with a guess bolted
 * on, and it is wrong in the specific way that matters: cluster certificates
 * are rotated **in place**, so the Secret keeps its original creationTimestamp
 * while tls.crt is replaced.
 *
 * On a 424-day-old cluster every such secret reported ~-60 days — 424 minus
 * 365 — so 61 certificates were listed as two months expired while openssl put
 * them months or years into the future (etcd-client: 2028). Those 61 then fed
 * an uncapped risk factor at 15 points each, pinning the cluster risk score at
 * 100/100 "Critical" on a cluster with zero critical alerts, zero unhealthy
 * nodes and zero degraded operators.
 *
 * The certificate is right there in `data["tls.crt"]`. Parse it.
 *
 * This reads only the validity field, which needs a handful of ASN.1 tags
 * rather than a full X.509 implementation — deliberately, to avoid adding a
 * crypto dependency for one date. If the structure is not what we expect we
 * return null and the caller reports "unknown", which is honest. Guessing is
 * what produced the bug.
 */

interface Tlv {
  tag: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

/** Read one ASN.1 tag-length-value header at `offset`. */
function readTlv(bytes: Uint8Array, offset: number): Tlv | null {
  if (offset + 2 > bytes.length) return null;
  const tag = bytes[offset];
  let pos = offset + 1;
  let length = bytes[pos++];

  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    // 0x80 is indefinite-length, which DER forbids; >4 would overflow a
    // 32-bit length and cannot occur in a certificate we would be shown.
    if (lengthBytes === 0 || lengthBytes > 4 || pos + lengthBytes > bytes.length) return null;
    length = 0;
    for (let i = 0; i < lengthBytes; i++) length = (length << 8) | bytes[pos++];
  }

  const contentEnd = pos + length;
  if (contentEnd > bytes.length) return null;
  return { tag, contentStart: pos, contentEnd, end: contentEnd };
}

const TAG_INTEGER = 0x02;
const TAG_UTC_TIME = 0x17;
const TAG_GENERALIZED_TIME = 0x18;
const TAG_SEQUENCE = 0x30;
const TAG_CONTEXT_0 = 0xa0;

/**
 * ASN.1 time → Date.
 *
 * UTCTime is YYMMDDHHMMSSZ with the RFC 5280 pivot: 00–49 is 2000s, 50–99 is
 * 1900s. GeneralizedTime is YYYYMMDDHHMMSSZ.
 */
function parseAsn1Time(tag: number, text: string): Date | null {
  const m =
    tag === TAG_UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!m) return null;

  let year = Number(m[1]);
  if (tag === TAG_UTC_TIME) year += year < 50 ? 2000 : 1900;

  const date = new Date(
    Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])),
  );
  return isNaN(date.getTime()) ? null : date;
}

function derNotAfter(der: Uint8Array): Date | null {
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
  const certificate = readTlv(der, 0);
  if (!certificate || certificate.tag !== TAG_SEQUENCE) return null;

  const tbs = readTlv(der, certificate.contentStart);
  if (!tbs || tbs.tag !== TAG_SEQUENCE) return null;

  // TBSCertificate ::= SEQUENCE {
  //   [0] version OPTIONAL, serialNumber, signature, issuer, validity, ... }
  let pos = tbs.contentStart;

  const first = readTlv(der, pos);
  if (!first) return null;
  // version is optional and only present for v2/v3; skip it when there.
  if (first.tag === TAG_CONTEXT_0) pos = first.end;

  for (const expected of [TAG_INTEGER, TAG_SEQUENCE, TAG_SEQUENCE]) {
    const field = readTlv(der, pos); // serialNumber, signature, issuer
    if (!field || field.tag !== expected) return null;
    pos = field.end;
  }

  const validity = readTlv(der, pos);
  if (!validity || validity.tag !== TAG_SEQUENCE) return null;

  const notBefore = readTlv(der, validity.contentStart);
  if (!notBefore) return null;
  const notAfter = readTlv(der, notBefore.end);
  if (!notAfter) return null;
  if (notAfter.tag !== TAG_UTC_TIME && notAfter.tag !== TAG_GENERALIZED_TIME) return null;

  let text = '';
  for (let i = notAfter.contentStart; i < notAfter.contentEnd; i++) {
    text += String.fromCharCode(der[i]);
  }
  return parseAsn1Time(notAfter.tag, text);
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * notAfter of the first certificate in a Kubernetes secret's base64 tls.crt.
 *
 * The value is base64-encoded PEM (that is how Kubernetes stores it), so it is
 * decoded once to text, then the first PEM block is decoded again to DER. A
 * bundle's first entry is the leaf, which is the one that expires first and
 * the one an operator cares about.
 */
export function certNotAfterFromSecretData(base64TlsCrt: string | undefined): Date | null {
  if (!base64TlsCrt) return null;

  const outer = base64ToBytes(base64TlsCrt);
  if (!outer) return null;

  let pem = '';
  for (let i = 0; i < outer.length; i++) pem += String.fromCharCode(outer[i]);

  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!match) return null;

  const der = base64ToBytes(match[1]);
  if (!der) return null;

  return derNotAfter(der);
}
