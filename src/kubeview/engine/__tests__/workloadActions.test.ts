import { describe, it, expect } from 'vitest';
import {
  escapeJsonPointer, uniqueName, quantityToBytes, routeUrl, validateMetadataKey, validateLabelValue, setDefaultStorageClass,
} from '../workloadActions';
import type { K8sResource } from '../renderers';

describe('workloadActions helpers', () => {
  it('escapes JSON pointer segments (~ before /)', () => {
    expect(escapeJsonPointer('app.kubernetes.io/name')).toBe('app.kubernetes.io~1name');
    expect(escapeJsonPointer('a~b/c')).toBe('a~0b~1c');
  });

  it('keeps generated names within 63 characters and DNS-safe', () => {
    const n = uniqueName('x'.repeat(80), 'manual', 1_700_000_000_000);
    expect(n.length).toBeLessThanOrEqual(63);
    expect(n).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    expect(uniqueName('nightly-', 'manual', 1)).toMatch(/^nightly-manual-/);
  });

  it('parses binary and decimal quantities', () => {
    expect(quantityToBytes('1Gi')).toBe(2 ** 30);
    expect(quantityToBytes('1G')).toBe(1e9);
    expect(quantityToBytes('1.5Ti')).toBe(1.5 * 2 ** 40);
    expect(quantityToBytes('lots')).toBeNaN();
  });

  it('builds a Route URL with https only for TLS routes', () => {
    expect(routeUrl({ spec: { host: 'a.example.com', path: '/x', tls: {} } } as unknown as K8sResource)).toBe('https://a.example.com/x');
    expect(routeUrl({ spec: { host: 'a.example.com' } } as unknown as K8sResource)).toBe('http://a.example.com');
    expect(routeUrl({ spec: {} } as unknown as K8sResource)).toBeNull();
  });

  it('validates label keys and values', () => {
    expect(validateMetadataKey('app.kubernetes.io/name')).toBeNull();
    expect(validateMetadataKey('Bad_Prefix/x')).toMatch(/Prefix/);
    expect(validateMetadataKey('a/b/c')).toMatch(/at most one/);
    expect(validateMetadataKey('-x')).toMatch(/Name must be/);
    expect(validateLabelValue('')).toBeNull();
    expect(validateLabelValue('has space')).toMatch(/Value must be/);
  });

  it('default StorageClass swap: every other default cleared, target last', () => {
    const sc = (name: string, def = false) => ({ metadata: { name, annotations: def ? { 'storageclass.kubernetes.io/is-default-class': 'true' } : {} } }) as unknown as K8sResource;
    const reqs = setDefaultStorageClass(sc('b'), [sc('a', true), sc('b'), sc('c', true)]);
    expect(reqs.map((r) => r.path.split('/').pop())).toEqual(['a', 'c', 'b']);
  });
});
