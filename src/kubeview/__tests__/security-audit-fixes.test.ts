import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, 'src/kubeview');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC, relativePath), 'utf-8');
}

describe('C1: Helm command injection', () => {
  const source = readSrc('views/create/HelmTab.tsx');

  it('validates release name with strict regex', () => {
    expect(source).toContain("!/^[a-z0-9][a-z0-9-]{0,52}$/.test(sanitizedName)");
  });

  it('validates repo URL protocol', () => {
    expect(source).toContain("!/^https?:\\/\\/.+/.test(repoUrl)");
  });

  it('does not use sh -c for helm commands', () => {
    expect(source).not.toContain("'sh', '-c'");
  });

  it('uses helm install with --repo flag as array args', () => {
    expect(source).toContain("'helm', 'install', sanitizedName");
    expect(source).toContain("'--repo', repoUrl");
  });
});

describe('H1: SSRF in dev proxy', () => {
  const source = read('rspack.config.ts');

  it('validates URL protocol', () => {
    expect(source).toContain("['http:', 'https:'].includes(parsed.protocol)");
  });

  it('blocks internal/private addresses', () => {
    expect(source).toContain('169\\.254');
    expect(source).toContain('192\\.168');
    expect(source).toContain('localhost');
  });
});

describe('H2: Impersonation CRLF injection', () => {
  const source = readSrc('engine/query.ts');

  it('sanitizes CRLF from header values', () => {
    expect(source).toContain("replace(/[\\r\\n]/g, '')");
  });

  it('exports getImpersonationHeaders', () => {
    expect(source).toContain('export function getImpersonationHeaders');
  });
});

describe('H3: nginx security headers', () => {
  const manifest = read('deploy/helm/openshiftpulse/templates/nginx-config.yaml') + '\n' + read('deploy/helm/openshiftpulse/templates/deployment.yaml');

  it('sets X-Frame-Options', () => {
    expect(manifest).toContain('X-Frame-Options');
    expect(manifest).toContain('DENY');
  });

  it('sets X-Content-Type-Options', () => {
    expect(manifest).toContain('X-Content-Type-Options');
    expect(manifest).toContain('nosniff');
  });

  it('sets Content-Security-Policy', () => {
    expect(manifest).toContain('Content-Security-Policy');
    expect(manifest).toContain("default-src 'self'");
  });

  it('sets Strict-Transport-Security', () => {
    expect(manifest).toContain('Strict-Transport-Security');
    expect(manifest).toContain('max-age=31536000');
  });

  it('sets Referrer-Policy', () => {
    expect(manifest).toContain('Referrer-Policy');
    expect(manifest).toContain('strict-origin-when-cross-origin');
  });
});

describe('H4: TLS certificate verification', () => {
  const manifest = read('deploy/helm/openshiftpulse/templates/nginx-config.yaml') + '\n' + read('deploy/helm/openshiftpulse/templates/deployment.yaml');

  it('enables proxy_ssl_verify', () => {
    expect(manifest).toContain('proxy_ssl_verify on');
    expect(manifest).not.toContain('proxy_ssl_verify off');
  });

  it('sets trusted CA certificate', () => {
    expect(manifest).toContain('proxy_ssl_trusted_certificate /var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  });
});

describe('M1: Prometheus label path injection', () => {
  const source = readSrc('components/metrics/prometheus.ts');

  it('validates label name format', () => {
    expect(source).toContain("/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(labelName)");
  });
});

describe('M2: buildApiPathFromResource path traversal', () => {
  const source = readSrc('hooks/useResourceUrl.ts');

  it('sanitizes namespace in buildApiPathFromResource', () => {
    expect(source).toContain('sanitizePathSegment(metadata.namespace)');
  });

  it('sanitizes name in buildApiPathFromResource', () => {
    expect(source).toContain('sanitizePathSegment(metadata.name)');
  });
});

describe('M3: Node log file path validation', () => {
  const source = readSrc('views/NodeLogsView.tsx');

  it('validates file names with strict regex', () => {
    expect(source).toContain("/^[a-zA-Z0-9._-]+$/.test(f)");
  });
});

describe('M4: RegExp injection in log search', () => {
  const source = readSrc('components/logs/LogStream.tsx');

  it('escapes regex special characters before creating RegExp', () => {
    expect(source).toContain("query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')");
  });
});

describe('M6: readOnlyRootFilesystem', () => {
  const manifest = read('deploy/helm/openshiftpulse/templates/nginx-config.yaml') + '\n' + read('deploy/helm/openshiftpulse/templates/deployment.yaml');

  it('sets readOnlyRootFilesystem on both containers', () => {
    const matches = manifest.match(/readOnlyRootFilesystem: true/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('provides writable emptyDir for nginx temp', () => {
    expect(manifest).toContain('name: nginx-tmp');
    expect(manifest).toContain('name: nginx-log');
  });
});

describe('M7: user:full scope configured', () => {
  const deployment = read('deploy/helm/openshiftpulse/templates/deployment.yaml');
  const secrets = read('deploy/helm/openshiftpulse/templates/secrets.yaml');

  it('uses user:full scope in oauth-proxy and OAuthClient', () => {
    expect(deployment).toContain('--scope=user:full');
    expect(secrets).toContain('user:full');
  });
});

describe('L2: Snapshot data in localStorage', () => {
  const source = readSrc('engine/snapshot.ts');

  it('stores cluster-admin subjects for snapshot comparison', () => {
    expect(source).toContain('clusterAdminSubjects');
  });

  it('includes all subjects including system accounts', () => {
    expect(source).toContain("clusterAdminSubjects.push");
  });
});

describe('L3: Impersonation headers in snapshot.ts', () => {
  const source = readSrc('engine/snapshot.ts');

  it('uses comma-separated Impersonate-Group header', () => {
    expect(source).not.toContain('Impersonate-Group${');
    expect(source).toContain(".join(',')");
  });

  it('sanitizes CRLF from impersonation values', () => {
    expect(source).toContain("replace(/[\\r\\n]/g, '')");
  });
});

describe('L4: YAML editor impersonation', () => {
  const source = readSrc('views/YamlEditorView.tsx');

  it('imports getImpersonationHeaders', () => {
    expect(source).toContain("import { getImpersonationHeaders }");
  });

  it('adds impersonation headers to GET request', () => {
    expect(source).toContain("headers: getImpersonationHeaders()");
  });

  it('adds impersonation headers to PUT request', () => {
    expect(source).toContain("...getImpersonationHeaders()");
  });
});
