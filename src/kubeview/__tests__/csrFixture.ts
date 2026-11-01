/**
 * Build a PKCS#10 certificate request (DER → PEM → base64, as in
 * CertificateSigningRequest.spec.request) with a chosen subject and SANs.
 * The signature is a placeholder: Pulse reads the request, it does not verify it.
 */
function len(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
const tlv = (tag: number, body: number[]) => [tag, ...len(body.length), ...body];
const seq = (...items: number[][]) => tlv(0x30, items.flat());
const set = (...items: number[][]) => tlv(0x31, items.flat());
const oid = (bytes: number[]) => tlv(0x06, bytes);
const utf8 = (s: string) => tlv(0x0c, [...new TextEncoder().encode(s)]);

export function csrRequest(opts: { cn: string; o?: string[]; dns?: string[]; ips?: number[][] }): string {
  const rdns = [
    ...(opts.o ?? []).map((o) => set(seq(oid([0x55, 0x04, 0x0a]), utf8(o)))),
    set(seq(oid([0x55, 0x04, 0x03]), utf8(opts.cn))),
  ];
  const names = [
    ...(opts.dns ?? []).map((d) => tlv(0x82, [...new TextEncoder().encode(d)])),
    ...(opts.ips ?? []).map((ip) => tlv(0x87, ip)),
  ];
  const san = seq(oid([0x55, 0x1d, 0x11]), tlv(0x04, seq(...names)));
  const extReq = seq(oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x0e]), set(seq(san)));
  const info = seq(
    tlv(0x02, [0]),
    seq(...rdns),
    seq(seq(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])), tlv(0x03, [0, 4, 1, 2])),
    tlv(0xa0, extReq),
  );
  const der = seq(info, seq(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])), tlv(0x03, [0, 0x30, 0x00]));
  const b64 = btoa(String.fromCharCode(...der));
  const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
  return btoa(pem);
}
