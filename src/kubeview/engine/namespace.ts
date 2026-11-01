import { isPlatformNamespace } from './platformNamespaces';

/**
 * True for platform namespaces that user-facing views leave out. Delegates to
 * the one rule in platformNamespaces.ts (`openshift`, `openshift-*`,
 * `kube-*`); `default` is a user namespace. An object with no namespace
 * (cluster-scoped) is not a user workload either.
 */
export function isSystemNamespace(ns: string | undefined): boolean {
  if (!ns) return true;
  return isPlatformNamespace(ns);
}
