# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately by emailing the maintainers. Do **not** open a public GitHub issue for security vulnerabilities.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to acknowledge reports within 48 hours and provide a fix within 7 days for critical issues.

---

## Security Architecture

### Authentication & Authorization

| Layer | Mechanism |
|-------|-----------|
| **User authentication** | OAuth proxy sidecar with OAuthClient (`user:full` scope — required for write operations) |
| **User authorization** | User's OAuth token forwarded via `X-Forwarded-Access-Token` header to K8s API |
| **Service account** | Minimal ClusterRole (`openshiftpulse-reader`) with read-only access + token review for OAuth proxy |
| **Secrets** | OAuth client secret and cookie secret mounted from a K8s Secret via files (`--client-secret-file`, `--cookie-secret-file`) |

The service account does **not** perform API calls on behalf of users. All user actions (create, update, delete, scale, patch) use the user's own OAuth token forwarded by the proxy. The SA exists only for pod identity and OAuth proxy token validation.

### Data Flow

```
Browser --> OAuth Proxy (8443/TLS) --> nginx (8080) --> K8s API / Prometheus / Alertmanager
                    |
            User's OAuth token forwarded via X-Forwarded-Access-Token
            (SA token NOT used for API calls)
```

---

## Container Security

### Images

All container images come from Red Hat registries:

| Image | Registry | Purpose |
|-------|----------|---------|
| `registry.access.redhat.com/ubi9/nginx-122:1-18` | Red Hat UBI | App server (via Dockerfile) |
| `registry.redhat.io/openshift4/ose-oauth-proxy:v4.17` | Red Hat | OAuth authentication sidecar |
| `openshift/nginx:1.26-ubi9` | OpenShift ImageStream (Red Hat) | S2I builder image |

No Docker Hub, Quay community, or third-party images are used.

### Pod Security

| Control | Setting |
|---------|---------|
| `runAsNonRoot` | `true` (pod-level) |
| `seccompProfile` | `RuntimeDefault` |
| `allowPrivilegeEscalation` | `false` (both containers) |
| `readOnlyRootFilesystem` | `true` (both containers) |
| `capabilities` | Drop `ALL` (both containers) |
| Writable paths | Only `/tmp` and `/var/log/nginx` via `emptyDir` volumes |

### Network Security

| Control | Setting |
|---------|---------|
| TLS termination | `reencrypt` on Route (TLS from edge to pod) |
| K8s API TLS | `proxy_ssl_verify on` with `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` |
| Prometheus/Alertmanager TLS | `proxy_ssl_verify on` with `service-ca.crt` |
| HTTP security headers | CSP (`default-src 'self'`), X-Frame-Options `DENY`, HSTS, X-Content-Type-Options `nosniff`, Referrer-Policy `strict-origin-when-cross-origin` |

### Resource Limits

| Resource | Setting |
|----------|---------|
| ResourceQuota | 10 pods, 1 CPU / 1Gi memory requests, 2 CPU / 2Gi limits |
| LimitRange | Default 200m/256Mi per container, max 1 CPU/1Gi |
| PodDisruptionBudget | `minAvailable: 1` |

---

## Input Validation

