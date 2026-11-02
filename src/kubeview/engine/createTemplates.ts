/**
 * Prefilled manifests for the YAML create flow (`/create/<gvr>?template=<id>&namespace=<ns>`).
 *
 * Screens that find a gap — a namespace with no NetworkPolicy, no quota, an
 * alert rule to write — link here so the user starts from a reviewed,
 * working manifest in the right namespace instead of a blank Pod.
 */
export interface CreateTemplate {
  id: string;
  /** GVR key of what the template creates, e.g. networking.k8s.io/v1/networkpolicies. */
  gvr: string;
  label: string;
  yaml: (namespace: string) => string;
}

export const CREATE_TEMPLATES: Record<string, CreateTemplate> = {
  'default-deny': {
    id: 'default-deny',
    gvr: 'networking.k8s.io/v1/networkpolicies',
    label: 'Default-deny ingress NetworkPolicy (router allowed)',
    // Two policies. A bare deny-all-ingress also blocks the OpenShift router,
    // which silently breaks every Route in the namespace; the allow policy
    // lets the router back in. It comes first: the create flow posts the
    // documents in order, so a failure part-way never leaves deny-only.
    yaml: (ns) => `# Allows the OpenShift router (ingress controller) to reach pods in ${ns},
# so Routes keep working:
# - namespaces labelled policy-group.network.openshift.io/ingress: the
#   router's namespace with the default endpoint publishing strategies;
# - namespaces labelled policy-group.network.openshift.io/host-network:
#   host-network traffic, which is how the router arrives when it uses the
#   HostNetwork endpoint publishing strategy.
# Delete this policy only if ${ns} serves no Routes.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-openshift-ingress
  namespace: ${ns}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              policy-group.network.openshift.io/ingress: ""
        - namespaceSelector:
            matchLabels:
              policy-group.network.openshift.io/host-network: ""
---
# Denies all INGRESS to every pod in ${ns} that no other policy allows.
# Egress is not restricted, so DNS and outbound calls keep working. To deny
# egress too, use the "Default-deny egress (DNS allowed)" template.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: ${ns}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
# Pods in ${ns} calling each other, and Prometheus scraping them, are now
# denied too; add policies for those if they need it.
`,
  },
  'default-deny-egress': {
    id: 'default-deny-egress',
    gvr: 'networking.k8s.io/v1/networkpolicies',
    label: 'Default-deny egress NetworkPolicy (DNS allowed)',
    yaml: (ns) => `# Denies all EGRESS from every pod in ${ns} except DNS lookups.
# Without the DNS rule every name lookup fails, so nothing can resolve even
# the hosts you allow later. Add policies for each destination the pods need
# (other namespaces, the API server, external services).
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress-allow-dns
  namespace: ${ns}
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    # Cluster DNS: the openshift-dns pods listen on 5353; 53 is the Service port.
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: openshift-dns
      ports:
        - protocol: UDP
          port: 5353
        - protocol: TCP
          port: 5353
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
`,
  },
  'resource-quota': {
    id: 'resource-quota',
    gvr: 'v1/resourcequotas',
    label: 'ResourceQuota',
    yaml: (ns) => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: ${ns}
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "50"
`,
  },
  'limit-range': {
    id: 'limit-range',
    gvr: 'v1/limitranges',
    label: 'LimitRange',
    yaml: (ns) => `apiVersion: v1
kind: LimitRange
metadata:
  name: container-defaults
  namespace: ${ns}
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        cpu: 500m
        memory: 512Mi
      max:
        cpu: "2"
        memory: 2Gi
`,
  },
  'prometheus-rule': {
    id: 'prometheus-rule',
    gvr: 'monitoring.coreos.com/v1/prometheusrules',
    label: 'PrometheusRule (alert)',
    yaml: (ns) => `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: my-alerts
  namespace: ${ns}
spec:
  groups:
    - name: my-alerts.rules
      rules:
        - alert: HighPodRestartRate
          # Fires when any container in this namespace restarted more than 3 times in 15 minutes.
          expr: increase(kube_pod_container_status_restarts_total{namespace="${ns}"}[15m]) > 3
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.pod }} is restarting frequently"
            description: "{{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} restarted {{ $value }} times in 15 minutes."
`,
  },
};

const NS_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The template's manifest for `namespace`, or null when the id is unknown or the namespace invalid. */
export function renderCreateTemplate(id: string | null, namespace: string): string | null {
  if (!id) return null;
  const t = CREATE_TEMPLATES[id];
  if (!t || !NS_RE.test(namespace)) return null;
  return t.yaml(namespace);
}

/** `/create/...` link for a template in a namespace. */
export function createTemplateUrl(id: keyof typeof CREATE_TEMPLATES | string, namespace: string): string {
  const t = CREATE_TEMPLATES[id];
  return `/create/${t.gvr.replace(/\//g, '~')}?template=${encodeURIComponent(id)}&namespace=${encodeURIComponent(namespace)}`;
}
