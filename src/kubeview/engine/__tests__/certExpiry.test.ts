// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const k8sListMock = vi.fn();
vi.mock('../query', () => ({ k8sList: (...args: unknown[]) => k8sListMock(...args) }));

import {
  certNotAfterFromSecretData,
  fetchTlsSecrets,
  summarizeTlsSecrets,
  type TlsSecretLike,
} from '../certExpiry';

/**
 * Fixtures are self-signed EC certificates generated with openssl, stored the
 * way Kubernetes stores them: base64 of the PEM text. Their notAfter dates are
 * the openssl-reported ones, in the comments.
 *
 * They cover the two ASN.1 time encodings, which is the part most likely to be
 * got wrong: X.509 uses UTCTime (2-digit year) below 2050 and GeneralizedTime
 * (4-digit year) from 2050 on, so a parser that only handles UTCTime silently
 * misreads long-lived CAs — exactly the certificates it is least acceptable to
 * be wrong about.
 */

// notAfter = Oct 28 02:45:17 2036 GMT  (UTCTime)
const FUTURE_UTCTIME =
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJWRENCL0tBREFnRUNBaFJVL090N2dPT2dNQXJyQ0ZWWUJTakh0WjlBMlRBS0JnZ3Foa2pPUFFRREFqQVIKTVE4d0RRWURWUVFEREFabWRYUjFjbVV3SGhjTk1qWXhNRE14TURJME5URTNXaGNOTXpZeE1ESTRNREkwTlRFMwpXakFSTVE4d0RRWURWUVFEREFabWRYUjFjbVV3V1RBVEJnY3Foa2pPUFFJQkJnZ3Foa2pPUFFNQkJ3TkNBQVNiClZYYmU5Z1RxRmdNbUhwNmRicnZuRlNMUDdNQ1hLemJKYTErSFBNR2x4OHA1MzAvWWo2VkN1d1JSdyszaXBPMzAKOE1RaTdnaER2RmFabUxiOFFpMEJvekl3TURBZEJnTlZIUTRFRmdRVThvSjhyWVBLM3M4M3J6VDBGU0kxRmpQYQoybVl3RHdZRFZSMFRBUUgvQkFVd0F3RUIvekFLQmdncWhrak9QUVFEQWdOSEFEQkVBaUJkTkF2UlFFUlRiY09pCmJyV2h2UGdjWlBBRGVYdnVTdHI5WGsxUW43UlZLQUlnRkhZa2xWeDBhL3pkdXk4cVJnb2dNMGUvaDQ3N1kxN2wKYko1eExoK1g2UFk9Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K';

// notAfter = Jun 22 02:45:17 2051 GMT  (GeneralizedTime, past the 2050 boundary)
const FUTURE_GENERALIZEDTIME =
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJYRENDQVFLZ0F3SUJBZ0lVTVo4TWlzSitxZlpMTk9oL1FPUG9xQ1ViL2hjd0NnWUlLb1pJemowRUF3SXcKRXpFUk1BOEdBMVVFQXd3SWJHOXVaMnhwWm1Vd0lCY05Nall4TURNeE1ESTBOVEUzV2hnUE1qQTFNVEEyTWpJdwpNalExTVRkYU1CTXhFVEFQQmdOVkJBTU1DR3h2Ym1kc2FXWmxNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBECkFRY0RRZ0FFcElRdVVuODc4eC8vb0s5bEllaFczcWF3SmNjQnRkT3B3Z1NBSTFHZnltRzNRNDM0dHFwdnBZWmwKNk5vNmFQR2FhNzR4Y2pZV0tIS2VzOFY3bERyWGU2TXlNREF3SFFZRFZSME9CQllFRkwrUzlSYWNvZDh5TSs4ZQpTc3E3UzVwL3EreXNNQThHQTFVZEV3RUIvd1FGTUFNQkFmOHdDZ1lJS29aSXpqMEVBd0lEU0FBd1JRSWhBTTlsCkxVV01rSkZQYVJudU1Vb3lxWkpZazFqTEE3ODhPd2tlVWlQRG9HMmdBaUJsaS9lNVlSREdISG9qc0JORlVIRzIKUFFCSm9sa1hLQnJNc045ampLdjR0Zz09Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K';

// notAfter = Feb  1 00:00:00 2024 GMT  (genuinely expired)
const EXPIRED =
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJXRENCL3FBREFnRUNBaFF1ZEVuQ3RKSkFIUXc1KzNpb0oyeXkvd1pvdVRBS0JnZ3Foa2pPUFFRREFqQVMKTVJBd0RnWURWUVFEREFkbGVIQnBjbVZrTUI0WERUSTBNREV3TVRBd01EQXdNRm9YRFRJME1ESXdNVEF3TURBdwpNRm93RWpFUU1BNEdBMVVFQXd3SFpYaHdhWEpsWkRCWk1CTUdCeXFHU000OUFnRUdDQ3FHU000OUF3RUhBMElBCkJNK2gveFZoZXNxaWxJa3JoYit1OC9JVmJTdkhuWEsyelE1UStJOHl0QndxS2Y1OFE2SGZySTRyVjJaSTF0TFQKQkN0OE5LbEJtbHBsbmVSaWxicCt2aXFqTWpBd01CMEdBMVVkRGdRV0JCUTRpUGM3aDE1M3ZXcGlYTUR1cWI5eQorNjBLanpBUEJnTlZIUk1CQWY4RUJUQURBUUgvTUFvR0NDcUdTTTQ5QkFNQ0Ewa0FNRVlDSVFEeFpqOC9paGFNCjVCdG5OOEFlWkc4eDNnUXlzdkQxbEhySFFJSHY3bnpvRHdJaEFLTlJpaGJWYldTeVZGZnpldTVOV0FRTmpaRC8KNnNoUFZ2bWRIWWF1RmxOZQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==';