| Attack Vector | Mitigation |
|---------------|------------|
| Helm command injection | Release names validated against `^[a-z0-9][a-z0-9-]{0,52}$`, args passed as arrays with `--repo` flag |
| SSRF in dev proxy | URL protocol validated (http/https only), private/link-local IPs blocked |
| Impersonation CRLF injection | `\r\n` stripped from all `Impersonate-User` and `Impersonate-Group` header values |
| PromQL injection | Label values sanitized via `sanitizePromQL()` — only `[a-zA-Z0-9_\-./]` allowed |
| Prometheus label path injection | Label names validated against `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| Path traversal (API paths) | `sanitizePathSegment()` applied to namespace and resource name |
| Path traversal (node logs) | Filenames validated against `^[a-zA-Z0-9._-]+$` |
| RegExp DoS (log search) | Regex special characters escaped before `new RegExp()` |
| XSS | React's default escaping + CSP `default-src 'self'` |

---

## Security Audit

A comprehensive security audit was performed covering authentication, injection vulnerabilities, sensitive data exposure, API security, deployment security, and client-side security. All 15 findings have been resolved:

| Severity | Count | Findings |
|----------|-------|----------|
| Critical | 1 | Helm command injection via `sh -c` |
| High | 4 | SSRF in dev proxy, impersonation CRLF injection, missing nginx security headers, `proxy_ssl_verify off` |
| Medium | 7 | PromQL injection, path traversal (2), RegExp DoS, missing `readOnlyRootFilesystem`, placeholder secrets, broad OAuth scope |
| Low | 3 | Impersonation header format, YAML editor missing impersonation, token logging risk in dev |

### Detailed Findings

| Severity | Finding | Resolution |
|----------|---------|------------|
| Critical | Helm command injection via `sh -c` | Validate release names, use array args with `--repo` flag |
| High | SSRF in dev proxy | Validate URL protocol, block private/link-local IPs |
| High | Impersonation CRLF injection | Strip `\r\n` from all impersonation header values |
| High | Missing nginx security headers | Added CSP, X-Frame-Options, HSTS, nosniff, Referrer-Policy |
| High | `proxy_ssl_verify off` | Enabled with correct CA certs (`ca.crt` for API, `service-ca.crt` for monitoring) |
| Medium | Prometheus label path injection | Validate label names against `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| Medium | Path traversal in `buildApiPathFromResource` | Apply `sanitizePathSegment` to namespace and name |
| Medium | Node log file path traversal | Validate filenames against `^[a-zA-Z0-9._-]+$` |
| Medium | RegExp DoS in log search | Escape regex special chars before `new RegExp()` |
| Medium | Missing `readOnlyRootFilesystem` | Added to both containers with emptyDir for writable paths |
| Medium | Placeholder secrets in manifest | Documented generation steps, added deployment validation |
| Medium | Broad `user:full` OAuth scope | Documented requirement (app performs write operations) |
| Low | Impersonation header format | Fixed to comma-separated `Impersonate-Group`, sanitized CRLF |
| Low | YAML editor missing impersonation | Added `getImpersonationHeaders()` to GET and PUT requests |
| Low | Token logging risk in dev | Documented in `.env.example` |

---

## Dependency Security

### Packages
- All packages sourced from the official registry (`registry.npmjs.org`) via pnpm
- `pnpm audit` reports **0 vulnerabilities** (as of v2.7.1)
- No custom `.npmrc` overriding the registry
- No deprecated packages in production dependencies

### Automated Checks
- Pre-commit hook runs `vitest` before every commit
- Pre-push hook runs `vitest` before every push
- Post-write hook runs `eslint` on changed `.ts`/`.tsx` files

---

## RBAC Model

The service account ClusterRole (`openshiftpulse-reader`) has **read-only** access:

```yaml
# Core resources
- apiGroups: [""]
  resources: [configmaps, endpoints, events, namespaces, nodes, pods, pods/log, ...]
  verbs: [get, list, watch]

# Apps, Batch, RBAC, Networking, Storage, CRDs, OpenShift resources
  verbs: [get, list, watch]

# OAuth proxy requirements
- apiGroups: [authentication.k8s.io]
  resources: [tokenreviews]
  verbs: [create]
- apiGroups: [authorization.k8s.io]
  resources: [subjectaccessreviews]
  verbs: [create]
```

Write operations (create, update, delete, scale, patch) are performed using the **user's own OAuth token**, not the service account token. This means:
- Users can only modify resources they have RBAC access to
- The app cannot escalate privileges beyond the user's own permissions
- Audit logs correctly attribute changes to the user, not the service account

---

## Deployment Hardening Checklist

- [ ] Generate real OAuth secrets (`openssl rand -base64 32` for client, `openssl rand -hex 16` for cookie)
- [ ] Verify OAuthClient `redirectURIs` matches the Route host
- [ ] Confirm service-ca TLS secret is auto-generated (annotation on Service)
- [ ] Review ResourceQuota limits for your environment
- [ ] Ensure cluster has 2+ nodes for topology spread constraints
- [ ] Verify `ose-oauth-proxy` image pull succeeds (requires Red Hat registry auth)
- [ ] Test login flow end-to-end after deployment
