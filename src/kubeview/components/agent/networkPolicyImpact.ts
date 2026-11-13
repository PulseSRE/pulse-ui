/**
 * What `create_network_policy` leaves reachable, for its confirmation.
 *
 * Since pulse-agent#248 the default variants keep the OpenShift router
 * (ingress, via an extra `allow-from-openshift-ingress` policy) and DNS to
 * openshift-dns (egress) working; `strict: true` is a bare deny that breaks
 * every Route and/or all name resolution. Mirrors the agent's
 * `network_policy_reachability` and `default_network_policy_name`.
 */

export function isStrictNetworkPolicy(input: Record<string, unknown>): boolean {
  return input.strict === true || input.strict === 'true';
}

function policyType(input: Record<string, unknown>): string {
  return typeof input.policy_type === 'string' && input.policy_type ? input.policy_type : 'deny-all-ingress';
}

/** The deny policy's name: the one given, else the agent's default for the type. */
export function networkPolicyName(input: Record<string, unknown>): string {
  if (typeof input.name === 'string' && input.name) return input.name;
  const strict = isStrictNetworkPolicy(input);
  const type = policyType(input);
  if (type === 'deny-all-egress') return strict ? 'default-deny-egress' : 'default-deny-egress-allow-dns';
  if (type === 'deny-all') return strict ? 'default-deny-all' : 'default-deny-all-allow-dns';
  return 'default-deny-ingress';
}

/** Plain English: what keeps working and what breaks, with a warning first when strict. */
export function networkPolicyImpact(input: Record<string, unknown>): string {
  const type = policyType(input);
  const strict = isStrictNetworkPolicy(input);
  const ns = typeof input.namespace === 'string' && input.namespace ? input.namespace : 'the namespace';
  const deniesIngress = type === 'deny-all-ingress' || type === 'deny-all';
  const deniesEgress = type === 'deny-all-egress' || type === 'deny-all';
  if (!deniesIngress && !deniesEgress) return `Unknown policy type "${type}"; the agent will refuse it.`;
  const parts: string[] = [];
  if (strict) {
    const broken = [deniesIngress && 'every Route', deniesEgress && 'all DNS lookups'].filter(Boolean).join(' and ');
    parts.push(`Warning: strict mode. This breaks ${broken} in ${ns}`);
  }
  if (deniesIngress) {
    parts.push(strict
      ? 'All ingress is denied, including the OpenShift router: every Route in the namespace stops working'
      : 'Ingress is denied except from the OpenShift router, so Routes keep working (a second policy, allow-from-openshift-ingress, is created unless it exists); pods in the namespace calling each other and Prometheus scraping them are denied');
  } else {
    parts.push('Ingress is not restricted');
  }
  if (deniesEgress) {
    parts.push(strict
      ? 'All egress is denied, including DNS: no name lookups resolve'
      : 'Egress is denied except DNS to openshift-dns (UDP/TCP 53 and 5353); every other destination the pods call is blocked until you allow it');
  } else {
    parts.push('Egress is not restricted, so DNS and outbound calls keep working');
  }
  return `${parts.join('. ')}.`;
}