describe('certNotAfterFromSecretData', () => {
  it('reads a UTCTime notAfter', () => {
    const d = certNotAfterFromSecretData(FUTURE_UTCTIME);
    expect(d?.toISOString()).toBe('2036-10-28T02:45:17.000Z');
  });

  // A parser that only understands UTCTime misreads every certificate valid
  // past 2050 — long-lived CAs, which are the worst ones to be wrong about.
  it('reads a GeneralizedTime notAfter (year >= 2050)', () => {
    const d = certNotAfterFromSecretData(FUTURE_GENERALIZEDTIME);
    expect(d?.toISOString()).toBe('2051-06-22T02:45:17.000Z');
  });

  it('reads an expired certificate as expired, not as unreadable', () => {
    const d = certNotAfterFromSecretData(EXPIRED);
    expect(d?.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(d!.getTime()).toBeLessThan(Date.now());
  });

  // The whole point of the change: report nothing rather than a number that
  // is wrong in a direction people act on.
  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not base64', '!!!!'],
    ['base64 but not PEM', btoa('hello there')],
    ['PEM header with garbage body', btoa('-----BEGIN CERTIFICATE-----\nZZZZ\n-----END CERTIFICATE-----')],
    ['truncated DER', btoa('-----BEGIN CERTIFICATE-----\n' + btoa('\x30\x82') + '\n-----END CERTIFICATE-----')],
  ])('returns null for %s rather than guessing', (_label, input) => {
    expect(certNotAfterFromSecretData(input as string | undefined)).toBeNull();
  });

  // The regression this exists to prevent: the old code estimated expiry as
  // creationTimestamp + 365 days, so on a 424-day-old cluster a certificate
  // valid until 2036 was reported ~60 days expired.
  it('is unaffected by how old the Secret object is', () => {
    const d = certNotAfterFromSecretData(FUTURE_UTCTIME);
    expect(d!.getTime()).toBeGreaterThan(Date.now());
  });
});

const tlsSecret = (name: string, crt?: string, annotations?: Record<string, string>): TlsSecretLike => ({
  type: 'kubernetes.io/tls',
  metadata: { name, namespace: 'ns', annotations },
  data: crt === undefined ? {} : { 'tls.crt': crt },
});

describe('summarizeTlsSecrets', () => {
  // Unreadable certificates used to be filtered out silently, so a cluster
  // whose certs could not be parsed looked identical to one with nothing due.
  it('counts TLS secrets whose expiry cannot be read instead of dropping them', () => {
    const { certs, unreadable } = summarizeTlsSecrets([
      tlsSecret('good', FUTURE_UTCTIME),
      tlsSecret('expired', EXPIRED),
      tlsSecret('missing-crt'),
      tlsSecret('garbage', '!!!!'),
      tlsSecret('annotated', '!!!!', { 'cert-manager.io/certificate-expiry': '2030-01-01T00:00:00Z' }),
    ]);
    expect(certs.map((c) => c.name)).toEqual(['good', 'expired', 'annotated']);
    expect(certs.find((c) => c.name === 'annotated')?.expirySource).toBe('cert-manager');
    expect(unreadable).toBe(2);
  });

  it('reports zero unreadable when every certificate parses', () => {
    expect(summarizeTlsSecrets([tlsSecret('a', FUTURE_UTCTIME)]).unreadable).toBe(0);
  });
});

describe('fetchTlsSecrets', () => {
  beforeEach(() => k8sListMock.mockReset());

  // Listing every Secret to keep the TLS ones pulled every readable secret
  // value into the browser. The server filters by type instead.
  it('asks the API server for TLS secrets only, via a type field selector', async () => {
    k8sListMock.mockResolvedValue([]);
    await fetchTlsSecrets();
    expect(k8sListMock).toHaveBeenCalledTimes(1);
    const path = k8sListMock.mock.calls[0][0] as string;
    expect(path).toBe('/api/v1/secrets?fieldSelector=type=kubernetes.io/tls');
    const url = new URL(path, 'https://cluster.example');
    expect(url.pathname).toBe('/api/v1/secrets');
    expect(url.searchParams.get('fieldSelector')).toBe('type=kubernetes.io/tls');
  });

  it('still drops non-TLS secrets if the selector is ignored', async () => {
    k8sListMock.mockResolvedValue([
      tlsSecret('tls'),
      { type: 'Opaque', metadata: { name: 'opaque' } },
    ]);
    const result = await fetchTlsSecrets();
    expect(result.map((s) => s.metadata.name)).toEqual(['tls']);
  });
});
