/**
 * pickDefaultContainer — chooses a sensible default container to show logs
 * for when the user hasn't picked one explicitly.
 *
 * `spec.containers[0]` is not a reliable proxy for "the container the user
 * actually wants to see" — sidecars (oauth-proxy, istio-proxy, etc.) are
 * commonly placed first in a pod spec, so blindly using index 0 tends to
 * show the wrong container's logs by default while still "working"
 * (no error, just not the app the user was debugging).
 */

// Sidecar container names common enough across this cluster's workloads to
// be worth skipping by default. Not exhaustive — this only affects the
// *default* pick; every caller still lets the user switch containers.
const KNOWN_SIDECAR_NAMES = new Set([
  'oauth-proxy',
  'istio-proxy',
  'istio-init',
  'envoy',
  'linkerd-proxy',
  'linkerd-init',
  'vault-agent',
  'vault-agent-init',
  'pilot-agent',
]);

export function pickDefaultContainer(containerNames: Array<string | undefined>): string | undefined {
  const names = containerNames.filter((n): n is string => Boolean(n));
  if (names.length === 0) return undefined;
  return names.find((name) => !KNOWN_SIDECAR_NAMES.has(name)) ?? names[0];
}
